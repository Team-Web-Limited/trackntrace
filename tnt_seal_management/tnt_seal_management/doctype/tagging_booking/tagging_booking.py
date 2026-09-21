# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, get_datetime, getdate, now_datetime, today

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	booking_journey_names,
	set_journey_status,
	sync_seal_journey_mirror,
)


def _set_booking_journeys_status(booking, status, sync=True):
	"""Move every vehicle's Seal Journey on the booking to `status`."""
	for journey in booking_journey_names(booking.name):
		set_journey_status(journey, status)
		if sync:
			sync_seal_journey_mirror(journey)


def _sync_booking_journeys(booking):
	for journey in booking_journey_names(booking.name):
		sync_seal_journey_mirror(journey)


class TaggingBooking(Document):
	def before_insert(self):
		self.booking_source = self.booking_source or "Account Manager"
		self.requested_by = self.requested_by or frappe.session.user
		if self.booking_source == "Account Manager" and not self.account_manager:
			roles = set(frappe.get_roles())
			if "Account Manager" in roles:
				self.account_manager = frappe.session.user

	def validate(self):
		self._validate_booking_date_time_not_past()
		self._enforce_finance_only_approval_controls()
		self._sync_approval_status()

	def _validate_booking_date_time_not_past(self):
		"""The booking date/time must not be in the past. Only checked when the
		value is new or has changed, so existing bookings whose slot has since
		passed can still be approved, amended or reopened."""
		if not self.booking_date_time:
			return
		if not self.is_new() and not self.has_value_changed("booking_date_time"):
			return

		# Compare to the minute: the picker has no seconds, so "now" as picked
		# would otherwise always look a few seconds in the past.
		now = get_datetime(now_datetime()).replace(second=0, microsecond=0)
		if get_datetime(self.booking_date_time) < now:
			frappe.throw(
				_("Date and Time cannot be in the past."),
				title=_("Invalid Date and Time"),
			)

	def after_insert(self):
		self._ensure_seal_journey()

	def _ensure_seal_journey(self, force=False):
		"""Create the operational journey(s) immediately for staff bookings, or
		after Account Manager acceptance for customer portal bookings.

		One Seal Journey is created per booked vehicle (see the Vehicles table),
		so a multi-vehicle booking can be tagged, approved and monitored
		independently per vehicle downstream. seal_journey_reference is kept
		pointing at the first Seal Journey created, for older code that still
		expects a single reference; the full set lives in seal_journeys."""
		if self.seal_journey_reference or self.seal_journeys:
			return
		if not force and self.booking_source == "Customer Portal":
			return

		vehicles = [row.vehicle for row in (self.vehicles or []) if row.vehicle]
		# A booking raised with no vehicles selected still gets one journey, same
		# as before this change, so nothing regresses for that edge case.
		if not vehicles:
			vehicles = [None]

		first_journey = None
		for vehicle in vehicles:
			plate = None
			if vehicle:
				plate = frappe.db.get_value("Vehicle", vehicle, "registration_number") or vehicle

			journey = frappe.get_doc(
				{
					"doctype": "Seal Journey",
					"customer": self.client_name,
					"tagging_booking": self.name,
					"journey_status": "Draft",
					"origin": self.location,
					"vehicle_plate_number": plate,
				}
			).insert(ignore_permissions=True, ignore_mandatory=True)

			self.append("seal_journeys", {"vehicle": vehicle, "seal_journey": journey.name})
			sync_seal_journey_mirror(journey.name)
			first_journey = first_journey or journey.name

		self.db_set("seal_journey_reference", first_journey)
		self.save(ignore_permissions=True)

	def _sync_approval_status(self):
		status_map = {
			"Draft": "Pending",
			"Pending Account Manager Review": "Pending",
			"Pending Finance PCB Approval": "Pending",
			"Finance PCB Approved": "Approved",
			"Finance PCB Rejected": "Rejected",
			"Cancelled": "Pending",
		}
		self.finance_pcb_approval_status = status_map.get(
			self.booking_status or "Draft",
			"Pending",
		)

	def _enforce_finance_only_approval_controls(self):
		if _can_manage_finance_approval():
			return

		protected_statuses = {"Finance PCB Approved", "Finance PCB Rejected"}
		protected_fields = (
			"finance_pcb_approval_status",
			"finance_pcb_approver",
			"finance_pcb_approval_date_time",
			"finance_pcb_remarks",
		)

		if self.is_new():
			if self.booking_status in protected_statuses:
				self._throw_finance_only_change()
			if any(self.get(fieldname) for fieldname in protected_fields[1:]):
				self._throw_finance_only_change()
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		if (
			self.booking_status != previous.booking_status
			and (
				self.booking_status in protected_statuses
				or previous.booking_status in protected_statuses
			)
		):
			self._throw_finance_only_change()

		for fieldname in protected_fields:
			if self.get(fieldname) != previous.get(fieldname):
				self._throw_finance_only_change()

	def _throw_finance_only_change(self):
		frappe.throw(
			_("Only Finance PCB can approve/reject a tagging booking or update finance approval details."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def get_branch_options():
	rows = frappe.get_all(
		"Seal Device",
		fields=["api_branch"],
		filters={"api_branch": ["!=", ""]},
		distinct=True,
		order_by="api_branch asc",
		limit_page_length=0,
	)
	return [(row.api_branch or "").strip() for row in rows if (row.api_branch or "").strip()]


def _build_booking_filters(search=None, status=None, customer=None, from_date=None, to_date=None):
	if from_date and to_date and getdate(from_date) > getdate(to_date):
		frappe.throw(_("From Date cannot be after To Date."))

	base_filters = []
	if customer:
		base_filters.append(["client_name", "=", customer])
	if from_date:
		base_filters.append(["booking_date_time", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["booking_date_time", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["client_name", "like", search_text],
			["location", "like", search_text],
			["contact_person_name", "like", search_text],
			["contact_person_phone", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["booking_status", "=", status])

	return base_filters, or_filters, filters


@frappe.whitelist()
def get_booking_list(
	search=None,
	status=None,
	customer=None,
	from_date=None,
	to_date=None,
	page=1,
	page_length=25,
):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	base_filters, or_filters, filters = _build_booking_filters(
		search, status, customer, from_date, to_date
	)

	bookings = frappe.get_list(
		"Tagging Booking",
		fields=[
			"name",
			"client_name",
			"location",
			"booking_date_time",
			"contact_person_name",
			"contact_person_phone",
			"booking_status",
			"booking_source",
			"account_manager",
			"finance_pcb_approval_status",
			"creation",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_result = frappe.get_list(
		"Tagging Booking",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_result[0].count) if total_result else 0

	summary = {
		"All": 0,
		"Draft": 0,
		"Pending Account Manager Review": 0,
		"Pending Finance PCB Approval": 0,
		"Finance PCB Approved": 0,
		"Finance PCB Rejected": 0,
		"Cancelled": 0,
	}
	summary_rows = frappe.get_list(
		"Tagging Booking",
		fields=["booking_status", "count(*) as count"],
		filters=base_filters,
		or_filters=or_filters,
		group_by="booking_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.booking_status in summary:
			summary[row.booking_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"bookings": bookings,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}


@frappe.whitelist()
def get_all_bookings_for_export(search=None, status=None, customer=None, from_date=None, to_date=None):
	"""Same filters as get_booking_list but unpaginated, for the PDF export."""
	_, or_filters, filters = _build_booking_filters(search, status, customer, from_date, to_date)

	return frappe.get_list(
		"Tagging Booking",
		fields=[
			"name",
			"client_name",
			"location",
			"booking_date_time",
			"contact_person_name",
			"contact_person_phone",
			"booking_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_page_length=0,
	)


_EXPORT_ROLES = {
	"System Manager",
	"Account Manager",
	"Finance PCB",
	"Management",
	"Managing Director",
}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Tagging Bookings list's currently filtered table (built
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


# (label, fieldname, column width) — same columns the PDF report shows.
_EXPORT_COLUMNS = (
	("Booking Status", "booking_status", 26),
	("Booking", "name", 20),
	("Client", "client_name", 28),
	("Location", "location", 24),
	("Date and Time", "booking_date_time", 20),
	("Contact Person", "contact_person_name", 24),
	("Phone", "contact_person_phone", 18),
)


@frappe.whitelist()
def export_excel(search=None, status=None, customer=None, from_date=None, to_date=None, filename=None):
	"""Render the Tagging Bookings list's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	bookings = get_all_bookings_for_export(search, status, customer, from_date, to_date)
	if not bookings:
		frappe.throw(_("No bookings match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	for booking in bookings:
		row = []
		for label, fieldname, width in _EXPORT_COLUMNS:
			value = booking.get(fieldname)
			if fieldname == "booking_date_time" and value:
				value = frappe.utils.get_datetime(value).strftime("%Y-%m-%d %H:%M:%S")
			row.append(cstr(value) if value not in (None, "") else "")
		data.append(row)

	xlsx_file = make_xlsx(
		data,
		"Tagging Bookings",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"Tagging Booking Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export tagging bookings."),
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


def _get_tagging_booking(docname):
	doc = frappe.get_doc("Tagging Booking", docname)
	doc.check_permission("write")
	return doc


def _ensure_finance_role():
	if not _can_manage_finance_approval():
		frappe.throw(
			_("Only users with the Finance PCB role can perform this action."),
			title=_("Insufficient Permission"),
		)


def _can_manage_finance_approval(user=None):
	roles = frappe.get_roles(user or frappe.session.user)
	return "Finance PCB" in roles or "System Manager" in roles


def _ensure_account_manager_role():
	roles = set(frappe.get_roles())
	if not roles & {"Account Manager", "System Manager"}:
		frappe.throw(
			_("Only an Account Manager can submit a booking to Finance."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def assign_to_me(docname):
	_ensure_account_manager_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Account Manager Review":
		frappe.throw(
			_("Only bookings awaiting Account Manager review can be claimed."),
			title=_("Invalid Status"),
		)
	if doc.booking_source != "Customer Portal":
		frappe.throw(
			_("Only customer portal bookings can be claimed from the shared queue."),
			title=_("Invalid Booking Source"),
		)
	if doc.account_manager and doc.account_manager != frappe.session.user:
		frappe.throw(
			_("This booking is already assigned to {0}.").format(doc.account_manager),
			title=_("Already Assigned"),
		)
	if doc.account_manager == frappe.session.user:
		return {"name": doc.name, "account_manager": doc.account_manager}

	doc.account_manager = frappe.session.user
	doc.save()
	frappe.db.commit()
	return {"name": doc.name, "account_manager": doc.account_manager}


@frappe.whitelist()
def submit_to_finance(docname):
	_ensure_account_manager_role()
	doc = _get_tagging_booking(docname)
	allowed_status = (
		"Pending Account Manager Review"
		if doc.booking_source == "Customer Portal"
		else "Draft"
	)
	if doc.booking_status != allowed_status:
		frappe.throw(
			_("This booking is not ready to be submitted to Finance."),
			title=_("Invalid Status"),
		)

	is_admin = "System Manager" in set(frappe.get_roles())
	if doc.booking_source == "Customer Portal":
		if not doc.account_manager:
			frappe.throw(
				_("Assign this booking to yourself before submitting it to Finance."),
				title=_("Assignment Required"),
			)
		if not is_admin and doc.account_manager != frappe.session.user:
			frappe.throw(
				_("This booking is assigned to {0}.").format(doc.account_manager),
				title=_("Not Assigned to You"),
			)

	doc._ensure_seal_journey(force=True)
	doc.booking_status = "Pending Finance PCB Approval"
	doc.account_manager_submission_date_time = now_datetime()
	doc.save()
	_set_booking_journeys_status(doc, "Pending Finance PCB Approval")
	frappe.db.commit()


@frappe.whitelist()
def approve_booking(docname, remarks=None):
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Finance PCB Approval":
		frappe.throw(
			_("Only tagging bookings pending Finance approval can be approved."),
			title=_("Invalid Status"),
		)

	doc.booking_status = "Finance PCB Approved"
	doc.finance_pcb_approver = frappe.session.user
	doc.finance_pcb_approval_date_time = now_datetime()
	doc.finance_pcb_remarks = remarks or doc.finance_pcb_remarks

	# Mark the journey approved BEFORE (re)creating the job order: the job order
	# auto-assigns the team leader on save, and its mirror only advances the
	# journey to "Team Lead Assigned" from "Finance PCB Approved". Setting the
	# status afterwards would regress that auto-advance.
	_set_booking_journeys_status(doc, "Finance PCB Approved", sync=False)
	job_order = _get_or_create_pcb_job_order(doc)
	doc.pcb_job_order_reference = job_order.name
	doc.save()
	_sync_booking_journeys(doc)
	frappe.db.commit()
	return {"pcb_job_order": job_order.name}


@frappe.whitelist()
def reject_booking(docname, remarks=None):
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Finance PCB Approval":
		frappe.throw(
			_("Only tagging bookings pending Finance approval can be rejected."),
			title=_("Invalid Status"),
		)

	doc.booking_status = "Finance PCB Rejected"
	doc.finance_pcb_approver = frappe.session.user
	doc.finance_pcb_approval_date_time = now_datetime()
	doc.finance_pcb_remarks = remarks or doc.finance_pcb_remarks
	doc.save()
	_set_booking_journeys_status(doc, "Finance PCB Rejected")
	frappe.db.commit()


@frappe.whitelist()
def amend_booking(docname, reason=None):
	"""Return a booking pending Finance review to its pre-submission state,
	same revert shape as reopen_booking() but triggered one stage earlier —
	before Finance has approved or rejected it, so there is no PCB Job Order
	to park yet."""
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Finance PCB Approval":
		frappe.throw(
			_("Only tagging bookings pending Finance approval can be amended."),
			title=_("Invalid Status"),
		)

	_guard_no_downstream_work(doc)

	doc.booking_status = (
		"Pending Account Manager Review"
		if doc.booking_source == "Customer Portal"
		else "Draft"
	)
	doc.account_manager_submission_date_time = None
	doc.finance_pcb_approver = None
	doc.finance_pcb_approval_date_time = None
	if reason:
		doc.finance_pcb_remarks = reason
	doc.save()

	_set_booking_journeys_status(doc, "Draft")
	frappe.db.commit()


# Seal Journey statuses up to (and including) the auto-assigned team leader
# stage. Beyond these a tag operator/journey work has begun and an approved
# booking can no longer be safely reopened. "Team Lead Assigned" is included
# because the lone team leader is auto-assigned on approval — that alone is not
# operational work (a tag operator being assigned is, and is guarded separately).
_REOPENABLE_JOURNEY_STATUSES = {
	"Draft",
	"Pending Finance PCB Approval",
	"Finance PCB Approved",
	"Finance PCB Rejected",
	"Team Lead Assigned",
}


@frappe.whitelist()
def reopen_booking(docname, reason=None):
	"""Return an approved tagging booking to its pre-Finance review state.

	Only allowed while no operational work has started: no tag operator may be
	assigned and the Seal Journey must not have advanced past the (auto-assigned)
	team-leader stage. The PCB Job Order is parked as Cancelled (keeping its
	number) and the Seal Journey mirror is reset to Draft."""
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Finance PCB Approved":
		frappe.throw(
			_("Only approved tagging bookings can be reopened for amendment."),
			title=_("Invalid Status"),
		)

	_guard_no_downstream_work(doc)
	_reset_pcb_job_order(doc)

	doc.booking_status = (
		"Pending Account Manager Review"
		if doc.booking_source == "Customer Portal"
		else "Draft"
	)
	doc.account_manager_submission_date_time = None
	doc.finance_pcb_approver = None
	doc.finance_pcb_approval_date_time = None
	if reason:
		doc.finance_pcb_remarks = reason
	doc.save()

	_set_booking_journeys_status(doc, "Draft")
	frappe.db.commit()


def _guard_no_downstream_work(booking):
	job_order_name = booking.pcb_job_order_reference or frappe.db.get_value(
		"PCB Job Order", {"tagging_booking": booking.name}, "name"
	)
	if job_order_name:
		status = frappe.db.get_value("PCB Job Order", job_order_name, "job_order_status")
		# Unassigned and the auto-assigned "Team Leader Assigned" are still safe;
		# Completed/Cancelled are not.
		if status not in ("Unassigned", "Team Leader Assigned"):
			frappe.throw(
				_(
					"This booking cannot be reopened — its PCB Job Order is already '{0}'."
				).format(status),
				title=_("Work Already Started"),
			)

		# A tag operator (field technician) on the assignment means real work has
		# started — the auto-assigned team leader alone does not.
		if frappe.db.exists(
			"PCB Assignment",
			{
				"pcb_job_order": job_order_name,
				"assigned_field_technician": ["is", "set"],
			},
		):
			frappe.throw(
				_(
					"This booking cannot be reopened — a tag operator is already assigned."
				),
				title=_("Work Already Started"),
			)

	for journey in booking_journey_names(booking.name):
		journey_status = frappe.db.get_value("Seal Journey", journey, "journey_status")
		if journey_status and journey_status not in _REOPENABLE_JOURNEY_STATUSES:
			frappe.throw(
				_(
					"This booking cannot be reopened — its Seal Journey has progressed to '{0}'."
				).format(journey_status),
				title=_("Work Already Started"),
			)


def _reset_pcb_job_order(booking):
	"""Cancel the booking's PCB Job Order but keep it linked, so re-approval
	reuses the same job order number instead of creating a new one. A job order
	must not be actionable while its booking is unapproved, so it is parked as
	'Cancelled' (inert — cannot be assigned) rather than left 'Unassigned'.
	Safe because the reopen guard already ensures no team leader is assigned."""
	job_order_name = booking.pcb_job_order_reference or frappe.db.get_value(
		"PCB Job Order", {"tagging_booking": booking.name}, "name"
	)
	if not job_order_name:
		return

	# An Unassigned job order has no team leader, so any PCB Assignment is a
	# stray placeholder — clear it to avoid a dangling link.
	for assignment in frappe.get_all(
		"PCB Assignment", filters={"pcb_job_order": job_order_name}, pluck="name"
	):
		frappe.delete_doc("PCB Assignment", assignment, ignore_permissions=True, force=True)

	job_order = frappe.get_doc("PCB Job Order", job_order_name)
	job_order.assigned_pcb_team_leader = None
	job_order.team_leader_assignment_date_time = None
	job_order.assignment_reference = None
	job_order.job_order_status = "Cancelled"
	job_order.save(ignore_permissions=True)


def _get_or_create_pcb_job_order(booking):
	existing = booking.pcb_job_order_reference or frappe.db.get_value(
		"PCB Job Order",
		{"tagging_booking": booking.name},
		"name",
	)
	if existing:
		# Reusing a job order from a reopened/amended booking — refresh the
		# mirrored details so any edits made while in Draft flow through.
		job_order = frappe.get_doc("PCB Job Order", existing)
		job_order.update(
			{
				"client_name": booking.client_name,
				"location": booking.location,
				"scheduled_date_time": booking.booking_date_time,
				"contact_person_name": booking.contact_person_name,
				"contact_person_phone": booking.contact_person_phone,
				# Revive a job order parked as Cancelled by a prior reopen.
				"job_order_status": "Unassigned",
			}
		)
		job_order.save(ignore_permissions=True)
		return job_order

	return frappe.get_doc(
		{
			"doctype": "PCB Job Order",
			"tagging_booking": booking.name,
			"client_name": booking.client_name,
			"location": booking.location,
			"scheduled_date_time": booking.booking_date_time,
			"contact_person_name": booking.contact_person_name,
			"contact_person_phone": booking.contact_person_phone,
			"job_order_status": "Unassigned",
		}
	).insert(ignore_permissions=True)
