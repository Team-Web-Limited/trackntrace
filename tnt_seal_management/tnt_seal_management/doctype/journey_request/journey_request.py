# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.search import validate_and_sanitize_search_inputs
from frappe.model.document import Document
from frappe.utils import cint, cstr, getdate, now_datetime

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
)

ASSIGNABLE_SEAL_STATUSES = ("Available",)
JOURNEY_REQUEST_STATUSES = (
	"Draft",
	"Pending Control Room Approval",
	"Pending Tagging",
	"Pending Customer Care Approval",
	"Approved",
	"Rejected",
	"Cancelled",
)

# Field groups used by the per-status / per-role lock matrix.
CONTENT_FIELDS = (
	"job_order",
	"vehicle",
	"entry_number",
	"container_number",
	"number_of_seals",
	"origin",
	"destination",
	"driver_contact",
	"entry_document",
	"seals",
)
EVIDENCE_FIELDS = ("tagging_photos",)
TAGGING_FIELDS = (
	"actual_tagging_date_time",
	"tagging_location",
	"tagging_completed",
	"tagging_remarks",
)

_FIELD_LABELS = {
	"job_order": "Job Order",
	"vehicle": "Vehicle",
	"entry_number": "Entry Number",
	"container_number": "Container Number",
	"number_of_seals": "Number of Seals",
	"origin": "Origin",
	"destination": "Destination",
	"driver_contact": "Driver Contact",
	"entry_document": "Entry Document",
	"seals": "Seal Serial Number(s)",
	"tagging_photos": "Tagging Pictures",
	"actual_tagging_date_time": "Actual Tagging Date and Time",
	"tagging_location": "Tagging Location",
	"tagging_completed": "Tagging Completed",
	"tagging_remarks": "Tagging Remarks",
}

# Seal Journey statuses that count as the technician being actively engaged.
_ACTIVE_JOURNEY_STATUSES = (
	"In Transit",
	"Ready for Journey",
	"Tagged",
	"Tagging In Progress",
)


class JourneyRequest(Document):
	def validate(self):
		self.enforce_field_locks()
		self.enforce_tagging_irreversible()
		self.validate_technician_availability()
		self.validate_seals()
		self.validate_route()

	# ------------------------------------------------------------------
	# Lock matrix — who may change what, in which status
	# ------------------------------------------------------------------
	def enforce_field_locks(self):
		if self.is_new() or self.flags.get("ignore_field_locks"):
			return

		roles = set(frappe.get_roles())
		if "System Manager" in roles:
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		status = previous.journey_request_status or self.journey_request_status
		for fieldname in _locked_fields_for(roles, status):
			if self._field_changed(previous, fieldname):
				frappe.throw(
					_("You cannot change {0} at the {1} stage.").format(
						_(_FIELD_LABELS.get(fieldname, fieldname)), _(status)
					),
					title=_("Not Permitted"),
				)

	def _field_changed(self, previous, fieldname):
		if fieldname == "seals":
			return _seals_signature(self) != _seals_signature(previous)
		if fieldname == "tagging_photos":
			return _photos_signature(self) != _photos_signature(previous)
		return self.get(fieldname) != previous.get(fieldname)

	def enforce_tagging_irreversible(self):
		if self.is_new():
			return
		previous = self.get_doc_before_save()
		if previous and cint(previous.tagging_completed) and not cint(self.tagging_completed):
			frappe.throw(
				_("Tagging Completed cannot be unchecked once confirmed."),
				title=_("Not Permitted"),
			)

	def validate_technician_availability(self):
		if not self.assigned_technician:
			return

		occupied_journey = frappe.db.get_value(
			"Seal Journey",
			{
				"assigned_technician": self.assigned_technician,
				"technician_status": "Occupied",
				"name": ["!=", self.journey_reference or ""],
			},
			"name",
		)
		if occupied_journey:
			frappe.throw(
				_("Technician {0} is occupied on Seal Journey {1}.").format(
					self.assigned_technician, occupied_journey
				),
				title=_("Technician Unavailable"),
			)

	def validate_route(self):
		if self.origin and self.destination and self.origin == self.destination:
			frappe.throw(
				_("Origin and Destination cannot be the same address."),
				title=_("Invalid Route"),
			)

	def validate_seals(self):
		if not self.seals:
			return

		seal_devices = [row.seal_device for row in self.seals if row.seal_device]
		if len(seal_devices) != len(set(seal_devices)):
			frappe.throw(
				_("The same Seal Device cannot be selected more than once."),
				title=_("Duplicate Seal"),
			)

		if cint(self.number_of_seals) and len(self.seals) != cint(self.number_of_seals):
			frappe.throw(
				_("Number of Seals ({0}) does not match the number of seal rows ({1}).").format(
					self.number_of_seals, len(self.seals)
				),
				title=_("Seal Count Mismatch"),
			)

		if self.journey_request_status == "Draft":
			for seal_device in seal_devices:
				_ensure_seal_available(seal_device, self.name)


