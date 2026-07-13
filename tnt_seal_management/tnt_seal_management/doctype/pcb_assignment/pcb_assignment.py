# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, now_datetime

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
	sync_seal_journey_mirror,
)
from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	set_seal_custody,
)
from tnt_seal_management.tnt_seal_management.api.notifications import notify_users

# Assignment statuses that mean "a Field Technician has just been handed this job".
ASSIGNED_STATUSES = ("Assigned", "Untagging Assigned", "Seal Return Assigned")


def create_untagging_request(seal_journey):
	"""Raise an untagging request for an arrived Seal Journey, queued to the PCB
	Team Leader as a PCB Assignment of request_type "Untagging" — so it lands in
	their existing Assignment workspace alongside tagging assignments (one card,
	scoped to their own rows via get_permission_query_conditions). Idempotent: a
	second call for the same journey returns the existing request. Has no
	pcb_job_order (the original tagging order already owns its unique link); the
	untagging request points back at the Seal Journey instead. Called from
	SealJourney.confirm_arrival once the seal is confirmed unlocked at the
	destination. The Field Technician is assigned later, in the untagging cycle."""
	if isinstance(seal_journey, str):
		seal_journey = frappe.get_doc("Seal Journey", seal_journey)

	existing = frappe.db.get_value(
		"PCB Assignment",
		{"seal_journey": seal_journey.name, "request_type": "Untagging"},
		"name",
	)
	if existing:
		return existing

	assignment = frappe.get_doc(
		{
			"doctype": "PCB Assignment",
			"request_type": "Untagging",
			"seal_journey": seal_journey.name,
			"client_name": seal_journey.customer,
			"location": seal_journey.destination or seal_journey.origin,
			"scheduled_date_time": seal_journey.arrival_date_time or now_datetime(),
			"contact_person_name": seal_journey.contact_person_name,
			"contact_person_phone": seal_journey.contact_person_phone,
			"pcb_team_leader": seal_journey.assigned_team_lead,
			"assignment_status": "Pending Untagging Assignment",
		}
	).insert(ignore_permissions=True)

	_notify_pcb_team_leader_new_request(assignment)
	return assignment.name


def create_seal_return_request(seal_journey):
	"""Raise a seal-return request for a Seal Journey whose seal was unlocked
	REMOTELY at arrival — untagging is skipped, so the seal still has to be
	physically collected from the client. Queued to the PCB Team Leader as a PCB
	Assignment of request_type "Seal Return", mirroring create_untagging_request
	(idempotent, no pcb_job_order, points back at the Seal Journey). Called from
	SealJourney.confirm_arrival when the Control Room chooses Remote Unlock. The
	Field Technician is assigned later, in the seal-return cycle."""
	if isinstance(seal_journey, str):
		seal_journey = frappe.get_doc("Seal Journey", seal_journey)

	existing = frappe.db.get_value(
		"PCB Assignment",
		{"seal_journey": seal_journey.name, "request_type": "Seal Return"},
		"name",
	)
	if existing:
		return existing

	assignment = frappe.get_doc(
		{
			"doctype": "PCB Assignment",
			"request_type": "Seal Return",
			"seal_journey": seal_journey.name,
			"client_name": seal_journey.customer,
			"location": seal_journey.destination or seal_journey.origin,
			"scheduled_date_time": seal_journey.arrival_date_time or now_datetime(),
			"contact_person_name": seal_journey.contact_person_name,
			"contact_person_phone": seal_journey.contact_person_phone,
			"pcb_team_leader": seal_journey.assigned_team_lead,
			"assignment_status": "Pending Seal Return Assignment",
		}
	).insert(ignore_permissions=True)

	_notify_pcb_team_leader_new_request(assignment)
	return assignment.name


