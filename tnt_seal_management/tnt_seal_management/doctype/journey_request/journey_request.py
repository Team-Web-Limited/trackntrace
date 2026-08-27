# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.search import validate_and_sanitize_search_inputs
from frappe.model.document import Document
from frappe.utils import cint, cstr, getdate, now_datetime

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
	sync_seal_journey_mirror,
	sync_seal_journey_pre_tagging,
)
from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	last_known_warehouse,
	record_journey_custody,
	set_seal_custody,
)

ASSIGNABLE_SEAL_STATUSES = ("Available",)
JOURNEY_REQUEST_STATUSES = (
	"Draft",
	"Pending Control Room Approval",
	"Tagging",
	"Journey Ready",
	"Untagging",
	"Awaiting Seal Return",
	"Pending Seal Return Approval",
	"Seal Returned",
	"Rejected",
	"Cancelled",
)

# Field groups used by the per-status / per-role lock matrix.
CONTENT_FIELDS = (
	"job_order",
	"journey_type",
	"vehicle",
	"entry_number",
	"container_number",
	"file_number",
	"departure_card_number",
	"number_of_seals",
	"origin",
	"destination",
	"driver_contact",
	"entry_document",
	"seals",
)
EVIDENCE_FIELDS = ("entry_document", "tagging_photos")
TAGGING_FIELDS = (
	"actual_tagging_date_time",
	"tagging_location",
	"tagging_completed",
	"tagging_remarks",
)
# Untagging reuses the same Seal Trip Photo child shape as EVIDENCE_FIELDS — the
# Untagging Documents section on the Journey Request only appears once
# the journey reaches the untagging phase (see jr_untagging_section's depends_on).
UNTAGGING_FIELDS = ("untagging_entry_document",)
# Technician confirmation stamps the authoritative untagging completion fields
# and opens the seal-return window without a Control Room approval gate.
UNTAGGING_CONFIRMATION_FIELDS = ("untagging_confirmed_by_technician",)
# Seal return reuses the same Seal Trip Photo child shape, mirroring untagging —
# the FT who performed the untagging is now the seal's custodian, and captures the
# return evidence on the same Journey Request once it reaches "Awaiting Seal Return"
# (see the Seal Return section's depends_on). The technician confirms the return
# (the tick is required), which parks the request at "Pending Seal Return Approval"
# until the PCB Team Leader approves it — only then does the return take effect.
SEAL_RETURN_FIELDS = ("seal_return_entry_document",)
SEAL_RETURN_CONFIRMATION_FIELDS = (
	"seal_return_confirmed_by_technician",
	"seal_return_condition",
	"retrieval_card_number",
)

PHOTO_TABLE_TYPES = {
	"entry_document": "Pre-Tagging",
	"tagging_photos": "Tagging",
	"untagging_entry_document": "Untagging",
	"seal_return_entry_document": "Seal Return",
}

_FIELD_LABELS = {
	"job_order": "Job Order",
	"journey_type": "Journey Type",
	"vehicle": "Vehicle",
	"entry_number": "Entry Number",
	"container_number": "Container Number",
	"file_number": "File Number",
	"departure_card_number": "Departure Card Number",
	"number_of_seals": "Number of Seals",
	"origin": "Origin",
	"destination": "Destination",
	"driver_contact": "Driver Contact",
	"entry_document": "Entry Pictures",
	"seals": "Seal Serial Number(s)",
	"tagging_photos": "Tagging Pictures",
	"actual_tagging_date_time": "Actual Tagging Date and Time",
	"tagging_location": "Tagging Location",
	"tagging_completed": "Tagging Completed",
	"tagging_remarks": "Tagging Remarks",
	"untagging_entry_document": "Entry Pictures (Untagging)",
	"untagging_confirmed_by_technician": "Confirmed by Technician",
	"seal_return_entry_document": "Entry Pictures (Seal Return)",
	"seal_return_confirmed_by_technician": "Confirmed by Technician",
	"seal_return_condition": "Seal Condition",
	"retrieval_card_number": "Retrieval Card Number",
}

# Seal Journey statuses that count as the technician being actively engaged.
_ACTIVE_JOURNEY_STATUSES = (
	"In Transit",
	"Ready for Journey",
	"Tagged",
	"Tagging In Progress",
)