def _ensure_seal_available(seal_device, journey_request_name):
	status, current_journey_request = frappe.db.get_value(
		"Seal Device", seal_device, ["current_status", "current_journey_request"]
	) or (None, None)
	if status not in ASSIGNABLE_SEAL_STATUSES and current_journey_request != journey_request_name:
		frappe.throw(
			_("Seal Device {0} is not Available (current status: {1}).").format(
				seal_device, status
			),
			title=_("Seal Unavailable"),
		)


def _seals_signature(doc):
	return tuple((row.seal_device, row.tag_status) for row in (doc.get("seals") or []))


def _photos_signature(doc):
	return tuple(
		(row.photo_type, row.photo_attachment) for row in (doc.get("tagging_photos") or [])
	)


def _locked_fields_for(roles, status):
	"""Return the set of fieldnames the current user may not change in this status."""
	all_managed = set(CONTENT_FIELDS) | set(EVIDENCE_FIELDS) | set(TAGGING_FIELDS)

	if "Field Technician" in roles:
		if status == "Draft":
			return set()
		if status == "Pending Tagging":
			return set(CONTENT_FIELDS)
		return all_managed

	# Operations Control Room and Customer Care act through guarded actions,
	# never by free-form editing of journey content.
	return all_managed


# ----------------------------------------------------------------------
# Permissions
# ----------------------------------------------------------------------
def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Customer Care", "Operations Control Room"}:
		return ""

	if "Field Technician" in roles:
		return f"`tabJourney Request`.assigned_technician = {frappe.db.escape(user)}"

	return ""


