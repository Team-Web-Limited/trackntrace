# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint, flt
from frappe.utils.data import cstr
from frappe.utils import get_datetime, getdate, today
from frappe.desk.search import validate_and_sanitize_search_inputs

from tnt_seal_management.tnt_seal_management.billing import (
	compute_billing_amount,
	get_applicable_billing_rule,
)

# Statuses the billing engine must not overwrite — they are set by a human /
# finance action and represent a finalized state.
TERMINAL_BILLING_STATUSES = ("Billed", "Cancelled")

DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS = [
	"Confirm seal device is physically available",
	"Inspect seal body for visible damage",
	"Verify battery level is sufficient",
	"Confirm assigned vehicle details are correct",
	"Capture pre-tagging photo evidence",
]


class SealJourney(Document):
	def before_insert(self):
		self.ensure_pre_tagging_checklist()

	def onload(self):
		self.refresh_mirror_fields()

	def validate(self):
		self.set_days_taken()
		self.set_billing()

	def refresh_mirror_fields(self):
		"""Re-pull the detail (mirror) fields from the source chain every time the
		journey is opened, so the form always reflects the latest source values even
		when no status transition has fired. Applies values to the in-memory doc
		(for display) and persists them without bumping ``modified`` so it never
		triggers a timestamp conflict on the next save. Never touches
		``journey_status`` or the child tables — same contract as
		``sync_seal_journey_mirror``."""
		if self.is_new():
			return

		values = resolve_seal_journey_mirror_values(self.name)
		if not values:
			return

		changed = {}
		for field, value in values.items():
			if self.get(field) != value:
				self.set(field, value)
				changed[field] = value

		if changed:
			frappe.db.set_value("Seal Journey", self.name, changed, update_modified=False)

	def ensure_pre_tagging_checklist(self):
		if self.pre_tagging_checklist:
			return

		for item in get_pre_tagging_checklist_items():
			self.append("pre_tagging_checklist", {"checklist_item": item, "completed": 0})

	def set_days_taken(self):
		if not self.journey_start_date_time or not self.completion_date_time:
			self.days_taken = 0
			return

		start = get_datetime(self.journey_start_date_time)
		completion = get_datetime(self.completion_date_time)
		if completion < start:
			self.days_taken = 0
			return

		total_seconds = (completion - start).total_seconds()
		self.days_taken = flt(total_seconds / 86400, 2)

	def set_billing(self):
		"""Resolve the customer's billing rule and compute the charge on every
		save, so the Billing tab always reflects the latest rate and dates.

		Dates default from the journey timeline (start -> completion). Billing is
		inclusive whole days (start..return). When the return date is unknown the
		charge is an estimate up to today and the status stays Pending Billing.
		Terminal statuses (Billed / Cancelled) are never overwritten."""
		if self.billing_status in TERMINAL_BILLING_STATUSES:
			return

		# Default the billing dates from the journey timeline if not set by hand.
		if not self.billing_start_date and self.journey_start_date_time:
			self.billing_start_date = getdate(self.journey_start_date_time)
		if not self.billing_return_date and self.completion_date_time:
			self.billing_return_date = getdate(self.completion_date_time)

		if not self.customer or not self.billing_start_date:
			self._clear_billing(status="Not Billed")
			return

		rule_name = get_applicable_billing_rule(self.customer, self.billing_start_date)
		if not rule_name:
			self._clear_billing(status="Not Billed")
			return

		rule = frappe.db.get_value(
			"Seal Billing Rate",
			rule_name,
			[
				"name",
				"billing_period_type",
				"currency",
				"first_period_days",
				"first_period_amount",
				"extra_day_rate",
			],
			as_dict=True,
		)

		# Final billing uses the return date; otherwise estimate to today.
		end_date = self.billing_return_date or getdate(today())
		if getdate(end_date) < getdate(self.billing_start_date):
			end_date = getdate(self.billing_start_date)

		total_days = (getdate(end_date) - getdate(self.billing_start_date)).days + 1
		result = compute_billing_amount(rule, total_days)

		self.billing_rule = rule.name
		self.billable_days = result["billable_days"]
		self.first_period_days = result["first_period_days"]
		self.first_period_amount = result["first_period_amount"]
		self.extra_days = result["extra_days"]
		self.extra_day_rate = result["extra_day_rate"]
		self.extra_day_amount = result["extra_day_amount"]
		self.total_charge = result["total_amount"]
		self.billing_status = "Pending Billing"

	def _clear_billing(self, status="Not Billed"):
		self.billing_rule = None
		self.billable_days = 0
		self.first_period_days = 0
		self.first_period_amount = 0
		self.extra_days = 0
		self.extra_day_rate = 0
		self.extra_day_amount = 0
		self.total_charge = 0
		self.billing_status = status