def _notify_pcb_team_leader_new_request(assignment):
	"""Notify the PCB Team Leader that a new request (Untagging or Seal Return)
	has landed in their Assignment queue, via desk notification and email."""
	if not assignment.pcb_team_leader:
		return

	email = frappe.db.get_value("User", assignment.pcb_team_leader, "email")
	subject = _("New {0} Request: {1}").format(assignment.request_type, assignment.name)
	lines = [
		_("A new {0} request is awaiting a Tag Operator assignment.").format(assignment.request_type),
		_("Client: {0}").format(assignment.client_name or "-"),
		_("Location: {0}").format(assignment.location or "-"),
	]
	if assignment.scheduled_date_time:
		lines.append(_("Scheduled: {0}").format(assignment.scheduled_date_time))
	message = "<br>".join(str(line) for line in lines)

	notify_users(
		[(assignment.pcb_team_leader, email or assignment.pcb_team_leader)],
		subject,
		message,
		document_type="PCB Assignment",
		document_name=assignment.name,
		link=f"/app/pcb-assignment/{assignment.name}",
	)


class PCBAssignment(Document):
	def validate(self):
		self._validate_field_technician_role()
		self._auto_progress_untagging_status()
		self._auto_progress_seal_return_status()

	def on_update(self):
		"""Untagging/Seal Return assignments have no separate "Assign" action — the
		moment the PCB Team Leader picks a Field Technician and saves, the status
		auto-progresses straight to "Untagging Assigned" / "Seal Return Assigned"
		(see _auto_progress_untagging_status / _auto_progress_seal_return_status).
		This hands the linked Journey Request to that technician and opens the
		relevant work window the moment that transition lands, rather than needing
		a second explicit approval step."""
		previous = self.get_doc_before_save()
		previous_status = previous.assignment_status if previous else None

		if (
			self.request_type == "Untagging"
			and self.assignment_status == "Untagging Assigned"
			and previous_status != "Untagging Assigned"
		):
			_ensure_untagging_journey_request(self)
		elif (
			self.request_type == "Seal Return"
			and self.assignment_status == "Seal Return Assigned"
			and previous_status != "Seal Return Assigned"
		):
			_ensure_seal_return_journey_request(self)

		if (
			self.assignment_status in ASSIGNED_STATUSES
			and previous_status != self.assignment_status
			and self.assigned_field_technician
		):
			_notify_field_technician_assigned(self)

	def _validate_field_technician_role(self):
		if not self.assigned_field_technician:
			return

		if not frappe.db.exists(
			"Has Role",
			{
				"parent": self.assigned_field_technician,
				"parenttype": "User",
				"role": "Field Technician",
			},
		):
			frappe.throw(
				_("{0} is not a Field Technician (Tag Operator).").format(
					self.assigned_field_technician
				),
				title=_("Invalid Tag Operator"),
			)

	def _auto_progress_untagging_status(self):
		"""Unlike the tagging flow (which needs an explicit "Assign" action), an
		untagging assignment advances itself the moment the PCB Team Leader picks
		a Field Technician and saves — straight from "Pending Untagging
		Assignment" to "Untagging Assigned". on_update then hands the linked
		Journey Request to that technician (see _ensure_untagging_journey_request)."""
		if self.request_type != "Untagging":
			return
		if self.assignment_status == "Pending Untagging Assignment" and self.assigned_field_technician:
			self.assignment_status = "Untagging Assigned"

	def _auto_progress_seal_return_status(self):
		"""Mirror of _auto_progress_untagging_status for the remote-unlock seal
		return cycle: the moment the PCB Team Leader picks a Field Technician and
		saves, the assignment advances straight from "Pending Seal Return
		Assignment" to "Seal Return Assigned"."""
		if self.request_type != "Seal Return":
			return
		if self.assignment_status == "Pending Seal Return Assignment" and self.assigned_field_technician:
			self.assignment_status = "Seal Return Assigned"