def has_permission(doc, user=None, permission_type=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Customer Care", "Operations Control Room"}:
		return True

	if "Field Technician" in roles:
		if doc.is_new() or permission_type == "create":
			return True
		return doc.assigned_technician == user

	return False


# ----------------------------------------------------------------------
# Workflow actions
# ----------------------------------------------------------------------
def _get_journey_request(docname):
	doc = frappe.get_doc("Journey Request", docname)
	doc.check_permission("write")
	return doc


def _ensure_role(role, message):
	if role not in frappe.get_roles():
		frappe.throw(message, title=_("Insufficient Permission"))


def _append_approval_log(doc, action, remarks=None):
	doc.append(
		"approval_log",
		{
			"action": action,
			"action_by": frappe.session.user,
			"action_date_time": now_datetime(),
			"remarks": remarks,
		},
	)


@frappe.whitelist()
def submit_to_control_room(docname):
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Draft":
		frappe.throw(
			_("Only draft journey requests can be submitted to the Control Room."),
			title=_("Invalid Status"),
		)

	if not doc.seals:
		frappe.throw(_("Select at least one Seal before submitting."), title=_("Seals Required"))

	doc.journey_request_status = "Pending Control Room Approval"
	_append_approval_log(doc, "Submitted to Control Room")
	doc.flags.ignore_field_locks = True
	doc.save()
	set_journey_status(doc.journey_reference, "Pre-Tagging")
	frappe.db.commit()


@frappe.whitelist()
def approve_by_control_room(docname, remarks=None):
	_ensure_role(
		"Operations Control Room",
		_("Only the Operations Control Room can approve at this stage."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Control Room Approval":
		frappe.throw(
			_("Only journey requests pending Control Room approval can be approved."),
			title=_("Invalid Status"),
		)

	doc.journey_request_status = "Pending Tagging"
	doc.control_room_approver = frappe.session.user
	doc.control_room_approval_date_time = now_datetime()
	doc.control_room_remarks = remarks
	_append_approval_log(doc, "Control Room Approved", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()
	set_journey_status(doc.journey_reference, "Tagging In Progress")
	frappe.db.commit()


@frappe.whitelist()
def reject_by_control_room(docname, remarks=None):
	_ensure_role(
		"Operations Control Room",
		_("Only the Operations Control Room can reject at this stage."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Control Room Approval":
		frappe.throw(
			_("Only journey requests pending Control Room approval can be rejected."),
			title=_("Invalid Status"),
		)

	doc.journey_request_status = "Rejected"
	doc.control_room_approver = frappe.session.user
	doc.control_room_approval_date_time = now_datetime()
	doc.control_room_remarks = remarks
	_append_approval_log(doc, "Control Room Rejected", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()
	frappe.db.commit()


@frappe.whitelist()
def swap_seal(docname, old_seal_device, new_seal_device):
	_ensure_role(
		"Operations Control Room",
		_("Only the Operations Control Room can swap seals."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Control Room Approval":
		frappe.throw(
			_("Seals can only be swapped while pending Control Room approval."),
			title=_("Invalid Status"),
		)

	row = next((r for r in doc.seals if r.seal_device == old_seal_device), None)
	if not row:
		frappe.throw(
			_("Seal Device {0} is not on this journey request.").format(old_seal_device),
			title=_("Seal Not Found"),
		)

	if any(r.seal_device == new_seal_device for r in doc.seals):
		frappe.throw(
			_("Seal Device {0} is already on this journey request.").format(new_seal_device),
			title=_("Duplicate Seal"),
		)

	_ensure_seal_available(new_seal_device, doc.name)

	row.seal_device = new_seal_device
	row.seal_number = frappe.db.get_value("Seal Device", new_seal_device, "seal_number")
	row.serial_number = frappe.db.get_value("Seal Device", new_seal_device, "serial_number")
	row.tag_status = "Pending"
	for field in ("lock_status", "api_device_status", "api_location", "battery_level", "api_last_update_time"):
		row.set(field, None)
	_append_approval_log(
		doc, "Seal Swapped", _("{0} -> {1}").format(old_seal_device, new_seal_device)
	)
	doc.flags.ignore_field_locks = True
	doc.save()
	frappe.db.commit()
	return {"seal_device": new_seal_device, "seal_number": row.seal_number}


@frappe.whitelist()
def refresh_proposed_seal_status(docname):
	"""Pull live data for each proposed seal so the Control Room can vet
	battery / location / lock before approving. Failures per seal are tolerated."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import (
		_apply_to_journey_request_seal,
		sync_seal_device,
	)

	_ensure_role(
		"Operations Control Room",
		_("Only the Operations Control Room can refresh seal status."),
	)
	doc = _get_journey_request(docname)

	refreshed = 0
	errors = []
	for row in doc.seals:
		if not row.seal_device:
			continue
		try:
			matched = sync_seal_device(row.seal_device, sync_type="Manual Device Sync")
			_apply_to_journey_request_seal(row.name, matched)
			refreshed += 1
		except Exception as exc:
			errors.append(f"{row.seal_device}: {str(exc)[:120]}")

	return {"refreshed": refreshed, "errors": errors}


@frappe.whitelist()
def complete_tagging(docname):
	_ensure_role(
		"Field Technician",
		_("Only the assigned Field Technician can complete tagging."),
	)
	doc = _get_journey_request(docname)
	if doc.assigned_technician and doc.assigned_technician != frappe.session.user:
		frappe.throw(
			_("This journey request is assigned to {0}.").format(doc.assigned_technician),
			title=_("Not Assigned to You"),
		)
	if doc.journey_request_status != "Pending Tagging":
		frappe.throw(
			_("Tagging can only be completed after Control Room approval."),
			title=_("Invalid Status"),
		)
	if not cint(doc.tagging_completed):
		frappe.throw(
			_("Tick Tagging Completed to confirm you have finished tagging."),
			title=_("Confirmation Required"),
		)
	if not doc.tagging_photos:
		frappe.throw(
			_("Attach at least one tagging evidence photo before completing."),
			title=_("Evidence Required"),
		)

	if not doc.actual_tagging_date_time:
		doc.actual_tagging_date_time = now_datetime()
	for row in doc.seals:
		row.tag_status = "Tagged"

	doc.journey_request_status = "Pending Customer Care Approval"
	_append_approval_log(doc, "Tagging Completed")
	doc.flags.ignore_field_locks = True
	doc.save()
	set_journey_status(
		doc.journey_reference,
		"Tagged",
		{"tagging_status": "Completed", "tagging_date_time": doc.actual_tagging_date_time},
	)
	frappe.db.commit()


@frappe.whitelist()
def approve_journey_request(docname, remarks=None):
	_ensure_role(
		"Customer Care",
		_("Only users with the Customer Care role can perform this action."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Customer Care Approval":
		frappe.throw(
			_("Only journey requests pending Customer Care approval can be approved."),
			title=_("Invalid Status"),
		)

	doc.journey_request_status = "Approved"
	doc.customer_care_approver = frappe.session.user
	doc.approval_date_time = now_datetime()
	doc.customer_care_remarks = remarks
	_append_approval_log(doc, "Approved", remarks)

	seal_journey = _finalize_seal_journey_from_request(doc)
	doc.journey_reference = seal_journey.name
	doc.flags.ignore_field_locks = True
	doc.save()

	for row in doc.seals:
		update = {
			"current_status": "Assigned",
			"current_journey_request": doc.name,
			"current_journey": seal_journey.name,
		}
		if doc.vehicle:
			update["current_vehicle"] = doc.vehicle
		if doc.container_number:
			update["current_container"] = doc.container_number
		frappe.db.set_value("Seal Device", row.seal_device, update)

	frappe.db.commit()
	return {"seal_journey": seal_journey.name}


@frappe.whitelist()
def reject_journey_request(docname, remarks=None):
	_ensure_role(
		"Customer Care",
		_("Only users with the Customer Care role can perform this action."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Customer Care Approval":
		frappe.throw(
			_("Only journey requests pending Customer Care approval can be rejected."),
			title=_("Invalid Status"),
		)

	doc.journey_request_status = "Rejected"
	doc.customer_care_approver = frappe.session.user
	doc.approval_date_time = now_datetime()
	doc.customer_care_remarks = remarks
	_append_approval_log(doc, "Rejected", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()
	frappe.db.commit()


def _finalize_seal_journey_from_request(jr):
	"""Populate and start the Seal Journey for an approved Journey Request.

	Reuses the Seal Journey created when the Tagging Booking was first saved
	(linked via ``jr.journey_reference``). Falls back to creating one for legacy
	requests that have no linked journey."""
	vehicle_plate = (
		frappe.db.get_value("Vehicle", jr.vehicle, "registration_number") if jr.vehicle else None
	) or jr.vehicle

	if jr.journey_reference and frappe.db.exists("Seal Journey", jr.journey_reference):
		journey = frappe.get_doc("Seal Journey", jr.journey_reference)
	else:
		journey = frappe.new_doc("Seal Journey")

	journey.update(
		{
			"customer": jr.client_name,
			"sales_order_reference": jr.job_order,
			"journey_status": "In Transit",
			"vehicle_plate_number": vehicle_plate,
			"container_number": jr.container_number,
			"origin": jr.origin,
			"destination": jr.destination,
			"assigned_technician": jr.assigned_technician,
			"technician_status": "Occupied",
			"tagging_status": "Completed",
			"tagging_date_time": jr.actual_tagging_date_time,
			"tagging_remarks": jr.tagging_remarks,
			"seal_attached_confirmation": 1,
			"post_tagging_status": "Completed",
			"journey_readiness": 1,
			"journey_start_date_time": now_datetime(),
		}
	)

	journey.set("journey_seals", [])
	first_seal = None
	for row in jr.seals:
		if not first_seal:
			first_seal = row.seal_device
		journey.append(
			"journey_seals",
			{
				"seal_device": row.seal_device,
				"seal_number": row.seal_number,
				"serial_number": row.serial_number,
				"tag_status": "Tagged",
				"lock_status": row.lock_status,
				"api_device_status": row.api_device_status,
				"api_location": row.api_location,
				"battery_level": row.battery_level,
				"api_last_update_time": row.api_last_update_time,
			},
		)

	if first_seal:
		journey.assigned_seal = first_seal
		journey.proposed_seal = first_seal

	journey.set("photos", [])
	for row in jr.tagging_photos:
		journey.append(
			"photos",
			{
				"photo_type": row.photo_type,
				"photo_attachment": row.photo_attachment,
				"uploaded_by": row.uploaded_by,
				"upload_date_time": row.upload_date_time,
				"remarks": row.remarks,
				"related_seal": row.related_seal,
			},
		)

	journey.save(ignore_permissions=True) if not journey.is_new() else journey.insert(
		ignore_permissions=True, ignore_mandatory=True
	)
	return journey


# ----------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------
@frappe.whitelist()
@validate_and_sanitize_search_inputs
def available_seal_query(doctype, txt, searchfield, start, page_len, filters):
	journey_request = (filters or {}).get("journey_request") or ""
	return frappe.db.sql(
		"""
		select
			name, seal_number
		from `tabSeal Device`
		where (current_status = 'Available' or current_journey_request = %(journey_request)s)
			and (name like %(txt)s or seal_number like %(txt)s)
		order by
			case when name like %(txt)s then 0 else 1 end,
			name asc
		limit %(start)s, %(page_len)s
		""",
		{
			"journey_request": journey_request,
			"txt": f"%{cstr(txt)}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
	)


@frappe.whitelist()
def get_journey_request_list(
	search=None,
	status=None,
	from_date=None,
	to_date=None,
	page=1,
	page_length=25,
):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	if from_date and to_date and getdate(from_date) > getdate(to_date):
		frappe.throw(_("From Date cannot be after To Date."))

	base_filters = []
	if from_date:
		base_filters.append(["creation", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["creation", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["client_name", "like", search_text],
			["entry_number", "like", search_text],
			["container_number", "like", search_text],
			["vehicle", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["journey_request_status", "=", status])

	requests = frappe.get_list(
		"Journey Request",
		fields=[
			"name",
			"client_name",
			"vehicle",
			"entry_number",
			"container_number",
			"number_of_seals",
			"origin",
			"destination",
			"driver_contact",
			"journey_request_status",
			"creation",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	_attach_seal_serial_numbers(requests)

	total_result = frappe.get_list(
		"Journey Request",
		fields=[{"COUNT": "*", "as": "count"}],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_result[0].count) if total_result else 0

	summary = {status: 0 for status in ("All",) + JOURNEY_REQUEST_STATUSES}
	summary_rows = frappe.get_list(
		"Journey Request",
		fields=["journey_request_status", {"COUNT": "*", "as": "count"}],
		filters=base_filters,
		or_filters=or_filters,
		group_by="journey_request_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.journey_request_status in summary:
			summary[row.journey_request_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"requests": requests,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}


def _attach_seal_serial_numbers(requests):
	if not requests:
		return

	request_names = [request.name for request in requests]
	seal_rows = frappe.get_all(
		"Journey Request Seal",
		filters={"parent": ["in", request_names], "parenttype": "Journey Request"},
		fields=["parent", "seal_number"],
		order_by="parent asc, idx asc",
	)

	seals_by_request = {}
	for row in seal_rows:
		if not row.seal_number:
			continue
		seals_by_request.setdefault(row.parent, []).append(row.seal_number)

	for request in requests:
		request.seal_serial_numbers = ", ".join(seals_by_request.get(request.name, []))