def set_journey_status(seal_journey, status, extra=None):
	"""Update the status (and optional extra fields) of a Seal Journey, if one is
	linked. Safe no-op when ``seal_journey`` is empty. Used to keep the Seal
	Journey mirror in step with the booking → job order → journey request flow."""
	if not seal_journey:
		return
	if not frappe.db.exists("Seal Journey", seal_journey):
		return
	values = {"journey_status": status}
	if extra:
		values.update(extra)
	frappe.db.set_value("Seal Journey", seal_journey, values)


def sync_seal_journey_mirror(seal_journey):
	"""Idempotently rewrite the detail (mirror) fields on a Seal Journey from its
	source documents: Tagging Booking -> PCB Job Order -> PCB Assignment ->
	Journey Request.

	This NEVER writes ``journey_status`` — the transition methods retain status
	authority; this only fills detail so each tab is populated as the journey
	shifts stages. Safe no-op when ``seal_journey`` is empty/missing. Only
	non-empty resolved values are written, so a later-stage source doc that does
	not exist yet never clobbers detail captured at an earlier stage. Child
	tables (journey_seals, photos) are intentionally left to
	``_finalize_seal_journey_from_request`` which owns them at the In Transit step.
	"""
	if not seal_journey:
		return
	if not frappe.db.exists("Seal Journey", seal_journey):
		return

	values = resolve_seal_journey_mirror_values(seal_journey)
	if values:
		frappe.db.set_value("Seal Journey", seal_journey, values)