def _notify_field_technician_assigned(assignment):
	"""Notify the Field Technician who was just handed this job (Tagging,
	Untagging, or Seal Return) via desk notification and email."""
	email = frappe.db.get_value("User", assignment.assigned_field_technician, "email")
	subject = _("New {0} Assignment: {1}").format(assignment.request_type, assignment.name)
	lines = [
		_("You have been assigned a {0} job.").format(assignment.request_type),
		_("Client: {0}").format(assignment.client_name or "-"),
		_("Location: {0}").format(assignment.location or "-"),
	]
	if assignment.scheduled_date_time:
		lines.append(_("Scheduled: {0}").format(assignment.scheduled_date_time))
	message = "<br>".join(str(line) for line in lines)

	notify_users(
		[(assignment.assigned_field_technician, email or assignment.assigned_field_technician)],
		subject,
		message,
		document_type="PCB Assignment",
		document_name=assignment.name,
		link=f"/app/pcb-assignment/{assignment.name}",
	)


def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB"}:
		return ""

	if "PCB Team Leader" in roles:
		return f"`tabPCB Assignment`.pcb_team_leader = {frappe.db.escape(user)}"

	return ""


def has_permission(doc, user=None, permission_type=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB"}:
		return True

	if "PCB Team Leader" in roles and doc.pcb_team_leader == user:
		return True

	return False


def _seal_journey_for_job_order(job_order_name):
	booking = frappe.db.get_value("PCB Job Order", job_order_name, "tagging_booking")
	if not booking:
		return None
	return frappe.db.get_value("Tagging Booking", booking, "seal_journey_reference")


def _ensure_journey_request(assignment):
	if frappe.db.exists("Journey Request", {"job_order": assignment.pcb_job_order}):
		return

	seal_journey = _seal_journey_for_job_order(assignment.pcb_job_order)

	frappe.get_doc(
		{
			"doctype": "Journey Request",
			"job_order": assignment.pcb_job_order,
			"client_name": assignment.client_name,
			"assigned_technician": assignment.assigned_field_technician,
			"journey_reference": seal_journey,
			# Leave the route blank at this stage — origin and destination are set
			# later in the Journey Request. Passing empty strings prevents Frappe
			# from auto-filling both mandatory Select fields with their first
			# option, which would otherwise trip the "same address" validation.
			"origin": "",
			"destination": "",
		}
	).insert(ignore_permissions=True, ignore_mandatory=True)

	if seal_journey:
		set_journey_status(seal_journey, "Technician Assigned")
		sync_seal_journey_mirror(seal_journey)


def _ensure_assignment_status_permission(assignment):
	roles = set(frappe.get_roles())
	if "System Manager" in roles:
		return
	if assignment.pcb_team_leader != frappe.session.user:
		frappe.throw(
			_("Only the assigned PCB Team Leader can update this assignment's status."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def update_assignment_status(assignment_name, status):
	if status not in ("Assigned", "Cancelled"):
		frappe.throw(_("Invalid status {0}.").format(status), title=_("Invalid Status"))

	assignment = frappe.get_doc("PCB Assignment", assignment_name)
	assignment.check_permission("write")
	_ensure_assignment_status_permission(assignment)

	if assignment.assignment_status == "Cancelled":
		frappe.throw(
			_("This assignment is already Cancelled."),
			title=_("Invalid Status"),
		)

	if status == "Assigned" and not assignment.assigned_field_technician:
		frappe.throw(
			_("Cannot mark this assignment as Assigned before a Field Technician is assigned."),
			title=_("Field Technician Not Assigned"),
		)

	assignment.assignment_status = status
	assignment.save(ignore_permissions=True)

	if status == "Assigned":
		_ensure_journey_request(assignment)

	frappe.db.commit()

	return {"assignment_status": assignment.assignment_status}


def _ensure_untagging_journey_request(assignment):
	"""Hand the seal journey's existing Journey Request to the Field Technician
	who was just approved for untagging, and move it into the Untagging phase —
	mirrors _ensure_journey_request's role for the tagging phase, but reuses the
	same Journey Request doc (its lifecycle now spans tagging and untagging)
	rather than creating a new one, since untagging assignments have no
	pcb_job_order of their own."""
	if not assignment.seal_journey:
		return

	journey_request_name = frappe.db.get_value(
		"Journey Request", {"journey_reference": assignment.seal_journey}, "name"
	)
	if not journey_request_name:
		frappe.log_error(
			f"No Journey Request found for Seal Journey {assignment.seal_journey}",
			"Untagging Assignment",
		)
		return

	journey_request = frappe.get_doc("Journey Request", journey_request_name)
	journey_request.assigned_technician = assignment.assigned_field_technician
	journey_request.journey_request_status = "Untagging"
	journey_request.flags.ignore_field_locks = True
	journey_request.save(ignore_permissions=True)

	for row in journey_request.seals:
		set_seal_custody(
			row.seal_device,
			"User",
			assignment.assigned_field_technician,
			remarks=f"Assigned for untagging via PCB Assignment {assignment.name}",
			journey=assignment.seal_journey,
			column="untagging_to",
		)

	set_journey_status(
		assignment.seal_journey,
		"Untagging In Progress",
		{"untagging_status": "In Progress", "untagging_started_date_time": now_datetime()},
	)
	sync_seal_journey_mirror(assignment.seal_journey)


def _ensure_seal_return_journey_request(assignment):
	"""Hand the seal journey's existing Journey Request to the Field Technician
	approved for seal return, and move it into the "Awaiting Seal Return" phase.
	Mirrors _ensure_untagging_journey_request but skips the untagging stage —
	on a remote unlock there is no physical untagging, so the FT goes straight to
	collecting the seal from the client."""
	if not assignment.seal_journey:
		return

	journey_request_name = frappe.db.get_value(
		"Journey Request", {"journey_reference": assignment.seal_journey}, "name"
	)
	if not journey_request_name:
		frappe.log_error(
			f"No Journey Request found for Seal Journey {assignment.seal_journey}",
			"Seal Return Assignment",
		)
		return

	journey_request = frappe.get_doc("Journey Request", journey_request_name)
	journey_request.assigned_technician = assignment.assigned_field_technician
	journey_request.journey_request_status = "Awaiting Seal Return"
	journey_request.flags.ignore_field_locks = True
	journey_request.save(ignore_permissions=True)

	for row in journey_request.seals:
		set_seal_custody(
			row.seal_device,
			"User",
			assignment.assigned_field_technician,
			remarks=f"Assigned for seal return via PCB Assignment {assignment.name}",
			journey=assignment.seal_journey,
			column="seal_return_to",
		)

	set_journey_status(assignment.seal_journey, "Awaiting Seal Return")
	sync_seal_journey_mirror(assignment.seal_journey)


@frappe.whitelist()
def get_assignment_list(
	search=None,
	status=None,
	field_technician=None,
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
	if field_technician:
		base_filters.append(["assigned_field_technician", "=", field_technician])
	if from_date:
		base_filters.append(["scheduled_date_time", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["scheduled_date_time", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["pcb_job_order", "like", search_text],
			["tagging_booking", "like", search_text],
			["client_name", "like", search_text],
			["location", "like", search_text],
			["contact_person_name", "like", search_text],
			["contact_person_phone", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["assignment_status", "=", status])

	assignments = frappe.get_list(
		"PCB Assignment",
		fields=[
			"name",
			"request_type",
			"pcb_job_order",
			"seal_journey",
			"tagging_booking",
			"client_name",
			"location",
			"scheduled_date_time",
			"contact_person_name",
			"contact_person_phone",
			"pcb_team_leader",
			"assigned_field_technician",
			"assignment_date_time",
			"assignment_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="scheduled_date_time desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_rows = frappe.get_list(
		"PCB Assignment",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_rows[0].count) if total_rows else 0

	summary = {
		"All": 0,
		"Pending": 0,
		"Assigned": 0,
		"Pending Untagging Assignment": 0,
		"Untagging Assigned": 0,
		"Pending Seal Return Assignment": 0,
		"Seal Return Assigned": 0,
		"Cancelled": 0,
	}
	summary_rows = frappe.get_list(
		"PCB Assignment",
		fields=["assignment_status", "count(*) as count"],
		filters=base_filters,
		or_filters=or_filters,
		group_by="assignment_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.assignment_status in summary:
			summary[row.assignment_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"assignments": assignments,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}