class JourneyRequest(Document):
	def before_insert(self):
		self.ensure_pre_tagging_checklist()

	def on_update(self):
		if self.journey_reference:
			sync_seal_journey_pre_tagging(self.journey_reference, self)

	def ensure_pre_tagging_checklist(self):
		if self.pre_tagging_checklist:
			return
		from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import get_pre_tagging_checklist_items
		for item in get_pre_tagging_checklist_items():
			self.append("pre_tagging_checklist", {"checklist_item": item, "completed": 0})

	def validate(self):
		self.ensure_pre_tagging_checklist()
		self.enforce_field_locks()
		self.validate_remarks_log()
		self.set_photo_types()
		self.enforce_tagging_irreversible()
		self.validate_seals()
		self.validate_route()

	def set_photo_types(self):
		for fieldname, photo_type in PHOTO_TABLE_TYPES.items():
			for row in self.get(fieldname) or []:
				row.photo_type = photo_type

	def validate_remarks_log(self):
		previous = self.get_doc_before_save()
		previous_rows = {
			row.name: row for row in (previous.get("remarks_log") or [])
		} if previous else {}
		current_names = {row.name for row in self.remarks_log if row.name in previous_rows}

		if set(previous_rows) - current_names:
			frappe.throw(
				_("Saved remarks cannot be deleted."),
				title=_("Remarks History Is Append-Only"),
			)

		for row in self.remarks_log:
			old_row = previous_rows.get(row.name)
			if old_row:
				# Only the remarks text is protected here. remark_date_time and
				# remarked_by are read-only/system-set and not part of what this
				# check is meant to guard — comparing them risks false positives,
				# since a plain frm.save() round-trips Datetime fields through the
				# browser and truncates microsecond precision, making an untouched
				# row look "edited" purely from the precision loss.
				if cstr(row.remarks) != cstr(old_row.remarks):
					frappe.throw(
						_("Saved remarks cannot be edited."),
						title=_("Remarks History Is Append-Only"),
					)
				continue

			if not self.flags.get("allow_remarks_log_append"):
				frappe.throw(
					_("Remarks History is populated automatically by workflow actions."),
					title=_("Cannot Add Remarks Manually"),
				)
			row.remarked_by = frappe.session.user
			row.remark_date_time = now_datetime()

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
		if fieldname in EVIDENCE_FIELDS or fieldname in UNTAGGING_FIELDS or fieldname in SEAL_RETURN_FIELDS:
			return _photos_signature(self, fieldname) != _photos_signature(previous, fieldname)
		# previous.get(fieldname) comes straight from the DB (e.g. a native
		# datetime.datetime for Datetime fields), while self.get(fieldname) on an
		# incoming save is still the raw string the client submitted — comparing
		# them directly is always unequal regardless of actual value. cstr()
		# normalises both sides to the same string form before comparing.
		return cstr(self.get(fieldname)) != cstr(previous.get(fieldname))

	def enforce_tagging_irreversible(self):
		if self.is_new():
			return
		previous = self.get_doc_before_save()
		if previous and cint(previous.tagging_completed) and not cint(self.tagging_completed):
			frappe.throw(
				_("Tagging Completed cannot be unchecked once confirmed."),
				title=_("Not Permitted"),
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

		# Sub-seal (parent_seal) integrity: a parent must be another seal on this
		# same journey, and a seal cannot be its own parent.
		on_journey = set(seal_devices)
		for row in self.seals:
			if not row.parent_seal:
				continue
			if row.parent_seal == row.seal_device:
				frappe.throw(
					_("Seal {0} cannot be its own parent.").format(row.seal_device),
					title=_("Invalid Sub-Seal"),
				)
			if row.parent_seal not in on_journey:
				frappe.throw(
					_("Parent Seal {0} for sub-seal {1} must also be a seal on this journey.").format(
						row.parent_seal, row.seal_device
					),
					title=_("Invalid Sub-Seal"),
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


def _photos_signature(doc, fieldname):
	return tuple(
		(row.photo_type, row.photo_attachment) for row in (doc.get(fieldname) or [])
	)


def _locked_fields_for(roles, status):
	"""Return the set of fieldnames the current user may not change in this status."""
	all_managed = (
		set(CONTENT_FIELDS)
		| set(EVIDENCE_FIELDS)
		| set(TAGGING_FIELDS)
		| set(UNTAGGING_FIELDS)
		| set(UNTAGGING_CONFIRMATION_FIELDS)
		| set(SEAL_RETURN_FIELDS)
		| set(SEAL_RETURN_CONFIRMATION_FIELDS)
	)

	if "Field Technician" in roles:
		if status == "Draft":
			return set()
		if status == "Tagging":
			return set(CONTENT_FIELDS)
		if status == "Untagging":
			return (
				set(CONTENT_FIELDS)
				| set(EVIDENCE_FIELDS)
				| set(TAGGING_FIELDS)
				| set(SEAL_RETURN_FIELDS)
				| set(SEAL_RETURN_CONFIRMATION_FIELDS)
			)
		# "Awaiting Seal Return" doubles as the seal-return work window — the FT who
		# untagged is now the seal's custodian and captures return evidence here,
		# so everything earlier in the lifecycle is locked but the seal-return
		# fields stay editable.
		if status == "Awaiting Seal Return":
			return (
				set(CONTENT_FIELDS)
				| set(EVIDENCE_FIELDS)
				| set(TAGGING_FIELDS)
				| set(UNTAGGING_FIELDS)
				| set(UNTAGGING_CONFIRMATION_FIELDS)
			)
		return all_managed

	# The Operations Control Room and the PCB Team Leader act through guarded
	# actions, never by free-form editing of journey content.
	return all_managed


# ----------------------------------------------------------------------
# Permissions
# ----------------------------------------------------------------------
def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	# The PCB Team Leader is in this set because they sign off seal returns —
	# see approve_seal_return. Finance PCB and Account Manager are dashboard
	# viewers with no assignment of their own, so they see the full list too
	# (mirrors the unconditional True in has_permission below).
	if roles & {"System Manager", "Management", "Operations Control Room", PCB_TEAM_LEAD_ROLE, "Finance PCB", "Account Manager"}:
		return ""

	if "Field Technician" in roles:
		return f"`tabJourney Request`.assigned_technician = {frappe.db.escape(user)}"

	return ""


def has_permission(doc, user=None, permission_type=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Operations Control Room", PCB_TEAM_LEAD_ROLE, "Finance PCB", "Account Manager"}:
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


# Roles that own the Control Room approval queue — mirrors the recipient set
# used for critical seal alerts (see api.seal_sync._ALERT_NOTIFY_ROLES).
CONTROL_ROOM_NOTIFY_ROLES = ("Operations Control Room",)

# The seal return is signed off by the PCB Team Leader, not the Control Room —
# they own the physical seal stock the return puts back into the pool.
PCB_TEAM_LEAD_ROLE = "PCB Team Leader"


def _notify_control_room_approval_pending(doc):
	"""Notify the Control Room that a Field Technician has submitted a tagged
	journey for approval, via desk notification and email."""
	from tnt_seal_management.tnt_seal_management.api.notifications import (
		get_users_with_role,
		notify_users,
	)

	recipients = []
	seen = set()
	for role in CONTROL_ROOM_NOTIFY_ROLES:
		for user, email in get_users_with_role(role):
			if user not in seen:
				seen.add(user)
				recipients.append((user, email))

	subject = _("Journey Request Awaiting Approval: {0}").format(doc.name)
	lines = [
		_("{0} submitted a tagged journey for Control Room approval.").format(
			doc.assigned_technician or frappe.session.user
		),
		_("Vehicle: {0}").format(doc.vehicle or "-"),
		_("Route: {0} -> {1}").format(doc.origin or "-", doc.destination or "-"),
	]
	message = "<br>".join(str(line) for line in lines)

	notify_users(
		recipients,
		subject,
		message,
		document_type="Journey Request",
		document_name=doc.name,
		link=f"/app/journey-request/{doc.name}",
	)


def _seal_return_approvers(doc):
	"""Recipients for the seal-return approval queue: the Seal Journey's own
	assigned team lead when there is one, otherwise every PCB Team Leader."""
	from tnt_seal_management.tnt_seal_management.api.notifications import get_users_with_role

	team_lead = None
	if doc.journey_reference:
		team_lead = frappe.db.get_value("Seal Journey", doc.journey_reference, "assigned_team_lead")

	if team_lead and frappe.db.get_value("User", team_lead, "enabled"):
		email = frappe.db.get_value("User", team_lead, "email")
		return [(team_lead, email or team_lead)]

	return get_users_with_role(PCB_TEAM_LEAD_ROLE)


def _notify_seal_return_approval_pending(doc):
	"""Notify the PCB Team Leader that a Field Technician has confirmed a seal
	return and it is waiting on their approval, via desk notification and email."""
	from tnt_seal_management.tnt_seal_management.api.notifications import notify_users

	subject = _("Seal Return Awaiting Approval: {0}").format(doc.name)
	lines = [
		_("{0} confirmed the seal return and it is awaiting your approval.").format(
			doc.assigned_technician or frappe.session.user
		),
		_("Client: {0}").format(doc.client_name or "-"),
		_("Seal Condition: {0}").format(doc.seal_return_condition or "-"),
		_("Retrieval Card Number: {0}").format(doc.retrieval_card_number or "-"),
		_("Return Warehouse: {0}").format(doc.return_warehouse or "-"),
		_("Return Location: {0}").format(doc.seal_return_location or "-"),
	]
	message = "<br>".join(str(line) for line in lines)

	notify_users(
		_seal_return_approvers(doc),
		subject,
		message,
		document_type="Journey Request",
		document_name=doc.name,
		link=f"/app/journey-request/{doc.name}",
	)


def _notify_technician_seal_return_decision(doc, approved, remarks=None):
	"""Tell the Field Technician how the PCB Team Leader ruled on their return."""
	from tnt_seal_management.tnt_seal_management.api.notifications import notify_users

	if not doc.assigned_technician:
		return

	email = frappe.db.get_value("User", doc.assigned_technician, "email")
	if approved:
		subject = _("Seal Return Approved: {0}").format(doc.name)
		lines = [_("The PCB Team Leader approved the seal return for {0}.").format(doc.name)]
	else:
		subject = _("Seal Return Rejected: {0}").format(doc.name)
		lines = [
			_("The PCB Team Leader rejected the seal return for {0}.").format(doc.name),
			_("Correct the return details and confirm the seal return again."),
		]
	if cstr(remarks).strip():
		lines.append(_("Remarks: {0}").format(cstr(remarks).strip()))
	message = "<br>".join(str(line) for line in lines)

	notify_users(
		[(doc.assigned_technician, email or doc.assigned_technician)],
		subject,
		message,
		document_type="Journey Request",
		document_name=doc.name,
		link=f"/app/journey-request/{doc.name}",
	)


def _ensure_role(role, message):
	# System Manager / Administrator may act on any stage of the workflow.
	roles = set(frappe.get_roles())
	if "System Manager" in roles or frappe.session.user == "Administrator":
		return
	if role not in roles:
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
	if cstr(remarks).strip():
		doc.append("remarks_log", {"remarks": cstr(remarks).strip()})
		doc.flags.allow_remarks_log_append = True


@frappe.whitelist()
def submit_to_control_room(docname):
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Draft":
		frappe.throw(
			_("Only draft journey requests can be submitted to the Control Room."),
			title=_("Invalid Status"),
		)

	if not doc.file_number:
		frappe.throw(_("Enter the File Number before submitting to the Control Room."), title=_("File Number Required"))
	if not doc.departure_card_number:
		frappe.throw(
			_("Enter the Departure Card Number before submitting to the Control Room."),
			title=_("Departure Card Number Required"),
		)
	if not doc.seals:
		frappe.throw(_("Select at least one Seal before submitting."), title=_("Seals Required"))
	if doc.pre_tagging_checklist and any(not row.completed for row in doc.pre_tagging_checklist):
		frappe.throw(
			_("Complete every item on the Pre-Tagging Checklist before submitting to the Control Room."),
			title=_("Pre-Tagging Checklist Incomplete"),
		)
	if not any(row.photo_attachment for row in doc.tagging_photos):
		frappe.throw(
			_("Attach at least one tagging picture before submitting to the Control Room."),
			title=_("Tagging Pictures Required"),
		)

	doc.journey_request_status = "Pending Control Room Approval"
	_append_approval_log(doc, "Submitted to Control Room")
	doc.flags.ignore_field_locks = True
	doc.save()
	set_journey_status(doc.journey_reference, "Pre-Tagging")
	sync_seal_journey_mirror(doc.journey_reference)

	# First recorded custody hop of the journey: seals leave the warehouse and are
	# handed to the Field Technician who submitted them. The start warehouse is
	# the seal's last known warehouse (where it was returned to on its previous
	# journey) — blank if this is the seal's first cycle, since there's nothing to
	# reference yet; it starts getting logged from the next cycle onward.
	if doc.assigned_technician:
		for row in doc.seals:
			origin_warehouse = last_known_warehouse(row.seal_device, exclude_journey=doc.journey_reference)
			if origin_warehouse:
				record_journey_custody(
					row.seal_device, doc.journey_reference, "start_warehouse", origin_warehouse
				)
			set_seal_custody(
				row.seal_device,
				"User",
				doc.assigned_technician,
				remarks=f"Submitted to Control Room via Journey Request {doc.name}",
				journey=doc.journey_reference,
				column="tagging_to",
			)

	_notify_control_room_approval_pending(doc)
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

	doc.journey_request_status = "Tagging"
	doc.control_room_approver = frappe.session.user
	doc.control_room_approval_date_time = now_datetime()
	doc.control_room_remarks = remarks
	_append_approval_log(doc, "Control Room Approved", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()
	set_journey_status(doc.journey_reference, "Tagging In Progress")
	sync_seal_journey_mirror(doc.journey_reference)
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
	# Rejection can be a hard stop or just a kickback for rework (e.g. swap a
	# seal and resubmit) — leave the Seal Journey's stage status untouched and
	# only mirror the rejection remarks/approver through for visibility.
	sync_seal_journey_mirror(doc.journey_reference)
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
	is_admin = "System Manager" in set(frappe.get_roles()) or frappe.session.user == "Administrator"
	if not is_admin and doc.assigned_technician and doc.assigned_technician != frappe.session.user:
		frappe.throw(
			_("This journey request is assigned to {0}.").format(doc.assigned_technician),
			title=_("Not Assigned to You"),
		)
	if doc.journey_request_status != "Tagging":
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

	doc.tagging_location = _pull_tagging_location(doc) or doc.tagging_location

	# Tagging completion is the last gate before the journey starts — there is no
	# downstream Customer Care approval, so the technician's confirmation both
	# closes tagging and puts the Seal Journey In Transit.
	doc.journey_request_status = "Journey Ready"
	# Doubles as the departure confirmation mirrored onto the Seal Journey.
	doc.approval_date_time = now_datetime()
	_append_approval_log(doc, "Tagging Completed")

	seal_journey = _finalize_seal_journey_from_request(doc)
	doc.journey_reference = seal_journey.name
	doc.flags.ignore_field_locks = True
	doc.save()

	# _finalize sets the In Transit status + child tables; mirror fills the
	# remaining tagging detail from the now-saved request.
	sync_seal_journey_mirror(seal_journey.name)

	for row in doc.seals:
		update = {
			"current_status": "Assigned",
			"current_journey_request": doc.name,
			"current_journey": seal_journey.name,
		}
		if doc.assigned_technician:
			update["current_technician"] = doc.assigned_technician
		if doc.vehicle:
			update["current_vehicle"] = doc.vehicle
		if doc.container_number:
			update["current_container"] = doc.container_number
		frappe.db.set_value("Seal Device", row.seal_device, update)
		# The tagging handoff to the technician was already recorded when the seals
		# were submitted to the Control Room (see submit_to_control_room). Completing
		# tagging puts the seal In Transit, attached to the customer's movement, so
		# custody now passes to the customer for the trip (the "customer" hop).
		if seal_journey.customer:
			set_seal_custody(
				row.seal_device,
				"Customer",
				seal_journey.customer,
				remarks=f"In transit with customer via Journey Request {doc.name}",
				journey=seal_journey.name,
				column="customer",
			)
		elif not doc.assigned_technician and doc.job_order:
			# Fallback for a technician-less job order: custody stays with the order.
			set_seal_custody(
				row.seal_device,
				"PCB Job Order",
				doc.job_order,
				remarks=f"Assigned via Journey Request {doc.name}",
				journey=seal_journey.name,
			)

	frappe.db.commit()
	return {"seal_journey": seal_journey.name}


def _pull_tagging_location(doc):
	"""Fetch live GPS for the journey's seals and return the first location found.

	Tagging location is evidence, not an attested action, so it is captured from
	the seal device's own GPS (via sync_seal_device) rather than typed in by the
	technician — removes the chance of a fudged or skipped location at the one
	moment (tagging completion) it matters most for audit."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	for row in doc.seals:
		if not row.seal_device:
			continue
		try:
			matched = sync_seal_device(row.seal_device, sync_type="Manual Device Sync")
		except Exception as exc:
			frappe.log_error(
				f"Tagging location sync failed for {row.seal_device}: {exc}",
				"Journey Request Tagging Location Sync",
			)
			continue
		if matched.get("location"):
			return str(matched["location"])[:140]

	return None


@frappe.whitelist()
def confirm_untagging(docname, manual_location=None, remarks=None):
	"""Complete untagging and open the seal-return phase.

	The assigned Field Technician confirms the work directly. GPS is preferred;
	when no live location is available the client prompts for a manual location
	and calls this method again with that value.
	"""
	_ensure_role(
		"Field Technician",
		_("Only the assigned Field Technician can confirm untagging."),
	)
	doc = _get_journey_request(docname)
	is_admin = "System Manager" in set(frappe.get_roles()) or frappe.session.user == "Administrator"
	if not is_admin and doc.assigned_technician and doc.assigned_technician != frappe.session.user:
		frappe.throw(
			_("This journey request is assigned to {0}.").format(doc.assigned_technician),
			title=_("Not Assigned to You"),
		)
	if doc.journey_request_status != "Untagging":
		frappe.throw(
			_("Only journey requests in the Untagging stage can be confirmed."),
			title=_("Invalid Status"),
		)
	location = _pull_untagging_location(doc)
	manual_location = cstr(manual_location).strip()
	if not location and not manual_location:
		return {"requires_manual_location": True}

	doc.actual_untagging_date_time = doc.actual_untagging_date_time or now_datetime()
	doc.untagging_location = location or manual_location[:140]
	doc.untagging_completed = 1
	doc.journey_request_status = "Awaiting Seal Return"
	_append_approval_log(doc, "Untagging Confirmed", cstr(remarks).strip() or None)
	doc.flags.ignore_field_locks = True
	doc.save()

	if doc.assigned_technician:
		for row in doc.seals:
			if not row.seal_device:
				continue
			set_seal_custody(
				row.seal_device,
				"User",
				doc.assigned_technician,
				remarks="Retained custody after untagging for seal return",
				journey=doc.journey_reference,
				column="seal_return_to",
			)

	set_journey_status(
		doc.journey_reference,
		"Awaiting Seal Return",
		{
			"untagging_status": "Completed",
			"untagging_completed_date_time": doc.actual_untagging_date_time,
			"untagging_confirmation": 1,
		},
	)
	sync_seal_journey_mirror(doc.journey_reference)
	frappe.db.commit()
	return {"requires_manual_location": False, "location": doc.untagging_location}


def _pull_untagging_location(doc):
	"""Fetch live GPS for the journey seals when the technician confirms untagging."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	for row in doc.seals:
		if not row.seal_device:
			continue
		try:
			matched = sync_seal_device(row.seal_device, sync_type="Manual Device Sync")
		except Exception as exc:
			frappe.log_error(
				f"Untagging location sync failed for {row.seal_device}: {exc}",
				"Journey Request Untagging Location Sync",
			)
			continue
		if matched.get("location"):
			return str(matched["location"])[:140]

	return None


@frappe.whitelist()
def confirm_seal_return(docname, manual_location=None, remarks=None):
	"""Complete the seal return directly from the assigned Field Technician."""
	_ensure_role(
		"Field Technician",
		_("Only the assigned Field Technician can confirm the seal return."),
	)
	doc = _get_journey_request(docname)
	is_admin = "System Manager" in set(frappe.get_roles()) or frappe.session.user == "Administrator"
	if not is_admin and doc.assigned_technician != frappe.session.user:
		doc.assigned_technician = frappe.session.user
		for row in doc.seals:
			if not row.seal_device:
				continue
			record_journey_custody(
				row.seal_device,
				doc.journey_reference,
				"seal_return_to",
				frappe.session.user,
				remarks="Taken over by this technician for seal return",
			)
	if doc.journey_request_status != "Awaiting Seal Return":
		frappe.throw(
			_("Only journey requests awaiting seal return can be confirmed."),
			title=_("Invalid Status"),
		)
	if not cint(doc.seal_return_confirmed_by_technician):
		frappe.throw(
			_("Tick Confirmed by Technician to confirm the seal has been physically returned."),
			title=_("Confirmation Required"),
		)
	if doc.seal_return_condition not in ("Good", "Damaged", "Lost"):
		frappe.throw(
			_("Select the seal condition before confirming."),
			title=_("Seal Condition Required"),
		)
	if not doc.retrieval_card_number:
		frappe.throw(
			_("Enter the Retrieval Card Number before confirming the seal return."),
			title=_("Retrieval Card Number Required"),
		)
	if not doc.return_warehouse:
		frappe.throw(
			_("Select the Warehouse the seal is being returned to before confirming."),
			title=_("Warehouse Required"),
		)

	location = _pull_seal_return_location(doc)
	manual_location = cstr(manual_location).strip()
	if not location and not manual_location:
		return {"requires_manual_location": True}

	doc.actual_seal_return_date_time = doc.actual_seal_return_date_time or now_datetime()
	doc.seal_return_location = location or manual_location[:140]
	# The physical return is done, but the seal only goes back into the pool once
	# the PCB Team Leader approves it — see approve_seal_return.
	doc.journey_request_status = "Pending Seal Return Approval"
	_append_approval_log(doc, "Seal Return Confirmed", cstr(remarks).strip() or None)
	_append_approval_log(doc, "Seal Return Submitted for Approval")
	doc.flags.ignore_field_locks = True
	doc.save()

	_notify_seal_return_approval_pending(doc)
	sync_seal_journey_mirror(doc.journey_reference)
	frappe.db.commit()
	return {
		"requires_manual_location": False,
		"location": doc.seal_return_location,
		"pending_approval": True,
	}


@frappe.whitelist()
def approve_seal_return(docname, remarks=None):
	"""PCB Team Leader approval of a seal return the Field Technician confirmed.

	This is the point at which the return actually takes effect: the journey is
	completed, the seals go back into the pool (or stay out if returned Damaged
	or Lost) and custody moves to the return warehouse."""
	_ensure_role(
		PCB_TEAM_LEAD_ROLE,
		_("Only the PCB Team Leader can approve a seal return."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Seal Return Approval":
		frappe.throw(
			_("Only journey requests pending seal return approval can be approved."),
			title=_("Invalid Status"),
		)

	remarks = cstr(remarks).strip()
	doc.seal_return_approver = frappe.session.user
	doc.seal_return_approval_date_time = now_datetime()
	doc.seal_return_approval_remarks = remarks or None
	doc.seal_returned = 1
	doc.journey_request_status = "Seal Returned"
	_append_approval_log(doc, "Seal Return Approved", remarks or None)
	doc.flags.ignore_field_locks = True
	doc.save()

	_finalise_seal_return(doc, remarks)
	_notify_technician_seal_return_decision(doc, approved=True, remarks=remarks)
	sync_seal_journey_mirror(doc.journey_reference)
	frappe.db.commit()
	return {"journey_request_status": doc.journey_request_status}


@frappe.whitelist()
def reject_seal_return(docname, remarks=None):
	"""PCB Team Leader rejection — hands the request back to the Field Technician
	so the return evidence can be corrected and re-confirmed."""
	_ensure_role(
		PCB_TEAM_LEAD_ROLE,
		_("Only the PCB Team Leader can reject a seal return."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Seal Return Approval":
		frappe.throw(
			_("Only journey requests pending seal return approval can be rejected."),
			title=_("Invalid Status"),
		)

	remarks = cstr(remarks).strip()
	if not remarks:
		frappe.throw(
			_("Enter the reason for rejecting the seal return."),
			title=_("Remarks Required"),
		)

	doc.seal_return_approver = frappe.session.user
	doc.seal_return_approval_date_time = now_datetime()
	doc.seal_return_approval_remarks = remarks
	# Back to the seal-return work window, with the technician's confirmation
	# cleared so the return has to be deliberately re-confirmed.
	doc.seal_return_confirmed_by_technician = 0
	doc.journey_request_status = "Awaiting Seal Return"
	_append_approval_log(doc, "Seal Return Rejected", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()

	_notify_technician_seal_return_decision(doc, approved=False, remarks=remarks)
	sync_seal_journey_mirror(doc.journey_reference)
	frappe.db.commit()
	return {"journey_request_status": doc.journey_request_status}


def _finalise_seal_return(doc, remarks=None):
	"""Apply the effects of an approved seal return: complete the journey, put the
	seals back in the pool and move custody to the return warehouse."""
	set_journey_status(
		doc.journey_reference,
		"Completed",
		{"completion_date_time": doc.actual_seal_return_date_time},
	)
	# The return warehouse is the one the technician selects on the Journey Request
	# (there is no configured main warehouse). Logged with the GPS location that was
	# captured at return, in brackets, for auditability — e.g.
	# "Nanak warehouse - TD (-1.30, 36.81)". If no warehouse was selected, the
	# return warehouse column stays blank for now and gets logged on the next cycle.
	return_warehouse = doc.return_warehouse
	warehouse_label = None
	if return_warehouse:
		wh_name = frappe.db.get_value("Warehouse", return_warehouse, "warehouse_name") or return_warehouse
		warehouse_label = f"{wh_name} ({doc.seal_return_location})" if doc.seal_return_location else wh_name
	# A returned seal goes straight back into the pool — there is no separate
	# "Returned" resting status. Only a bad condition on return keeps it out.
	returned_status = (
		doc.seal_return_condition if doc.seal_return_condition in ("Damaged", "Lost") else "Available"
	)
	for row in doc.seals:
		if not row.seal_device:
			continue
		frappe.db.set_value(
			"Seal Device",
			row.seal_device,
			{
				"current_status": returned_status,
				"condition": doc.seal_return_condition,
				"current_journey": None,
				"current_journey_request": None,
				"current_technician": None,
				"current_vehicle": None,
				"current_container": None,
			},
		)
		if return_warehouse:
			# Final hop: seal is back in a warehouse. Update the live pointer to that
			# warehouse, then close the journey's single custody row by writing the
			# return warehouse column as "selected warehouse (gps location)".
			set_seal_custody(
				row.seal_device,
				"Warehouse",
				return_warehouse,
				remarks=f"Returned via Journey Request {doc.name}",
				journey=doc.journey_reference,
			)
			record_journey_custody(
				row.seal_device,
				doc.journey_reference,
				"return_warehouse",
				warehouse_label,
				# Whatever the approver typed when approving the return, if
				# anything — the warehouse itself is already in the column.
				remarks=cstr(remarks).strip() or None,
			)

	_copy_seal_return_evidence_to_journey(doc)


def _copy_seal_return_evidence_to_journey(doc):
	"""Mirror the seal-return evidence photo tables from the Journey Request onto
	the linked Seal Journey's Seal Return tab, so the return evidence is visible
	from the journey itself. Same Seal Trip Photo child shape on both sides."""
	if not doc.journey_reference or not frappe.db.exists("Seal Journey", doc.journey_reference):
		return

	journey = frappe.get_doc("Seal Journey", doc.journey_reference)
	for target_field, source_rows in (
		("seal_return_entry_document", doc.seal_return_entry_document),
	):
		journey.set(target_field, [])
		for row in source_rows:
			journey.append(
				target_field,
				{
					"photo_type": row.photo_type,
					"photo_attachment": row.photo_attachment,
					"uploaded_by": row.uploaded_by,
					"upload_date_time": row.upload_date_time,
					"remarks": row.remarks,
					"related_seal": row.related_seal,
				},
			)
	journey.flags.ignore_field_locks = True
	journey.save(ignore_permissions=True)


def _pull_seal_return_location(doc):
	"""Fetch live or stored seal GPS when the technician confirms the return."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	fallback = None
	for row in doc.seals:
		if not row.seal_device:
			continue
		try:
			matched = sync_seal_device(row.seal_device, sync_type="Manual Device Sync")
		except Exception as exc:
			frappe.log_error(
				f"Seal return location sync failed for {row.seal_device}: {exc}",
				"Journey Request Seal Return Location Sync",
			)
			matched = {}
		if matched.get("location"):
			return str(matched["location"])[:140]
		# Live sync gave no fix — keep the seal's last known GPS position as a
		# fallback so the return location is still captured.
		if fallback is None:
			stored = frappe.db.get_value(
				"Seal Device", row.seal_device, ["current_location", "last_known_api_location"]
			)
			stored = next((loc for loc in (stored or []) if loc), None)
			if stored:
				fallback = str(stored)[:140]

	return fallback


def _finalize_seal_journey_from_request(jr):
	"""Populate and start the Seal Journey for an approved Journey Request.

	Reuses the Seal Journey created when the Tagging Booking was first saved
	(linked via ``jr.journey_reference``). Falls back to creating one for legacy
	requests that have no linked journey."""
	# vehicle is plain text carried over from the Tagging Booking — the Field
	# Technician has no access to the Vehicle doctype, so there is no record to
	# resolve a registration number from.
	vehicle_plate = jr.vehicle

	if jr.journey_reference and frappe.db.exists("Seal Journey", jr.journey_reference):
		journey = frappe.get_doc("Seal Journey", jr.journey_reference)
	else:
		journey = frappe.new_doc("Seal Journey")

	journey.update(
		{
			"customer": jr.client_name,
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


def _build_journey_request_filters(search=None, status=None, from_date=None, to_date=None):
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

	return base_filters, or_filters, filters


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

	base_filters, or_filters, filters = _build_journey_request_filters(search, status, from_date, to_date)

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
		order_by="modified desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	_attach_seal_serial_numbers(requests)

	total_result = frappe.get_list(
		"Journey Request",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_result[0].count) if total_result else 0

	summary = {status: 0 for status in ("All",) + JOURNEY_REQUEST_STATUSES}
	summary_rows = frappe.get_list(
		"Journey Request",
		fields=["journey_request_status", "count(*) as count"],
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


@frappe.whitelist()
def get_all_journey_requests_for_export(search=None, status=None, from_date=None, to_date=None):
	"""Same filters as get_journey_request_list but unpaginated, for the PDF export."""
	_, or_filters, filters = _build_journey_request_filters(search, status, from_date, to_date)

	requests = frappe.get_list(
		"Journey Request",
		fields=[
			"name",
			"client_name",
			"vehicle",
			"entry_number",
			"origin",
			"destination",
			"journey_request_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc",
		limit_page_length=0,
	)
	_attach_seal_serial_numbers(requests)
	return requests


_EXPORT_ROLES = {
	"System Manager",
	"Management",
	"Operations Control Room",
	"Field Technician",
	"Managing Director",
}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Journey Request list's currently filtered table (built
	client-side, same approach as the Seal Device Dashboard's export) to a PDF."""
	from frappe.utils.pdf import get_pdf

	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export journey requests."),
			frappe.PermissionError,
		)

	html = html.replace("{{TNT_LOGO}}", _get_tnt_logo_img_tag())

	options = {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "15mm",
		"margin-right": "15mm",
		"margin-bottom": "15mm",
		"margin-left": "15mm",
	}

	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = get_pdf(html, options=options)
	frappe.local.response.type = "pdf"


def _get_tnt_logo_img_tag():
	"""Track and Trace logo, inlined as a base64 data URI so the (unpatched,
	pre-Qt-WebKit) wkhtmltopdf on this box renders it without an HTTP round
	trip back to the site."""
	import base64
	import os

	path = frappe.get_app_path("tnt_seal_management", "public", "images", "trackntrace.png")
	if not os.path.exists(path):
		return ""

	with open(path, "rb") as f:
		encoded = base64.b64encode(f.read()).decode("ascii")

	return f'<img src="data:image/png;base64,{encoded}" class="tnt-pdf-logo" alt="Track and Trace">'


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


@frappe.whitelist()
def get_control_room_queue():
	"""Journey Requests awaiting Control Room approval of the original tagging
	proposal, with each request's full seal detail, for the Control Room page's
	Approve tab. Honours Journey Request permissions via get_list, so a Control
	Room user sees the whole queue."""
	return _get_approval_queue_by_status("Pending Control Room Approval")




def _get_approval_queue_by_status(status):
	requests = frappe.get_list(
		"Journey Request",
		filters={"journey_request_status": status},
		fields=[
			"name",
			"client_name",
			"job_order",
			"vehicle",
			"driver_contact",
			"origin",
			"destination",
			"entry_number",
			"container_number",
			"number_of_seals",
			"assigned_technician",
			"creation",
		],
		order_by="creation asc",
		limit_page_length=0,
	)
	if not requests:
		return {"requests": []}

	request_names = [r.name for r in requests]
	seal_rows = frappe.get_all(
		"Journey Request Seal",
		filters={"parent": ["in", request_names], "parenttype": "Journey Request"},
		fields=[
			"parent",
			"seal_device",
			"seal_number",
			"serial_number",
			"parent_seal",
			"tag_status",
			"lock_status",
			"api_device_status",
			"api_location",
			"battery_level",
			"api_last_update_time",
		],
		order_by="parent asc, idx asc",
	)

	seals_by_request = {}
	for row in seal_rows:
		seals_by_request.setdefault(row.parent, []).append(row)

	# Show the technician's display name rather than the raw user id.
	technician_ids = {r.assigned_technician for r in requests if r.assigned_technician}
	technician_names = (
		dict(
			frappe.get_all(
				"User",
				filters={"name": ["in", list(technician_ids)]},
				fields=["name", "full_name"],
				as_list=True,
			)
		)
		if technician_ids
		else {}
	)

	for request in requests:
		request.seals = seals_by_request.get(request.name, [])
		request.assigned_technician_name = technician_names.get(
			request.assigned_technician, request.assigned_technician
		)

	return {"requests": requests}