def resolve_seal_journey_mirror_values(seal_journey):
	"""Resolve (but do not write) the detail (mirror) field values for a Seal
	Journey from its source chain. Returns a dict of non-empty field -> value, or
	an empty dict when there is nothing to mirror yet. See
	``sync_seal_journey_mirror`` for the contract."""
	booking_name = frappe.db.get_value("Seal Journey", seal_journey, "tagging_booking")
	if not booking_name:
		return {}

	values = {}

	def put(field, value):
		if value not in (None, ""):
			values[field] = value

	# --- Tagging Booking -------------------------------------------------
	booking = frappe.db.get_value(
		"Tagging Booking",
		booking_name,
		[
			"client_name",
			"location",
			"contact_person_name",
			"contact_person_phone",
			"finance_pcb_approval_status",
			"finance_pcb_approver",
			"finance_pcb_approval_date_time",
			"finance_pcb_remarks",
			"pcb_job_order_reference",
		],
		as_dict=True,
	)
	if booking:
		put("customer", booking.client_name)
		put("origin", booking.location)
		put("contact_person_name", booking.contact_person_name)
		put("contact_person_phone", booking.contact_person_phone)
		put("finance_pcb_approval_status", booking.finance_pcb_approval_status)
		put("finance_pcb_approver", booking.finance_pcb_approver)
		put("finance_pcb_approval_date_time", booking.finance_pcb_approval_date_time)
		put("finance_pcb_remarks", booking.finance_pcb_remarks)
		put("pcb_job_order", booking.pcb_job_order_reference)
		put("sales_order_reference", booking.pcb_job_order_reference)

	job_order_name = booking.pcb_job_order_reference if booking else None

	# --- PCB Job Order ---------------------------------------------------
	assignment_name = None
	if job_order_name:
		job_order = frappe.db.get_value(
			"PCB Job Order",
			job_order_name,
			[
				"scheduled_date_time",
				"assigned_pcb_team_leader",
				"team_leader_assignment_date_time",
				"assignment_reference",
			],
			as_dict=True,
		)
		if job_order:
			put("scheduled_date_time", job_order.scheduled_date_time)
			put("assigned_team_lead", job_order.assigned_pcb_team_leader)
			put("team_lead_assignment_date_time", job_order.team_leader_assignment_date_time)
			assignment_name = job_order.assignment_reference or frappe.db.get_value(
				"PCB Assignment", {"pcb_job_order": job_order_name}, "name"
			)

	# --- PCB Assignment --------------------------------------------------
	if assignment_name:
		assignment = frappe.db.get_value(
			"PCB Assignment",
			assignment_name,
			["assigned_field_technician", "assignment_date_time"],
			as_dict=True,
		)
		if assignment:
			put("pcb_assignment", assignment_name)
			put("assigned_technician", assignment.assigned_field_technician)
			put("technician_assignment_date_time", assignment.assignment_date_time)

	# --- Journey Request -------------------------------------------------
	jr_name = frappe.db.get_value("Journey Request", {"job_order": job_order_name}, "name") if job_order_name else None
	if jr_name:
		jr = frappe.db.get_value(
			"Journey Request",
			jr_name,
			[
				"vehicle",
				"container_number",
				"origin",
				"destination",
				"assigned_technician",
				"control_room_approver",
				"control_room_approval_date_time",
				"control_room_remarks",
				"actual_tagging_date_time",
				"tagging_location",
				"tagging_remarks",
				"customer_care_approver",
				"approval_date_time",
				"customer_care_remarks",
			],
			as_dict=True,
		)
		if jr:
			put("journey_request", jr_name)
			vehicle_plate = (
				frappe.db.get_value("Vehicle", jr.vehicle, "registration_number") if jr.vehicle else None
			) or jr.vehicle
			put("vehicle_plate_number", vehicle_plate)
			put("container_number", jr.container_number)
			put("origin", jr.origin)  # JR origin overrides booking.location once set
			put("destination", jr.destination)
			put("assigned_technician", jr.assigned_technician)
			put("control_room_approver", jr.control_room_approver)
			put("control_room_approval_date_time", jr.control_room_approval_date_time)
			put("control_room_remarks", jr.control_room_remarks)
			put("tagging_date_time", jr.actual_tagging_date_time)
			put("tagging_location", jr.tagging_location)
			put("tagging_remarks", jr.tagging_remarks)
			put("customer_care_approver", jr.customer_care_approver)
			put("customer_care_approval_date_time", jr.approval_date_time)
			put("customer_care_remarks", jr.customer_care_remarks)

	return values


def get_pre_tagging_checklist_items():
	settings = frappe.get_single("Seal API Settings")
	items = [
		row.checklist_item.strip()
		for row in settings.pre_tagging_checklist_template
		if row.checklist_item and row.checklist_item.strip()
	]
	return items or DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS


@frappe.whitelist()
def get_pre_tagging_checklist_template():
	return get_pre_tagging_checklist_items()


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def pcb_team_leader_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("PCB Team Leader", txt, searchfield, start, page_len)


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def field_technician_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("Field Technician", txt, searchfield, start, page_len)


def _user_role_query(role, txt, searchfield, start, page_len):
	return frappe.db.sql(
		f"""
		select
			u.name,
			concat_ws(' ', u.first_name, u.last_name) as full_name
		from `tabUser` u
		inner join `tabHas Role` hr on hr.parent = u.name
		where hr.role = %(role)s
			and u.enabled = 1
			and u.docstatus < 2
			and u.user_type = 'System User'
			and (
				u.{searchfield} like %(txt)s
				or concat_ws(' ', u.first_name, u.last_name) like %(txt)s
			)
		order by
			case when u.name like %(txt)s then 0 else 1 end,
			case when concat_ws(' ', u.first_name, u.last_name) like %(txt)s then 0 else 1 end,
			u.full_name asc,
			u.name asc
		limit %(start)s, %(page_len)s
		""",
		{
			"role": role,
			"txt": f"%{cstr(txt)}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
	)
