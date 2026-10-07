# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, getdate, now_datetime, today

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	booking_journey_names,
	journey_request_for_seal_journey,
	set_journey_status,
	sync_seal_journey_mirror,
)
from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	set_seal_custody,
)
from tnt_seal_management.tnt_seal_management.api.notifications import (
	get_users_with_role,
	notify_users,
)

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

		# A tagging request waiting for its Team Leader — on creation (Finance
		# approved the booking) or when Finance hands it to another Team Leader.
		if (
			self.request_type == "Tagging"
			and self.assignment_status == "Pending"
			and self.pcb_team_leader
			and self.has_value_changed("pcb_team_leader")
		):
			_notify_pcb_team_leader_new_request(self)

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

		# Push newly written Team Leader remarks through to the Journey Request the
		# Tag Operator works from. Runs after the _ensure_*_journey_request calls
		# above so an untagging/seal-return handoff in this same save lands first.
		remarks = cstr(self.remarks).strip()
		previous_remarks = cstr(previous.remarks).strip() if previous else ""
		if remarks and remarks != previous_remarks:
			_sync_remarks_to_journey_request(self, remarks)

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


@frappe.whitelist()
def change_team_leader(assignment_name, team_leader):
	"""Hand a tagging request that is still waiting for a Tag Operator to another
	PCB Team Leader. Done through the job order (its _sync_assignment pushes the
	Team Leader onto this assignment and the Seal Journey mirror), so all three
	stay in step; the new Team Leader is notified by on_update."""
	from tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order import (
		resolve_team_leader,
	)

	if not set(frappe.get_roles()) & {"Finance PCB", "System Manager"}:
		frappe.throw(
			_("Only Finance PCB can change the PCB Team Leader."),
			title=_("Insufficient Permission"),
		)
	assignment = frappe.get_doc("PCB Assignment", assignment_name)
	if assignment.request_type != "Tagging" or assignment.assignment_status != "Pending":
		frappe.throw(
			_("The Team Leader can only be changed before a Tag Operator is assigned."),
			title=_("Invalid Status"),
		)
	team_leader = resolve_team_leader(team_leader)
	if not assignment.pcb_job_order:
		assignment.pcb_team_leader = team_leader
		assignment.save(ignore_permissions=True)
	else:
		job_order = frappe.get_doc("PCB Job Order", assignment.pcb_job_order)
		job_order.assigned_pcb_team_leader = team_leader
		job_order.team_leader_assignment_date_time = now_datetime()
		job_order.save(ignore_permissions=True)
	frappe.db.commit()
	return {"pcb_team_leader": team_leader}


def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB", "Account Manager"}:
		return ""

	if "PCB Team Leader" in roles:
		return f"`tabPCB Assignment`.pcb_team_leader = {frappe.db.escape(user)}"

	return ""


