# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.search import validate_and_sanitize_search_inputs
from frappe.model.document import Document
from frappe.utils import cint, cstr, get_datetime, getdate, now_datetime, today

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	journey_request_for_seal_journey,
	set_journey_status,
	sync_seal_journey_mirror,
	sync_seal_journey_pre_tagging,
)
from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	journey_start_custody,
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
	# Terminal, and distinct from "Seal Returned": the seal was unlocked remotely
	# at a far destination and stayed fitted to the vehicle, so the request closes
	# without a collection or a warehouse hop. See close_for_retained_seal.
	"Closed - Seal Retained",
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
		# The checklist is shared, so every vehicle's Seal Journey mirrors it.
		for journey in {r.seal_journey for r in (self.vehicles or []) if r.seal_journey} or (
			{self.journey_reference} if self.journey_reference else set()
		):
			sync_seal_journey_pre_tagging(journey, self)

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
		self.validate_journey_type()

	def validate_journey_type(self):
		"""Journey Type picks which of the customer's rate sets bills this
		journey (see billing.resolve_customer_billing), so it can only be set to
		a type that customer actually has rates for. The form's own dropdown is
		already narrowed to those (see get_available_journey_types); this is the
		server-side guard for API callers and for a type that was valid when the
		request was raised but has since lost its rates."""
		if not self.journey_type:
			return

		available = get_available_journey_types(self.client_name)
		if self.journey_type in available:
			return

		frappe.throw(
			_(
				"{0} journeys are not configured for {1}. Set the Import/Export rates from "
				"Current Customer List → Set Billing (and have them approved) before raising "
				"an {0} journey request."
			).format(self.journey_type, self.client_name or _("this customer")),
			title=_("Journey Type Not Available"),
		)

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
		for fieldname in _locked_fields_for_doc(roles, previous):
			if self._field_changed(previous, fieldname):
				frappe.throw(
					_("You cannot change {0} at the {1} stage.").format(
						_(_FIELD_LABELS.get(fieldname, fieldname)), _(status)
					),
					title=_("Not Permitted"),
				)
		self._enforce_vehicle_seals_frozen(previous)

	def _enforce_vehicle_seals_frozen(self, previous):
		"""Once a vehicle leaves Draft its seals are fixed — otherwise amending a
		returned sibling could quietly re-fit an approved vehicle's seals."""
		if len(_live_rows(previous)) < 2:
			return
		for row in _live_rows(previous):
			if row.status == "Draft":
				continue
			if _vehicle_seal_signature(previous, row) != _vehicle_seal_signature(self, row):
				frappe.throw(
					_("Seals for {0} cannot be changed at the {1} stage.").format(
						_row_label(row), _(row.status)
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

		live_rows = _live_rows(self)
		if len(live_rows) > 1:
			labels = set()
			for row in live_rows:
				labels |= {row.name, row.vehicle, row.registration_number} - {None, ""}
			for seal in self.seals:
				if seal.vehicle and seal.vehicle not in labels:
					frappe.throw(
						_("Seal {0} is fitted to {1}, which is not on this journey request.").format(
							seal.seal_device, seal.vehicle
						),
						title=_("Invalid Vehicle"),
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


def _vehicle_seal_signature(doc, row):
	return tuple((seal.seal_device, seal.tag_status) for seal in _row_seals(doc, row))


def _locked_fields_for_doc(roles, doc):
	"""A multi-vehicle request holds vehicles at different stages, so a field is only
	locked when it is locked at every stage present."""
	statuses = {r.status for r in _live_rows(doc)}
	if len(statuses) < 2:
		return _locked_fields_for(roles, doc.journey_request_status)
	locked = None
	for status in statuses:
		fields = _locked_fields_for(roles, status)
		locked = fields if locked is None else locked & fields
	return locked


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


def _notify_technician_control_room_decision(doc, approved, remarks=None):
	"""Tell the Field Technician the Control Room returned their submission for
	amendment (there is no notification on approval — the technician sees the
	status change to Tagging directly)."""
	from tnt_seal_management.tnt_seal_management.api.notifications import notify_users

	if approved or not doc.assigned_technician:
		return

	email = frappe.db.get_value("User", doc.assigned_technician, "email")
	subject = _("Journey Request Returned for Amendment: {0}").format(doc.name)
	lines = [
		_("The Control Room returned {0} for amendment.").format(doc.name),
		_("Correct the details and resubmit to the Control Room."),
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
		subject = _("Seal Return Returned for Amendment: {0}").format(doc.name)
		lines = [
			_("The PCB Team Leader returned the seal return for {0} for amendment.").format(doc.name),
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


def _row_label(row):
	return row.registration_number or row.vehicle or row.name


def _append_approval_log(doc, action, remarks=None, vehicle=None):
	doc.append(
		"approval_log",
		{
			"action": action,
			"action_by": frappe.session.user,
			"action_date_time": now_datetime(),
			"remarks": remarks,
			"vehicle": vehicle,
		},
	)
	if cstr(remarks).strip():
		doc.append("remarks_log", {"remarks": cstr(remarks).strip()})
		doc.flags.allow_remarks_log_append = True


def _target_vehicle_rows(doc, vehicle_row, status):
	"""Vehicle rows an approval action applies to: the one named row, or — when no
	row is named — every row currently in `status`. Empty for legacy requests that
	predate per-vehicle rows, which fall back to whole-document behaviour."""
	if not doc.vehicles:
		return []
	if vehicle_row in ("", "null", "undefined"):
		vehicle_row = None
	if vehicle_row:
		row = next((r for r in doc.vehicles if r.name == vehicle_row), None)
		if not row:
			frappe.throw(_("Vehicle row {0} is not on this journey request.").format(vehicle_row))
		if row.status != status:
			frappe.throw(
				_("{0} is not {1}.").format(_row_label(row), _(status)),
				title=_("Invalid Status"),
			)
		return [row]
	rows = [r for r in doc.vehicles if r.status == status]
	if not rows:
		frappe.throw(
			_("No vehicles on this journey request are {0}.").format(_(status)),
			title=_("Invalid Status"),
		)
	return rows


STAGE_ORDER = (
	"Draft",
	"Pending Control Room Approval",
	"Tagging",
	"Journey Ready",
	"Untagging",
	"Awaiting Seal Return",
	"Pending Seal Return Approval",
	"Seal Returned",
	"Closed - Seal Retained",
)


def _live_rows(doc):
	return [r for r in (doc.get("vehicles") or []) if r.status != "Cancelled"]


def _roll_up_status(doc):
	"""Document-level status from the vehicle rows. Still Pending while any vehicle
	awaits the Control Room (so the request stays in that queue); otherwise the
	least-advanced vehicle's stage. Each stage action is keyed off the vehicle's own
	status, so this is display and lock context only — vehicles progress
	independently."""
	statuses = [r.status for r in _live_rows(doc)]
	if not statuses:
		return
	if "Pending Control Room Approval" in statuses:
		doc.journey_request_status = "Pending Control Room Approval"
	else:
		doc.journey_request_status = min(statuses, key=STAGE_ORDER.index)


def _row_seals(doc, row):
	"""Seal rows fitted to a vehicle. A single-vehicle request owns every seal; on a
	multi-vehicle request each seal names its vehicle."""
	if len(_live_rows(doc)) <= 1:
		return list(doc.seals)
	labels = {row.name, row.vehicle, row.registration_number} - {None, ""}
	return [seal for seal in doc.seals if seal.vehicle in labels]


def _journey_names(rows):
	return [r.seal_journey for r in rows if r.seal_journey]


@frappe.whitelist()
def submit_to_control_room(docname, vehicle_rows=None):
	"""Submit to the Control Room — every Draft vehicle, or only those named in
	`vehicle_rows` (Journey Request Vehicle row names, list or JSON list). Vehicles
	left out stay Draft and can be submitted later."""
	doc = _get_journey_request(docname)
	# The browser sends an omitted/null argument as an empty string.
	if isinstance(vehicle_rows, str):
		vehicle_rows = frappe.parse_json(vehicle_rows) if vehicle_rows.strip() not in ("", "null") else None

	if doc.vehicles:
		draft_rows = [r for r in doc.vehicles if r.status == "Draft"]
		if not draft_rows:
			frappe.throw(
				_("No vehicles on this journey request are in Draft."),
				title=_("Invalid Status"),
			)
		if vehicle_rows:
			chosen = set(vehicle_rows)
			unknown = chosen - {r.name for r in draft_rows}
			if unknown:
				frappe.throw(
					_("Only vehicles in Draft can be submitted to the Control Room."),
					title=_("Invalid Status"),
				)
			draft_rows = [r for r in draft_rows if r.name in chosen]
		submitted_rows = draft_rows
	elif doc.journey_request_status != "Draft":
		frappe.throw(
			_("Only draft journey requests can be submitted to the Control Room."),
			title=_("Invalid Status"),
		)
	else:
		submitted_rows = []

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

	live_rows = _live_rows(doc)
	if len(live_rows) > 1:
		if any(not seal.vehicle for seal in doc.seals):
			frappe.throw(
				_("Choose the vehicle each seal is fitted to before submitting."),
				title=_("Seal Vehicle Required"),
			)
		for row in submitted_rows:
			if not _row_seals(doc, row):
				frappe.throw(
					_("Fit at least one seal to {0} before submitting.").format(_row_label(row)),
					title=_("Seals Required"),
				)

	# Only the chosen Draft vehicles go up for review — ones already approved stay
	# approved, and ones left out stay Draft.
	for row in submitted_rows:
		row.status = "Pending Control Room Approval"
		_append_approval_log(doc, "Submitted to Control Room", vehicle=_row_label(row))
	if submitted_rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Pending Control Room Approval"
		_append_approval_log(doc, "Submitted to Control Room")
	doc.flags.ignore_field_locks = True
	doc.save()
	for journey in _journey_names(submitted_rows) or [doc.journey_reference]:
		set_journey_status(journey, "Pre-Tagging")
		sync_seal_journey_mirror(journey)

	# First recorded custody hop of the journey: seals leave the warehouse and are
	# handed to the Field Technician who submitted them. The origin is the seal's
	# last known warehouse (where it was returned to on its previous journey), or
	# the customer still holding it if the last journey ended with the seal left on
	# the vehicle — see journey_start_custody. Blank if this is the seal's first
	# cycle, since there's nothing to reference yet.
	if doc.assigned_technician:
		for vehicle_row in submitted_rows or [None]:
			journey = vehicle_row.seal_journey if vehicle_row else doc.journey_reference
			seals = _row_seals(doc, vehicle_row) if vehicle_row else doc.seals
			for row in seals:
				origin_warehouse = journey_start_custody(row.seal_device, exclude_journey=journey)
				if origin_warehouse:
					record_journey_custody(row.seal_device, journey, "start_warehouse", origin_warehouse)
				set_seal_custody(
					row.seal_device,
					"User",
					doc.assigned_technician,
					remarks=f"Submitted to Control Room via Journey Request {doc.name}",
					journey=journey,
					column="tagging_to",
				)

	_notify_control_room_approval_pending(doc)
	frappe.db.commit()


@frappe.whitelist()
def approve_by_control_room(docname, remarks=None, vehicle_row=None):
	"""Approve one vehicle (`vehicle_row` = its Journey Request Vehicle row name) or,
	with no row named, every vehicle still pending."""
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

	rows = _target_vehicle_rows(doc, vehicle_row, "Pending Control Room Approval")
	now = now_datetime()
	for row in rows:
		row.status = "Tagging"
		row.control_room_approver = frappe.session.user
		row.control_room_approval_date_time = now
		row.control_room_remarks = remarks
		_append_approval_log(doc, "Control Room Approved", remarks, vehicle=_row_label(row))
	if not rows:
		_append_approval_log(doc, "Control Room Approved", remarks)
		doc.journey_request_status = "Tagging"
	else:
		_roll_up_status(doc)

	doc.control_room_approver = frappe.session.user
	doc.control_room_approval_date_time = now
	doc.control_room_remarks = remarks
	doc.flags.ignore_field_locks = True
	doc.save()
	for journey in _journey_names(rows) or [doc.journey_reference]:
		set_journey_status(journey, "Tagging In Progress")
		sync_seal_journey_mirror(journey)
	frappe.db.commit()


@frappe.whitelist()
def return_for_amendment_by_control_room(docname, remarks=None, vehicle_row=None):
	"""Control Room kickback — hands the request (or just one vehicle on it, when
	`vehicle_row` is given) back to the Field Technician, editable again from Draft,
	so it can be corrected (e.g. swap a seal, fix the file/departure numbers) and
	resubmitted."""
	_ensure_role(
		"Operations Control Room",
		_("Only the Operations Control Room can return a request for amendment."),
	)
	doc = _get_journey_request(docname)
	if doc.journey_request_status != "Pending Control Room Approval":
		frappe.throw(
			_("Only journey requests pending Control Room approval can be returned for amendment."),
			title=_("Invalid Status"),
		)

	remarks = cstr(remarks).strip()
	if not remarks:
		frappe.throw(
			_("Enter what needs to be amended before returning this request."),
			title=_("Remarks Required"),
		)

	rows = _target_vehicle_rows(doc, vehicle_row, "Pending Control Room Approval")
	now = now_datetime()
	for row in rows:
		row.status = "Draft"
		row.control_room_approver = frappe.session.user
		row.control_room_approval_date_time = now
		row.control_room_remarks = remarks
		_append_approval_log(doc, "Returned for Amendment", remarks, vehicle=_row_label(row))
	if not rows:
		_append_approval_log(doc, "Returned for Amendment", remarks)
		doc.journey_request_status = "Draft"
	else:
		_roll_up_status(doc)

	doc.control_room_approver = frappe.session.user
	doc.control_room_approval_date_time = now
	doc.control_room_remarks = remarks
	doc.flags.ignore_field_locks = True
	doc.save()
	# Leave the Seal Journey's stage status untouched and only mirror the
	# amendment remarks/approver through for visibility.
	_notify_technician_control_room_decision(doc, approved=False, remarks=remarks)
	for journey in _journey_names(rows) or [doc.journey_reference]:
		sync_seal_journey_mirror(journey)
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
def complete_tagging(
	docname, vehicle_row=None, tagging_confirmed=None, actual_tagging_date_time=None, tagging_remarks=None
):
	"""Complete tagging for one vehicle (`vehicle_row`) or, with none named, every
	vehicle the Control Room has approved. On a multi-vehicle request the
	confirmation, tagging time and remarks are given per call and stored on each
	vehicle; a single-vehicle request keeps using the form's own fields."""
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
	if doc.vehicles:
		rows = _target_vehicle_rows(doc, vehicle_row, "Tagging")
	else:
		rows = []
		if doc.journey_request_status != "Tagging":
			frappe.throw(
				_("Tagging can only be completed after Control Room approval."),
				title=_("Invalid Status"),
			)
	multi = len(_live_rows(doc)) > 1
	if not (cint(tagging_confirmed) if multi else (cint(tagging_confirmed) or cint(doc.tagging_completed))):
		frappe.throw(
			_("Confirm you have finished tagging."),
			title=_("Confirmation Required"),
		)
	if not doc.tagging_photos:
		frappe.throw(
			_("Attach at least one tagging evidence photo before completing."),
			title=_("Evidence Required"),
		)

	targets = rows or [None]
	target_seals = []
	for row in targets:
		seals = _row_seals(doc, row) if row else list(doc.seals)
		if row and not seals:
			frappe.throw(
				_("No seals are fitted to {0}.").format(_row_label(row)),
				title=_("Seals Required"),
			)
		target_seals.append(seals)

	if multi:
		tagged_at = get_datetime(actual_tagging_date_time) if actual_tagging_date_time else now_datetime()
		tagged_remarks = cstr(tagging_remarks).strip() or None
	else:
		tagged_at = doc.actual_tagging_date_time or now_datetime()
		tagged_remarks = doc.tagging_remarks
	doc.actual_tagging_date_time = tagged_at
	doc.tagging_completed = 1
	if multi:
		doc.tagging_remarks = tagged_remarks

	# Tagging completion is the last gate before the journey starts — there is no
	# downstream Customer Care approval, so the technician's confirmation both
	# closes tagging and puts the Seal Journey In Transit.
	# Doubles as the departure confirmation mirrored onto the Seal Journey.
	doc.approval_date_time = now_datetime()
	finished = []
	for row, seals in zip(targets, target_seals):
		for seal in seals:
			seal.tag_status = "Tagged"
		# Location is read from this vehicle's own seals, so each vehicle records
		# where it was actually tagged.
		doc.tagging_location = _pull_tagging_location(doc, seals) or doc.tagging_location
		if row:
			row.status = "Journey Ready"
			row.tagging_completed = 1
			row.actual_tagging_date_time = tagged_at
			row.tagging_location = doc.tagging_location
			row.tagging_remarks = tagged_remarks
		_append_approval_log(doc, "Tagging Completed", tagged_remarks, vehicle=_row_label(row) if row else None)
		seal_journey = _finalize_seal_journey_from_request(doc, row)
		if not row:
			doc.journey_reference = seal_journey.name
		finished.append((row, seal_journey, seals))

	if rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Journey Ready"
	doc.flags.ignore_field_locks = True
	doc.save()

	for row, seal_journey, seals in finished:
		# _finalize sets the In Transit status + child tables; mirror fills the
		# remaining tagging detail from the now-saved request.
		sync_seal_journey_mirror(seal_journey.name)

		for seal in seals:
			update = {
				"current_status": "Assigned",
				"current_journey_request": doc.name,
				"current_journey": seal_journey.name,
			}
			if doc.assigned_technician:
				update["current_technician"] = doc.assigned_technician
			vehicle_label = _row_label(row) if row else doc.vehicle
			if vehicle_label:
				update["current_vehicle"] = vehicle_label
			if doc.container_number:
				update["current_container"] = doc.container_number
			frappe.db.set_value("Seal Device", seal.seal_device, update)
			# The tagging handoff to the technician was already recorded when the seals
			# were submitted to the Control Room (see submit_to_control_room). Completing
			# tagging puts the seal In Transit, attached to the customer's movement, so
			# custody now passes to the customer for the trip (the "customer" hop).
			if seal_journey.customer:
				set_seal_custody(
					seal.seal_device,
					"Customer",
					seal_journey.customer,
					remarks=f"In transit with customer via Journey Request {doc.name}",
					journey=seal_journey.name,
					column="customer",
				)
			elif not doc.assigned_technician and doc.job_order:
				# Fallback for a technician-less job order: custody stays with the order.
				set_seal_custody(
					seal.seal_device,
					"PCB Job Order",
					doc.job_order,
					remarks=f"Assigned via Journey Request {doc.name}",
					journey=seal_journey.name,
				)

	frappe.db.commit()
	return {
		"seal_journey": finished[0][1].name,
		"seal_journeys": [journey.name for _row, journey, _seals in finished],
	}


def _pull_tagging_location(doc, seals=None):
	"""Fetch live GPS for the journey's seals and return the first location found.

	Tagging location is evidence, not an attested action, so it is captured from
	the seal device's own GPS (via sync_seal_device) rather than typed in by the
	technician — removes the chance of a fudged or skipped location at the one
	moment (tagging completion) it matters most for audit."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	for row in doc.seals if seals is None else seals:
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
def confirm_untagging(docname, manual_location=None, remarks=None, vehicle_row=None):
	"""Complete untagging and open the seal-return phase — for one vehicle
	(`vehicle_row`) or every vehicle in the Untagging stage.

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
	if doc.vehicles:
		rows = _target_vehicle_rows(doc, vehicle_row, "Untagging")
	else:
		rows = []
		if doc.journey_request_status != "Untagging":
			frappe.throw(
				_("Only journey requests in the Untagging stage can be confirmed."),
				title=_("Invalid Status"),
			)
	targets = rows or [None]
	target_seals = [(_row_seals(doc, row) if row else list(doc.seals)) for row in targets]

	location = _pull_untagging_location(doc, [s for group in target_seals for s in group])
	manual_location = cstr(manual_location).strip()
	if not location and not manual_location:
		return {"requires_manual_location": True}

	now = now_datetime()
	doc.actual_untagging_date_time = doc.actual_untagging_date_time or now
	doc.untagging_location = location or manual_location[:140]
	doc.untagging_completed = 1
	for row in targets:
		if row:
			row.status = "Awaiting Seal Return"
			row.actual_untagging_date_time = now
			row.untagging_location = doc.untagging_location
		_append_approval_log(
			doc, "Untagging Confirmed", cstr(remarks).strip() or None, vehicle=_row_label(row) if row else None
		)
	if rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Awaiting Seal Return"
	doc.flags.ignore_field_locks = True
	doc.save()

	for row, seals in zip(targets, target_seals):
		journey = row.seal_journey if row else doc.journey_reference
		if doc.assigned_technician:
			for seal in seals:
				if not seal.seal_device:
					continue
				set_seal_custody(
					seal.seal_device,
					"User",
					doc.assigned_technician,
					remarks="Retained custody after untagging for seal return",
					journey=journey,
					column="seal_return_to",
				)

		set_journey_status(
			journey,
			"Awaiting Seal Return",
			{
				"untagging_status": "Completed",
				"untagging_completed_date_time": row.actual_untagging_date_time if row else doc.actual_untagging_date_time,
				"untagging_confirmation": 1,
			},
		)
		sync_seal_journey_mirror(journey)
	frappe.db.commit()
	return {"requires_manual_location": False, "location": doc.untagging_location}


def _pull_untagging_location(doc, seals=None):
	"""Fetch live GPS for the journey seals when the technician confirms untagging."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	for row in doc.seals if seals is None else seals:
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
def confirm_seal_return(
	docname,
	manual_location=None,
	remarks=None,
	vehicle_row=None,
	seal_return_confirmed=None,
	seal_return_condition=None,
	retrieval_card_number=None,
	return_warehouse=None,
):
	"""Complete the seal return directly from the assigned Field Technician — for
	one vehicle (`vehicle_row`) or every vehicle awaiting seal return. On a
	multi-vehicle request the confirmation, condition, retrieval card and warehouse
	are supplied per call (so one vehicle's values never stand in for another's);
	a single-vehicle request keeps using the form's own fields."""
	_ensure_role(
		"Field Technician",
		_("Only the assigned Field Technician can confirm the seal return."),
	)
	doc = _get_journey_request(docname)
	is_admin = "System Manager" in set(frappe.get_roles()) or frappe.session.user == "Administrator"
	if doc.vehicles:
		rows = _target_vehicle_rows(doc, vehicle_row, "Awaiting Seal Return")
	else:
		rows = []
		if doc.journey_request_status != "Awaiting Seal Return":
			frappe.throw(
				_("Only journey requests awaiting seal return can be confirmed."),
				title=_("Invalid Status"),
			)
	targets = rows or [None]
	target_seals = [(_row_seals(doc, row) if row else list(doc.seals)) for row in targets]

	if not is_admin and doc.assigned_technician != frappe.session.user:
		doc.assigned_technician = frappe.session.user
		for row, seals in zip(targets, target_seals):
			for seal in seals:
				if not seal.seal_device:
					continue
				record_journey_custody(
					seal.seal_device,
					row.seal_journey if row else doc.journey_reference,
					"seal_return_to",
					frappe.session.user,
					remarks="Taken over by this technician for seal return",
				)
	if len(_live_rows(doc)) > 1:
		doc.seal_return_confirmed_by_technician = cint(seal_return_confirmed)
		doc.seal_return_condition = seal_return_condition
		doc.retrieval_card_number = retrieval_card_number
		doc.return_warehouse = return_warehouse
	else:
		if cint(seal_return_confirmed):
			doc.seal_return_confirmed_by_technician = 1
		doc.seal_return_condition = seal_return_condition or doc.seal_return_condition
		doc.retrieval_card_number = retrieval_card_number or doc.retrieval_card_number
		doc.return_warehouse = return_warehouse or doc.return_warehouse
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

	location = _pull_seal_return_location(doc, [s for group in target_seals for s in group])
	manual_location = cstr(manual_location).strip()
	if not location and not manual_location:
		return {"requires_manual_location": True}

	now = now_datetime()
	doc.actual_seal_return_date_time = now
	doc.seal_return_location = location or manual_location[:140]
	for row in targets:
		if row:
			# The stage fields above are shared across the request, so snapshot them
			# onto the vehicle — a later vehicle's return must not rewrite this one's.
			row.status = "Pending Seal Return Approval"
			row.seal_return_condition = doc.seal_return_condition
			row.retrieval_card_number = doc.retrieval_card_number
			row.return_warehouse = doc.return_warehouse
			row.seal_return_location = doc.seal_return_location
			row.actual_seal_return_date_time = now
		vehicle = _row_label(row) if row else None
		_append_approval_log(doc, "Seal Return Confirmed", cstr(remarks).strip() or None, vehicle=vehicle)
		_append_approval_log(doc, "Seal Return Submitted for Approval", vehicle=vehicle)
	# The physical return is done, but the seal only goes back into the pool once
	# the PCB Team Leader approves it — see approve_seal_return.
	if rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Pending Seal Return Approval"
	doc.flags.ignore_field_locks = True
	doc.save()

	_notify_seal_return_approval_pending(doc)
	for row in targets:
		sync_seal_journey_mirror(row.seal_journey if row else doc.journey_reference)
	frappe.db.commit()
	return {
		"requires_manual_location": False,
		"location": doc.seal_return_location,
		"pending_approval": True,
	}


@frappe.whitelist()
def approve_seal_return(docname, remarks=None, vehicle_row=None):
	"""PCB Team Leader approval of a seal return the Field Technician confirmed —
	for one vehicle (`vehicle_row`) or every vehicle pending approval.

	This is the point at which the return actually takes effect: the journey is
	completed, the seals go back into the pool (or stay out if returned Damaged
	or Lost) and custody moves to the return warehouse."""
	_ensure_role(
		PCB_TEAM_LEAD_ROLE,
		_("Only the PCB Team Leader can approve a seal return."),
	)
	doc = _get_journey_request(docname)
	if doc.vehicles:
		rows = _target_vehicle_rows(doc, vehicle_row, "Pending Seal Return Approval")
	else:
		rows = []
		if doc.journey_request_status != "Pending Seal Return Approval":
			frappe.throw(
				_("Only journey requests pending seal return approval can be approved."),
				title=_("Invalid Status"),
			)

	remarks = cstr(remarks).strip()
	now = now_datetime()
	doc.seal_return_approver = frappe.session.user
	doc.seal_return_approval_date_time = now
	doc.seal_return_approval_remarks = remarks or None
	for row in rows:
		row.status = "Seal Returned"
		row.seal_return_approver = frappe.session.user
		row.seal_return_approval_date_time = now
		row.seal_return_approval_remarks = remarks or None
		_append_approval_log(doc, "Seal Return Approved", remarks or None, vehicle=_row_label(row))
	if rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Seal Returned"
		_append_approval_log(doc, "Seal Return Approved", remarks or None)
	doc.seal_returned = 1 if doc.journey_request_status == "Seal Returned" else 0
	doc.flags.ignore_field_locks = True
	doc.save()

	for row in rows or [None]:
		_finalise_seal_return(doc, remarks, row)
		sync_seal_journey_mirror(row.seal_journey if row else doc.journey_reference)
	_notify_technician_seal_return_decision(doc, approved=True, remarks=remarks)
	frappe.db.commit()
	return {"journey_request_status": doc.journey_request_status}


@frappe.whitelist()
def return_seal_return_for_amendment(docname, remarks=None, vehicle_row=None):
	"""PCB Team Leader kickback — hands the request (or one vehicle on it) back to
	the Field Technician so the return evidence can be corrected and re-confirmed."""
	_ensure_role(
		PCB_TEAM_LEAD_ROLE,
		_("Only the PCB Team Leader can return a seal return for amendment."),
	)
	doc = _get_journey_request(docname)
	if doc.vehicles:
		rows = _target_vehicle_rows(doc, vehicle_row, "Pending Seal Return Approval")
	else:
		rows = []
		if doc.journey_request_status != "Pending Seal Return Approval":
			frappe.throw(
				_("Only journey requests pending seal return approval can be returned for amendment."),
				title=_("Invalid Status"),
			)

	remarks = cstr(remarks).strip()
	if not remarks:
		frappe.throw(
			_("Enter what needs to be amended before returning the seal return."),
			title=_("Remarks Required"),
		)

	now = now_datetime()
	doc.seal_return_approver = frappe.session.user
	doc.seal_return_approval_date_time = now
	doc.seal_return_approval_remarks = remarks
	# Back to the seal-return work window, with the technician's confirmation
	# cleared so the return has to be deliberately re-confirmed.
	doc.seal_return_confirmed_by_technician = 0
	for row in rows:
		row.status = "Awaiting Seal Return"
		row.seal_return_approver = frappe.session.user
		row.seal_return_approval_date_time = now
		row.seal_return_approval_remarks = remarks
		_append_approval_log(doc, "Seal Return Returned for Amendment", remarks, vehicle=_row_label(row))
	if rows:
		_roll_up_status(doc)
	else:
		doc.journey_request_status = "Awaiting Seal Return"
		_append_approval_log(doc, "Seal Return Returned for Amendment", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()

	_notify_technician_seal_return_decision(doc, approved=False, remarks=remarks)
	for row in rows or [None]:
		sync_seal_journey_mirror(row.seal_journey if row else doc.journey_reference)
	frappe.db.commit()
	return {"journey_request_status": doc.journey_request_status}


def _finalise_seal_return(doc, remarks=None, row=None):
	"""Apply the effects of an approved seal return: complete the journey, put the
	seals back in the pool and move custody to the return warehouse. With a vehicle
	row, acts on that vehicle's Seal Journey and seals using the values snapshotted
	on the row when its return was confirmed."""
	journey = row.seal_journey if row else doc.journey_reference
	seals = _row_seals(doc, row) if row else list(doc.seals)
	condition = (row.seal_return_condition if row else None) or doc.seal_return_condition
	location = (row.seal_return_location if row else None) or doc.seal_return_location
	returned_at = (row.actual_seal_return_date_time if row else None) or doc.actual_seal_return_date_time
	return_warehouse = (row.return_warehouse if row else None) or doc.return_warehouse

	set_journey_status(journey, "Completed", {"completion_date_time": returned_at})
	# The return warehouse is the one the technician selects on the Journey Request
	# (there is no configured main warehouse). Logged with the GPS location that was
	# captured at return, in brackets, for auditability — e.g.
	# "Nanak warehouse - TD (-1.30, 36.81)". If no warehouse was selected, the
	# return warehouse column stays blank for now and gets logged on the next cycle.
	warehouse_label = None
	if return_warehouse:
		wh_name = frappe.db.get_value("Warehouse", return_warehouse, "warehouse_name") or return_warehouse
		warehouse_label = f"{wh_name} ({location})" if location else wh_name
	# A returned seal goes straight back into the pool — there is no separate
	# "Returned" resting status. Only a bad condition on return keeps it out.
	returned_status = condition if condition in ("Damaged", "Lost") else "Available"
	for seal in seals:
		if not seal.seal_device:
			continue
		frappe.db.set_value(
			"Seal Device",
			seal.seal_device,
			{
				"current_status": returned_status,
				"condition": condition,
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
				seal.seal_device,
				"Warehouse",
				return_warehouse,
				remarks=f"Returned via Journey Request {doc.name}",
				journey=journey,
			)
			record_journey_custody(
				seal.seal_device,
				journey,
				"return_warehouse",
				warehouse_label,
				# Whatever the approver typed when approving the return, if
				# anything — the warehouse itself is already in the column.
				remarks=cstr(remarks).strip() or None,
			)

	_copy_seal_return_evidence_to_journey(doc, journey)


def close_for_retained_seal(seal_journey, remarks=None):
	"""Close out the Journey Request side of a journey whose seal was unlocked
	remotely at a far destination and left fitted to the vehicle — see
	SealJourney.confirm_arrival with unlock_method="remote_retained".

	There is no untagging, no collection and no warehouse hop: the driver keeps
	the seal on the vehicle for the trip home, and the system has no way to know
	when that vehicle re-enters the country. So the vehicle closes at
	"Closed - Seal Retained" and the seal goes straight back into the pool as
	Available, ready for the next Tagging Booking to pick it up. Custody
	deliberately stays with the customer — they are still physically holding it —
	and the normal warehouse flow resumes at that next booking.

	Returns the Journey Request name, or None for a journey with no request."""
	jr_name = journey_request_for_seal_journey(seal_journey)
	if not jr_name:
		return None

	doc = frappe.get_doc("Journey Request", jr_name)
	row = next(
		(r for r in _live_rows(doc) if r.seal_journey == seal_journey),
		None,
	)
	remarks = cstr(remarks).strip() or None

	if row:
		row.status = "Closed - Seal Retained"
		_roll_up_status(doc)
		_append_approval_log(doc, "Journey Closed - Seal Retained", remarks, vehicle=_row_label(row))
	else:
		doc.journey_request_status = "Closed - Seal Retained"
		_append_approval_log(doc, "Journey Closed - Seal Retained", remarks)
	doc.flags.ignore_field_locks = True
	doc.save()

	_release_retained_seals(doc, row, seal_journey, remarks)
	frappe.db.commit()
	return doc.name


def _release_retained_seals(doc, row, seal_journey, remarks=None):
	"""Put the seals of a retained-seal closure back into the assignable pool.

	Mirrors the seal half of _finalise_seal_return with two deliberate
	differences: the condition is left as it stands (nobody has inspected the
	seal — it is still out there), and the custody pointer is NOT moved to a
	warehouse, because the customer still holds it. The journey's custody row is
	closed on the seal_return_to column instead, so the trail reads "retained by
	client" rather than silently ending."""
	customer = frappe.db.get_value("Seal Journey", seal_journey, "customer")
	# The custody trail reads in display names, not link ids — same as every other
	# hop recorded on the row (see seal_device._custodian_name).
	customer_label = (
		frappe.db.get_value("Customer", customer, "customer_name") or customer
	) if customer else None
	retained_to = _("Retained by client{0}").format(f": {customer_label}" if customer_label else "")

	for seal in _row_seals(doc, row) if row else list(doc.seals):
		if not seal.seal_device:
			continue
		frappe.db.set_value(
			"Seal Device",
			seal.seal_device,
			{
				"current_status": "Available",
				"current_journey": None,
				"current_journey_request": None,
				"current_technician": None,
				# The container was dropped at the destination; the seal rides home
				# on the same vehicle, so that pointer stays until the next tagging.
				"current_container": None,
			},
		)
		# Pin custody to the customer explicitly rather than trusting whatever the
		# last hop left behind: they are demonstrably still holding the seal, and
		# journey_start_custody reads this pointer to decide where the seal's NEXT
		# journey starts from.
		if customer:
			set_seal_custody(
				seal.seal_device,
				"Customer",
				customer,
				remarks=remarks,
				journey=seal_journey,
			)
		record_journey_custody(
			seal.seal_device,
			seal_journey,
			"seal_return_to",
			retained_to,
			remarks=remarks,
		)


def _copy_seal_return_evidence_to_journey(doc, journey_name=None):
	"""Mirror the seal-return evidence photo tables from the Journey Request onto
	the linked Seal Journey's Seal Return tab, so the return evidence is visible
	from the journey itself. Same Seal Trip Photo child shape on both sides."""
	journey_name = journey_name or doc.journey_reference
	if not journey_name or not frappe.db.exists("Seal Journey", journey_name):
		return

	journey = frappe.get_doc("Seal Journey", journey_name)
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


def _pull_seal_return_location(doc, seals=None):
	"""Fetch live or stored seal GPS when the technician confirms the return."""
	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	fallback = None
	for row in doc.seals if seals is None else seals:
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


def _finalize_seal_journey_from_request(jr, row=None):
	"""Populate and start the Seal Journey for an approved Journey Request.

	Reuses the Seal Journey created when the Tagging Booking was first saved
	(linked via ``jr.journey_reference``). Falls back to creating one for legacy
	requests that have no linked journey."""
	# vehicle is plain text carried over from the Tagging Booking — the Field
	# Technician has no access to the Vehicle doctype, so there is no record to
	# resolve a registration number from.
	# With a vehicle row (multi-vehicle request) only that vehicle's plate, journey
	# and seals apply.
	vehicle_plate = _row_label(row) if row else jr.vehicle
	journey_name = row.seal_journey if row else jr.journey_reference
	seal_rows = _row_seals(jr, row) if row else jr.seals

	if journey_name and frappe.db.exists("Seal Journey", journey_name):
		journey = frappe.get_doc("Seal Journey", journey_name)
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
			"tagging_date_time": (row.actual_tagging_date_time if row else None) or jr.actual_tagging_date_time,
			"tagging_remarks": (row.tagging_remarks if row and row.actual_tagging_date_time else jr.tagging_remarks),
			"seal_attached_confirmation": 1,
			"post_tagging_status": "Completed",
			"journey_readiness": 1,
			"journey_start_date_time": now_datetime(),
		}
	)

	journey.set("journey_seals", [])
	first_seal = None
	for seal in seal_rows:
		if not first_seal:
			first_seal = seal.seal_device
		journey.append(
			"journey_seals",
			{
				"seal_device": seal.seal_device,
				"seal_number": seal.seal_number,
				"serial_number": seal.serial_number,
				"tag_status": "Tagged",
				"lock_status": seal.lock_status,
				"api_device_status": seal.api_device_status,
				"api_location": seal.api_location,
				"battery_level": seal.battery_level,
				"api_last_update_time": seal.api_last_update_time,
			},
		)

	if first_seal:
		journey.assigned_seal = first_seal
		journey.proposed_seal = first_seal

	journey.set("photos", [])
	own_devices = {seal.seal_device for seal in seal_rows}
	for photo in jr.tagging_photos:
		# Photos are shared across the request; on a multi-vehicle one keep only
		# those tied to this vehicle's seals or to none in particular.
		if row and len(_live_rows(jr)) > 1 and photo.related_seal and photo.related_seal not in own_devices:
			continue
		journey.append(
			"photos",
			{
				"photo_type": photo.photo_type,
				"photo_attachment": photo.photo_attachment,
				"uploaded_by": photo.uploaded_by,
				"upload_date_time": photo.upload_date_time,
				"remarks": photo.remarks,
				"related_seal": photo.related_seal,
			},
		)

	journey.save(ignore_permissions=True) if not journey.is_new() else journey.insert(
		ignore_permissions=True, ignore_mandatory=True
	)
	return journey


# ----------------------------------------------------------------------
# Journey type / rates
# ----------------------------------------------------------------------
@frappe.whitelist()
def get_available_journey_types(customer=None):
	"""Journey Types this customer can actually be billed for.

	Rates differ by journey type, and a journey bills off the matching rate set
	(billing.resolve_customer_billing). Local is always offered — it's the
	customer's primary rate set and the historical default every journey used
	before rates were split. Import and Export are only offered once that
	customer has a usable (active + Managing-Director-approved) Import/Export
	rate set, so a journey can never be raised against rates that don't exist
	and would otherwise leave it unbillable.
	"""
	from tnt_seal_management.tnt_seal_management.billing import _import_export_rule_for

	types = ["Local"]
	if customer and _import_export_rule_for(customer):
		types += ["Import", "Export"]
	return types


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

	_check_export_permission()

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


# (label, fieldname, column width) — same columns the PDF report shows, plus the
# Journey Request ID, which is worth carrying in a spreadsheet.
_EXPORT_COLUMNS = (
	("Journey Request", "name", 22),
	("Status", "journey_request_status", 26),
	("Client Name", "client_name", 28),
	("Vehicle", "vehicle", 18),
	("Entry Number", "entry_number", 18),
	("Seal Serial Number(s)", "seal_serial_numbers", 34),
	("Origin", "origin", 22),
	("Destination", "destination", 22),
)


@frappe.whitelist()
def export_excel(search=None, status=None, from_date=None, to_date=None, filename=None):
	"""Render the Journey Request list's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	requests = get_all_journey_requests_for_export(search, status, from_date, to_date)
	if not requests:
		frappe.throw(_("No Journey Requests match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	for request in requests:
		data.append([cstr(request.get(fieldname)) for label, fieldname, width in _EXPORT_COLUMNS])

	xlsx_file = make_xlsx(
		data,
		"Journey Requests",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"Journey Request Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export journey requests."),
			frappe.PermissionError,
		)


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
def get_control_room_queue(search=None, from_date=None, to_date=None, page=1, page_length=30):
	"""Journey Requests awaiting Control Room approval of the original tagging
	proposal, with each request's full seal detail, for the Control Room page's
	Approve tab. Honours Journey Request permissions via get_list, so a Control
	Room user sees the whole queue. Search, date filter and paging are applied
	here; `total` is the filtered count and `overall` the unfiltered one."""
	return _get_approval_queue_by_status(
		"Pending Control Room Approval", search, from_date, to_date, page, page_length
	)


def _control_room_search_or_filters(search):
	"""OR filters matching a Control Room search term against the request's own
	fields, its technician's display name, and its seal rows."""
	like = f"%{search}%"
	or_filters = [
		["name", "like", like],
		["client_name", "like", like],
		["job_order", "like", like],
		["vehicle", "like", like],
		["entry_number", "like", like],
		["container_number", "like", like],
		["assigned_technician", "like", like],
	]
	seal_parents = frappe.get_all(
		"Journey Request Seal",
		or_filters=[
			["seal_number", "like", like],
			["serial_number", "like", like],
			["seal_device", "like", like],
		],
		filters={"parenttype": "Journey Request"},
		pluck="parent",
	)
	if seal_parents:
		or_filters.append(["name", "in", seal_parents])
	users = frappe.get_all("User", filters={"full_name": ["like", like]}, pluck="name", limit_page_length=50)
	if users:
		or_filters.append(["assigned_technician", "in", users])
	return or_filters


def _get_approval_queue_by_status(status, search=None, from_date=None, to_date=None, page=1, page_length=30):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length) or 30, 1), 100)
	search = (search or "").strip()

	filters = {"journey_request_status": status}
	overall = len(frappe.get_list("Journey Request", filters=filters, pluck="name", limit_page_length=0))

	filtered = [["Journey Request", "journey_request_status", "=", status]]
	if from_date:
		filtered.append(["Journey Request", "creation", ">=", f"{from_date} 00:00:00"])
	if to_date:
		filtered.append(["Journey Request", "creation", "<=", f"{to_date} 23:59:59"])
	or_filters = _control_room_search_or_filters(search) if search else None

	total = len(
		frappe.get_list(
			"Journey Request", filters=filtered, or_filters=or_filters, pluck="name", limit_page_length=0
		)
	)
	requests = frappe.get_list(
		"Journey Request",
		filters=filtered,
		or_filters=or_filters,
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
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	if not requests:
		return {"requests": [], "total": total, "overall": overall}

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

	vehicle_rows = frappe.get_all(
		"Journey Request Vehicle",
		filters={"parent": ["in", request_names], "parenttype": "Journey Request"},
		fields=["parent", "name", "vehicle", "registration_number", "seal_journey", "status", "control_room_remarks"],
		order_by="parent asc, idx asc",
	)
	vehicles_by_request = {}
	for row in vehicle_rows:
		vehicles_by_request.setdefault(row.parent, []).append(row)

	for request in requests:
		request.vehicles = vehicles_by_request.get(request.name, [])
		request.seals = seals_by_request.get(request.name, [])
		request.assigned_technician_name = technician_names.get(
			request.assigned_technician, request.assigned_technician
		)

	return {"requests": requests, "total": total, "overall": overall}