def has_permission(doc, user=None, permission_type=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB", "Account Manager"}:
		return True

	if "PCB Team Leader" in roles and doc.pcb_team_leader == user:
		return True

	return False


def _seal_journey_for_job_order(job_order_name):
	booking = frappe.db.get_value("PCB Job Order", job_order_name, "tagging_booking")
	if not booking:
		return None
	return frappe.db.get_value("Tagging Booking", booking, "seal_journey_reference")


def booked_vehicle_journeys(seal_journey):
	"""The (vehicle, registration_number, seal_journey) rows booked on the
	Tagging Booking behind the given Seal Journey — one Seal Journey now exists
	per vehicle (see TaggingBooking._ensure_seal_journey), each row here mapping
	to one of them. Returns [] if the booking or its seal journeys can't be
	resolved."""
	if not seal_journey:
		return []

	booking = frappe.db.get_value("Seal Journey", seal_journey, "tagging_booking")
	if not booking:
		return []

	return frappe.get_all(
		"Tagging Booking Seal Journey",
		filters={"parent": booking, "parenttype": "Tagging Booking"},
		fields=["vehicle", "registration_number", "seal_journey"],
		order_by="idx",
	)


def booked_vehicles_for_journey(seal_journey):
	"""The vehicle(s) the client named in the Selected Vehicles section of the
	Tagging Booking, as the plain text the Journey Request's read-only Vehicle
	field carries. The Field Technician has no access to the Vehicle doctype, so
	this prefill is the only way that field is ever populated — which is also why a
	multi-vehicle booking is joined into one string rather than dropped: nobody
	downstream can fill in what is left out."""
	plates = [
		row.registration_number or row.vehicle
		for row in booked_vehicle_journeys(seal_journey)
		if row.registration_number or row.vehicle
	]
	return ", ".join(plates) or None


def _ensure_journey_request(assignment):
	# A Cancelled Journey Request belongs to a prior, unwound assignment cycle
	# (see _cancel_assignment) — it must not block a fresh one from being
	# created for the Tag Operator now taking over the job.
	if frappe.db.exists(
		"Journey Request",
		{"job_order": assignment.pcb_job_order, "journey_request_status": ["!=", "Cancelled"]},
	):
		return

	seal_journey = _seal_journey_for_job_order(assignment.pcb_job_order)
	vehicle_journeys = booked_vehicle_journeys(seal_journey)

	journey_request = frappe.get_doc(
		{
			"doctype": "Journey Request",
			"job_order": assignment.pcb_job_order,
			"client_name": assignment.client_name,
			"assigned_technician": assignment.assigned_field_technician,
			"journey_reference": seal_journey,
			# Carried over from the Tagging Booking's Selected Vehicles — the field
			# is read-only on the request, so this is where it gets its value.
			"vehicle": booked_vehicles_for_journey(seal_journey),
			"vehicles": [
				{
					"vehicle": row.vehicle,
					"seal_journey": row.seal_journey,
				}
				for row in vehicle_journeys
			],
			# Leave the route blank at this stage — origin and destination are set
			# later in the Journey Request. Passing empty strings prevents Frappe
			# from auto-filling both mandatory Select fields with their first
			# option, which would otherwise trip the "same address" validation.
			"origin": "",
			"destination": "",
		}
	)

	# Carry across any remarks the Team Leader wrote on the assignment before
	# assigning — at that point there was no Journey Request for on_update's
	# _sync_remarks_to_journey_request to write to.
	if cstr(assignment.remarks).strip():
		journey_request.append("remarks_log", {"remarks": cstr(assignment.remarks).strip()})
		journey_request.flags.allow_remarks_log_append = True

	journey_request.insert(ignore_permissions=True, ignore_mandatory=True)

	for journey in [row.seal_journey for row in vehicle_journeys] or ([seal_journey] if seal_journey else []):
		set_journey_status(journey, "Technician Assigned")
		sync_seal_journey_mirror(journey)


def _journey_request_for_assignment(assignment):
	"""Locate the Journey Request this assignment feeds. Tagging assignments own a
	PCB Job Order, so the request is found through it (skipping Cancelled rows from
	prior, unwound cycles — see _cancel_assignment). Untagging/Seal Return
	assignments have no job order of their own and reuse the journey's existing
	request, found through the Seal Journey."""
	if assignment.pcb_job_order:
		journey_request = frappe.db.get_value(
			"Journey Request",
			{"job_order": assignment.pcb_job_order, "journey_request_status": ["!=", "Cancelled"]},
			"name",
		)
		if journey_request:
			return journey_request

	seal_journey = resolve_assignment_seal_journey(assignment)
	if seal_journey:
		return journey_request_for_seal_journey(seal_journey)

	return None


def _sync_remarks_to_journey_request(assignment, remarks):
	"""Mirror the PCB Team Leader's assignment remarks onto the linked Journey
	Request's append-only Remarks History, which is where the Tag Operator reads
	them (the assignment itself is scoped to the Team Leader — see
	get_permission_query_conditions — so the technician never sees it)."""
	journey_request_name = _journey_request_for_assignment(assignment)
	if not journey_request_name:
		# The Journey Request doesn't exist yet (remarks written before the
		# "Assign" action). _ensure_journey_request seeds it at creation instead.
		return

	entry = cstr(remarks).strip()

	journey_request = frappe.get_doc("Journey Request", journey_request_name)
	if any(cstr(row.remarks) == entry for row in journey_request.remarks_log):
		return

	journey_request.append("remarks_log", {"remarks": entry})
	journey_request.flags.allow_remarks_log_append = True
	journey_request.flags.ignore_field_locks = True
	# Early in the tagging cycle the request is still the stub _ensure_journey_request
	# inserted (ignore_mandatory) — the technician has yet to fill in the vehicle,
	# route and container details. A Team Leader's remark must not be blocked on that.
	journey_request.flags.ignore_mandatory = True
	journey_request.save(ignore_permissions=True)


def _ensure_assignment_status_permission(assignment):
	roles = set(frappe.get_roles())
	if "System Manager" in roles:
		return
	if assignment.pcb_team_leader != frappe.session.user:
		frappe.throw(
			_("Only the assigned PCB Team Leader can update this assignment's status."),
			title=_("Insufficient Permission"),
		)


def _ensure_cancel_permission():
	"""Cancelling an assignment reverts the whole Seal Journey to Finance PCB
	approval, so it is deliberately NOT a PCB Team Leader action — only PCB
	Finance (or a System Manager) may do it."""
	roles = set(frappe.get_roles())
	if roles & {"System Manager", "Finance PCB"}:
		return
	frappe.throw(
		_("Only PCB Finance or a System Manager can cancel an assignment."),
		title=_("Insufficient Permission"),
	)


# Seal Journey statuses reached once the technician has actually begun tagging
# (set the instant Control Room approves the Journey Request — see
# journey_request.approve_by_control_room) through to journey completion.
# Cancelling an assignment is a hard block from this point on: real physical
# work is underway or done, so unwinding back to Finance PCB approval is no
# longer safe.
_TAGGING_STARTED_JOURNEY_STATUSES = {
	"Tagging In Progress",
	"Tagged",
	"Post-Tagging",
	"Ready for Journey",
	"In Transit",
	"Arrived",
	"Untagging In Progress",
	"Untagged",
	"Awaiting Seal Return",
	"Completed",
}


def resolve_assignment_seal_journey(assignment):
	if assignment.seal_journey:
		return assignment.seal_journey
	return _seal_journey_for_job_order(assignment.pcb_job_order)


def _assignment_journeys(assignment):
	"""Every Seal Journey an assignment covers: all of a tagging assignment's
	booked vehicles, or the one journey an untagging/seal-return assignment names."""
	if assignment.pcb_job_order:
		booking = assignment.tagging_booking or frappe.db.get_value(
			"PCB Job Order", assignment.pcb_job_order, "tagging_booking"
		)
		journeys = booking_journey_names(booking)
		if journeys:
			return journeys
	journey = resolve_assignment_seal_journey(assignment)
	return [journey] if journey else []


def _any_tagging_started(assignment):
	return any(
		frappe.db.get_value("Seal Journey", journey, "journey_status") in _TAGGING_STARTED_JOURNEY_STATUSES
		for journey in _assignment_journeys(assignment)
	)


def _ensure_tagging_not_started(assignment):
	if _any_tagging_started(assignment):
		frappe.throw(
			_("This assignment can no longer be cancelled — tagging has already started."),
			title=_("Tagging Already Started"),
		)


@frappe.whitelist()
def can_cancel_assignment(assignment_name):
	"""Lightweight check the assignment form calls to decide whether to show
	the Cancel Assignment button, mirroring the server-side guards in
	update_assignment_status/_cancel_assignment so the UI never offers an
	action the backend would then reject."""
	assignment = frappe.get_doc("PCB Assignment", assignment_name)
	assignment.check_permission("read")

	if assignment.assignment_status == "Cancelled":
		return {"can_cancel": False}

	roles = set(frappe.get_roles())
	if not (roles & {"System Manager", "Finance PCB"}):
		return {"can_cancel": False}

	if _any_tagging_started(assignment):
		return {"can_cancel": False}

	return {"can_cancel": True}


@frappe.whitelist()
def update_assignment_status(assignment_name, status):
	if status not in ("Assigned", "Cancelled"):
		frappe.throw(_("Invalid status {0}.").format(status), title=_("Invalid Status"))

	assignment = frappe.get_doc("PCB Assignment", assignment_name)
	assignment.check_permission("write")

	if assignment.assignment_status == "Cancelled":
		frappe.throw(
			_("This assignment is already Cancelled."),
			title=_("Invalid Status"),
		)

	if status == "Cancelled":
		_ensure_cancel_permission()
		_ensure_tagging_not_started(assignment)
		return _cancel_assignment(assignment)

	# status == "Assigned"
	_ensure_assignment_status_permission(assignment)

	if not assignment.assigned_field_technician:
		frappe.throw(
			_("Cannot mark this assignment as Assigned before a Field Technician is assigned."),
			title=_("Field Technician Not Assigned"),
		)

	assignment.assignment_status = status
	assignment.save(ignore_permissions=True)
	_ensure_journey_request(assignment)

	frappe.db.commit()

	return {"assignment_status": assignment.assignment_status}


def _cancel_assignment(assignment):
	"""Cancel an assignment and unwind it back to the Finance PCB stage: release
	the Tag Operator, unlink this (now-terminal) assignment from its Job Order so
	it can never be silently reused for a later Tag Operator, revert the Tagging
	Booking to Pending Finance PCB Approval (the actual gate the "Approve" button
	on the booking checks), mirror that back onto the Seal Journey, and notify the
	released technician plus PCB Finance so the journey can be re-approved and
	re-assigned cleanly."""
	ex_technician = assignment.assigned_field_technician
	job_order_name = assignment.pcb_job_order
	seal_journey = assignment.seal_journey or _seal_journey_for_job_order(job_order_name)
	journeys = _assignment_journeys(assignment)
	tagging_booking = assignment.tagging_booking or (
		frappe.db.get_value("Seal Journey", seal_journey, "tagging_booking") if seal_journey else None
	)

	assignment.assignment_status = "Cancelled"
	assignment.assigned_field_technician = None
	# pcb_job_order is unique on this doctype — a Cancelled row must release its
	# job order or a brand-new PCB Assignment can never be created for it again
	# once Finance re-approves (insert fails with "PCB Job Order must be
	# unique"). tagging_booking is kept so the cancelled record still shows
	# which booking it belonged to.
	assignment.pcb_job_order = None
	assignment.save(ignore_permissions=True)

	if job_order_name:
		job_order = frappe.get_doc("PCB Job Order", job_order_name)
		if job_order.assignment_reference == assignment.name:
			job_order.assignment_reference = None
			job_order.save(ignore_permissions=True)

		# The Journey Request created for this cycle (if any) is now stale — its
		# technician no longer owns the job. Cancel it so the Seal Journey mirror
		# stops showing the released technician, and so _ensure_journey_request
		# creates a fresh one once a new Tag Operator is assigned.
		for stale in frappe.get_all(
			"Journey Request",
			filters={"job_order": job_order_name, "journey_request_status": ["!=", "Cancelled"]},
			pluck="name",
		):
			frappe.db.set_value("Journey Request", stale, "journey_request_status", "Cancelled")
			frappe.db.set_value(
				"Journey Request Vehicle",
				{"parent": stale, "parenttype": "Journey Request"},
				"status",
				"Cancelled",
			)

	if tagging_booking:
		booking = frappe.get_doc("Tagging Booking", tagging_booking)
		if booking.booking_status not in ("Pending Finance PCB Approval", "Draft"):
			booking.booking_status = "Pending Finance PCB Approval"
			booking.finance_pcb_approver = None
			booking.finance_pcb_approval_date_time = None
			booking.save(ignore_permissions=True)

	for journey in journeys or ([seal_journey] if seal_journey else []):
		set_journey_status(
			journey,
			"Pending Finance PCB Approval",
			{"assigned_technician": None},
		)
		sync_seal_journey_mirror(journey)

	_notify_assignment_cancelled(assignment, ex_technician, seal_journey)

	frappe.db.commit()

	return {"assignment_status": assignment.assignment_status}


def _notify_assignment_cancelled(assignment, ex_technician, seal_journey):
	"""Notify the released Field Technician (if one was assigned) and all PCB
	Finance users that the assignment was cancelled and the journey reverted."""
	subject = _("Assignment Cancelled: {0}").format(assignment.name)
	lines = [
		_("The {0} assignment {1} has been cancelled.").format(
			assignment.request_type, assignment.name
		),
		_("Client: {0}").format(assignment.client_name or "-"),
		_("Location: {0}").format(assignment.location or "-"),
	]
	if seal_journey:
		lines.append(
			_("The linked Seal Journey {0} has been reverted to Pending Finance PCB Approval.").format(
				seal_journey
			)
		)
	message = "<br>".join(str(line) for line in lines)

	recipients = []
	if ex_technician:
		email = frappe.db.get_value("User", ex_technician, "email")
		recipients.append((ex_technician, email or ex_technician))
	recipients.extend(get_users_with_role("Finance PCB"))

	# De-duplicate while preserving order (a Finance PCB user could also be the
	# released technician).
	seen = set()
	deduped = []
	for user, email in recipients:
		if user not in seen:
			seen.add(user)
			deduped.append((user, email))

	notify_users(
		deduped,
		subject,
		message,
		document_type="PCB Assignment",
		document_name=assignment.name,
		link=f"/app/pcb-assignment/{assignment.name}",
	)


def _hand_journey_request_to_technician(assignment, request_status, log_title):
	"""Hand the Journey Request covering assignment.seal_journey to the assignment's
	Field Technician and move that vehicle into `request_status`. On a multi-vehicle
	request only the vehicle whose Seal Journey the assignment names moves — its
	siblings keep their own stage. Returns (journey_request, that vehicle's seal
	rows) or None when no request is found."""
	from tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request import (
		_roll_up_status,
		_row_seals,
	)

	journey_request_name = journey_request_for_seal_journey(assignment.seal_journey)
	if not journey_request_name:
		frappe.log_error(
			f"No Journey Request found for Seal Journey {assignment.seal_journey}",
			log_title,
		)
		return None

	journey_request = frappe.get_doc("Journey Request", journey_request_name)
	journey_request.assigned_technician = assignment.assigned_field_technician
	row = next((r for r in journey_request.vehicles if r.seal_journey == assignment.seal_journey), None)
	if row:
		row.status = request_status
		_roll_up_status(journey_request)
		seals = _row_seals(journey_request, row)
	else:
		journey_request.journey_request_status = request_status
		seals = list(journey_request.seals)
	journey_request.flags.ignore_field_locks = True
	journey_request.save(ignore_permissions=True)
	return journey_request, seals


def _ensure_untagging_journey_request(assignment):
	"""Hand the seal journey's existing Journey Request to the Field Technician
	who was just approved for untagging, and move it into the Untagging phase —
	mirrors _ensure_journey_request's role for the tagging phase, but reuses the
	same Journey Request doc (its lifecycle now spans tagging and untagging)
	rather than creating a new one, since untagging assignments have no
	pcb_job_order of their own."""
	if not assignment.seal_journey:
		return

	handed = _hand_journey_request_to_technician(assignment, "Untagging", "Untagging Assignment")
	if not handed:
		return
	_journey_request, seals = handed

	for row in seals:
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

	handed = _hand_journey_request_to_technician(assignment, "Awaiting Seal Return", "Seal Return Assignment")
	if not handed:
		return
	_journey_request, seals = handed

	for row in seals:
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


def _seal_journeys_and_job_orders(assignments):
	"""Resolve, per assignment, the Seal Journeys and PCB Job Orders whose seals
	belong to it. Untagging / Seal Return assignments point straight at a Seal
	Journey; a Tagging assignment only has its PCB Job Order, so its journeys are
	the ones booked under that job order's Tagging Booking. Returns
	({assignment: (journeys, job_orders)}, all_journeys, all_job_orders)."""
	job_orders = {a.pcb_job_order for a in assignments if a.get("pcb_job_order")}
	booking_by_jo = dict(
		frappe.get_all(
			"PCB Job Order",
			filters={"name": ["in", list(job_orders)]},
			fields=["name", "tagging_booking"],
			as_list=True,
		)
	) if job_orders else {}

	journeys_by_jo = {}
	if job_orders:
		bookings = {b for b in booking_by_jo.values() if b}
		for row in frappe.get_all(
			"Seal Journey",
			or_filters=[
				["pcb_job_order", "in", list(job_orders)],
				*([["tagging_booking", "in", list(bookings)]] if bookings else []),
			],
			fields=["name", "pcb_job_order", "tagging_booking"],
		):
			for jo in job_orders:
				if row.pcb_job_order == jo or (row.tagging_booking and row.tagging_booking == booking_by_jo.get(jo)):
					journeys_by_jo.setdefault(jo, set()).add(row.name)

	resolved = {}
	all_journeys, all_job_orders = set(), set()
	for a in assignments:
		journeys = set()
		if a.get("seal_journey"):
			journeys.add(a.seal_journey)
		elif a.get("pcb_job_order"):
			journeys |= journeys_by_jo.get(a.pcb_job_order, set())
		jos = {a.pcb_job_order} if a.get("pcb_job_order") else set()
		resolved[a.name] = (journeys, jos)
		all_journeys |= journeys
		all_job_orders |= jos
	return resolved, all_journeys, all_job_orders


def _attach_assignment_seals(assignments):
	"""Set `seals` (comma-separated seal numbers) on each assignment row."""
	if not assignments:
		return assignments

	resolved, all_journeys, all_job_orders = _seal_journeys_and_job_orders(assignments)

	seals_by_parent = {}
	if all_journeys:
		for row in frappe.get_all(
			"Journey Request Seal",
			filters={"parent": ["in", list(all_journeys)], "parenttype": "Seal Journey"},
			fields=["parent", "seal_number"],
			order_by="parent asc, idx asc",
		):
			seals_by_parent.setdefault(row.parent, []).append(row.seal_number)
		for row in frappe.get_all(
			"Seal Journey",
			filters={"name": ["in", list(all_journeys)], "assigned_seal": ["is", "set"]},
			fields=["name", "assigned_seal"],
		):
			seals_by_parent.setdefault(row.name, []).append(row.assigned_seal)

	seals_by_job_order = {}
	if all_job_orders:
		requests = frappe.get_all(
			"Journey Request",
			filters={"job_order": ["in", list(all_job_orders)]},
			fields=["name", "job_order"],
		)
		jo_by_request = {r.name: r.job_order for r in requests}
		if jo_by_request:
			for row in frappe.get_all(
				"Journey Request Seal",
				filters={"parent": ["in", list(jo_by_request)], "parenttype": "Journey Request"},
				fields=["parent", "seal_number"],
				order_by="parent asc, idx asc",
			):
				seals_by_job_order.setdefault(jo_by_request[row.parent], []).append(row.seal_number)

	for a in assignments:
		journeys, jos = resolved[a.name]
		seen = []
		for source in [seals_by_parent.get(j, []) for j in sorted(journeys)] + [
			seals_by_job_order.get(jo, []) for jo in sorted(jos)
		]:
			for seal in source:
				if seal and seal not in seen:
					seen.append(seal)
		a["seals"] = ", ".join(seen)
	return assignments


def _assignment_seal_search_filters(search):
	"""OR filters matching assignments whose seals match `search` — via the same
	journey / job-order links _attach_assignment_seals resolves in reverse."""
	like = f"%{search}%"
	journeys = set(
		frappe.get_all(
			"Journey Request Seal",
			filters={"parenttype": "Seal Journey"},
			or_filters=[["seal_number", "like", like], ["serial_number", "like", like], ["seal_device", "like", like]],
			pluck="parent",
		)
	)
	journeys |= set(frappe.get_all("Seal Journey", filters={"assigned_seal": ["like", like]}, pluck="name"))

	job_orders = set(
		frappe.get_all(
			"Journey Request",
			filters={
				"name": ["in", frappe.get_all(
					"Journey Request Seal",
					filters={"parenttype": "Journey Request"},
					or_filters=[["seal_number", "like", like], ["serial_number", "like", like], ["seal_device", "like", like]],
					pluck="parent",
				) or [""]],
				"job_order": ["is", "set"],
			},
			pluck="job_order",
		)
	)

	or_filters = []
	if journeys:
		or_filters.append(["seal_journey", "in", list(journeys)])
		# Tagging assignments carry only the job order: reach them through the
		# matched journeys' own job order / booking.
		for row in frappe.get_all(
			"Seal Journey",
			filters={"name": ["in", list(journeys)]},
			fields=["pcb_job_order", "tagging_booking"],
		):
			if row.pcb_job_order:
				job_orders.add(row.pcb_job_order)
			if row.tagging_booking:
				job_orders |= set(
					frappe.get_all("PCB Job Order", filters={"tagging_booking": row.tagging_booking}, pluck="name")
				)
	if job_orders:
		or_filters.append(["pcb_job_order", "in", list(job_orders)])
	return or_filters


def _build_assignment_filters(search=None, status=None, field_technician=None, from_date=None, to_date=None):
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
			*_assignment_seal_search_filters(search.strip()),
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["assignment_status", "=", status])

	return base_filters, or_filters, filters


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

	base_filters, or_filters, filters = _build_assignment_filters(
		search, status, field_technician, from_date, to_date
	)

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
		order_by="modified desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	_attach_assignment_seals(assignments)

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


@frappe.whitelist()
def get_all_assignments_for_export(search=None, status=None, field_technician=None, from_date=None, to_date=None):
	"""Same filters as get_assignment_list but unpaginated, for the PDF export."""
	_, or_filters, filters = _build_assignment_filters(search, status, field_technician, from_date, to_date)

	assignments = frappe.get_list(
		"PCB Assignment",
		fields=[
			"name",
			"request_type",
			"pcb_job_order",
			"seal_journey",
			"client_name",
			"location",
			"scheduled_date_time",
			"contact_person_name",
			"contact_person_phone",
			"assigned_field_technician",
			"assignment_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_page_length=0,
	)
	return _attach_assignment_seals(assignments)


_EXPORT_ROLES = {
	"System Manager",
	"PCB Team Leader",
	"Management",
	"Field Technician",
	"Managing Director",
	"Finance PCB",
}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Assignment list's currently filtered table (built
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


# (label, fieldname, column width). "Job Order/Journey" is computed at export
# time (same as the PDF row rendering) rather than a single stored field.
_EXPORT_COLUMNS = (
	("Status", "assignment_status", 26),
	("Type", "request_type", 16),
	("Tag Operator", "assigned_field_technician", 24),
	("Client", "client_name", 28),
	("Location", "location", 24),
	("Scheduled", "scheduled_date_time", 20),
	("Contact Person", "contact_person_name", 24),
	("Phone", "contact_person_phone", 18),
	("Job Order/Journey", "_source", 20),
	("Seal", "seals", 26),
)


@frappe.whitelist()
def export_excel(search=None, status=None, field_technician=None, from_date=None, to_date=None, filename=None):
	"""Render the Assignment list's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	assignments = get_all_assignments_for_export(search, status, field_technician, from_date, to_date)
	if not assignments:
		frappe.throw(_("No assignments match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	data.extend(_assignment_export_row(assignment) for assignment in assignments)

	xlsx_file = make_xlsx(
		data,
		"Assignments",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"Assignment Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _assignment_export_row(assignment):
	is_journey_sourced = assignment.get("request_type") in ("Untagging", "Seal Return")
	source = assignment.get("seal_journey") if is_journey_sourced else assignment.get("pcb_job_order")

	row = []
	for label, fieldname, width in _EXPORT_COLUMNS:
		value = source if fieldname == "_source" else assignment.get(fieldname)
		if fieldname == "scheduled_date_time" and value:
			value = frappe.utils.get_datetime(value).strftime("%Y-%m-%d %H:%M:%S")
		row.append(cstr(value) if value not in (None, "") else "")
	return row


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export assignments."),
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
