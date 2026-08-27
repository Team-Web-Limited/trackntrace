# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, getdate, now_datetime, today

from tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment import (
	_ensure_journey_request,
	_seal_journey_for_job_order,
)
from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
	sync_seal_journey_mirror,
)


class PCBJobOrder(Document):
	def validate(self):
		self._guard_cancelled_edits()
		self._auto_assign_team_leader()
		self._validate_team_leader()
		self._sync_assignment()

	def _guard_cancelled_edits(self):
		"""Block any field edits while a job order remains Cancelled.
		Allows transitions TO or FROM Cancelled (reopen/re-approval flows)."""
		if self.is_new() or self.job_order_status != "Cancelled":
			return
		prev = self.get_doc_before_save()
		if not prev or prev.job_order_status != "Cancelled":
			return
		for fieldname in ("assigned_pcb_team_leader", "remarks"):
			if self.get(fieldname) != prev.get(fieldname):
				frappe.throw(
					_("Cancelled job orders cannot be modified."),
					title=_("Invalid Action"),
				)

	def _auto_assign_team_leader(self):
		"""Auto-fill the PCB Team Leader when none is set. The business currently
		has a single team leader, so every new (Unassigned) job order is assigned
		to them automatically; a manual selection still takes precedence, and a
		Cancelled/Completed job order is never auto-assigned."""
		if self.assigned_pcb_team_leader:
			return
		if self.job_order_status and self.job_order_status != "Unassigned":
			return

		team_leader = _get_sole_team_leader()
		if team_leader:
			self.assigned_pcb_team_leader = team_leader

	def on_update(self):
		self._mirror_to_seal_journey()

	def _mirror_to_seal_journey(self):
		"""Keep the Seal Journey mirror in step when a PCB Team Leader is assigned
		on the job order. Advances the journey to "Team Lead Assigned" only from
		the immediately preceding stage so re-saving a job order never regresses a
		journey that is already further along."""
		seal_journey = _seal_journey_for_job_order(self.name)
		if not seal_journey:
			return
		if self.assigned_pcb_team_leader and self.job_order_status == "Team Leader Assigned":
			current = frappe.db.get_value("Seal Journey", seal_journey, "journey_status")
			if current == "Finance PCB Approved":
				set_journey_status(seal_journey, "Team Lead Assigned")
		sync_seal_journey_mirror(seal_journey)

	def _validate_team_leader(self):
		if not self.assigned_pcb_team_leader:
			return

		has_role = frappe.db.exists(
			"Has Role",
			{
				"parent": self.assigned_pcb_team_leader,
				"parenttype": "User",
				"role": "PCB Team Leader",
			},
		)
		if not has_role:
			frappe.throw(
				_("{0} is not a PCB Team Leader.").format(self.assigned_pcb_team_leader),
				title=_("Invalid Team Leader"),
			)

	def _sync_assignment(self):
		if self.assigned_pcb_team_leader:
			if not self.team_leader_assignment_date_time:
				self.team_leader_assignment_date_time = now_datetime()
			if self.job_order_status == "Unassigned":
				self.job_order_status = "Team Leader Assigned"
		elif self.job_order_status == "Team Leader Assigned":
			self.job_order_status = "Unassigned"
			self.team_leader_assignment_date_time = None

		assignment_name = self.assignment_reference or frappe.db.get_value(
			"PCB Assignment",
			{"pcb_job_order": self.name, "assignment_status": ["!=", "Cancelled"]},
			"name",
		)
		if not assignment_name:
			return

		if self.assignment_reference != assignment_name:
			self.assignment_reference = assignment_name

		assignment = frappe.get_doc("PCB Assignment", assignment_name)
		assignment.update(
			{
				"pcb_job_order": self.name,
				"tagging_booking": self.tagging_booking,
				"client_name": self.client_name,
				"location": self.location,
				"scheduled_date_time": self.scheduled_date_time,
				"contact_person_name": self.contact_person_name,
				"contact_person_phone": self.contact_person_phone,
				"pcb_team_leader": self.assigned_pcb_team_leader,
			}
		)
		assignment.save(ignore_permissions=True)


def _get_sole_team_leader():
	"""Return the single enabled PCB Team Leader user, or None when there isn't
	exactly one. This will be revisited once the team-leader identification rule
	is finalised; for now a lone team leader is auto-assigned to job orders."""
	users = frappe.get_all(
		"Has Role",
		filters={"role": "PCB Team Leader", "parenttype": "User"},
		pluck="parent",
		distinct=True,
	)
	enabled = [
		user
		for user in users
		if user not in ("Administrator", "Guest")
		and frappe.db.get_value("User", user, "enabled")
	]
	return enabled[0] if len(enabled) == 1 else None


def _ensure_assignment_permission(job_order):
	roles = set(frappe.get_roles())
	if "System Manager" in roles:
		return
	if "PCB Team Leader" not in roles:
		frappe.throw(
			_("Only the assigned PCB Team Leader can assign a Tag Operator."),
			title=_("Insufficient Permission"),
		)
	if job_order.assigned_pcb_team_leader != frappe.session.user:
		frappe.throw(
			_("This job order is assigned to PCB Team Leader {0}.").format(
				job_order.assigned_pcb_team_leader or _("Not assigned")
			),
			title=_("Job Order Not Assigned to You"),
		)


def _validate_field_technician(user):
	if not frappe.db.exists(
		"Has Role",
		{"parent": user, "parenttype": "User", "role": "Field Technician"},
	):
		frappe.throw(
			_("{0} is not a Field Technician (Tag Operator).").format(user),
			title=_("Invalid Tag Operator"),
		)


def _get_assignment_name(job_order):
	"""A Cancelled assignment is terminal — never rediscover and silently reuse
	it for a new Tag Operator; a fresh PCB Assignment is created instead."""
	return job_order.assignment_reference or frappe.db.get_value(
		"PCB Assignment",
		{"pcb_job_order": job_order.name, "assignment_status": ["!=", "Cancelled"]},
		"name",
	)


def _new_assignment_fields(job_order):
	return {
		"doctype": "PCB Assignment",
		"pcb_job_order": job_order.name,
		"tagging_booking": job_order.tagging_booking,
		"client_name": job_order.client_name,
		"location": job_order.location,
		"scheduled_date_time": job_order.scheduled_date_time,
		"contact_person_name": job_order.contact_person_name,
		"contact_person_phone": job_order.contact_person_phone,
		"pcb_team_leader": job_order.assigned_pcb_team_leader,
		"assigned_by": frappe.session.user,
		"assignment_date_time": now_datetime(),
	}


def _ensure_assignment(job_order):
	"""Create the PCB Assignment for this job order if it doesn't exist yet,
	or normalize its status if it does. Returns the PCB Assignment doc."""
	assignment_name = _get_assignment_name(job_order)
	if assignment_name:
		assignment = frappe.get_doc("PCB Assignment", assignment_name)
		if assignment.assignment_status != "Cancelled":
			assignment.assignment_status = (
				"Assigned" if assignment.assigned_field_technician else "Pending"
			)
			assignment.save(ignore_permissions=True)
	else:
		assignment = frappe.get_doc(
			{**_new_assignment_fields(job_order), "assignment_status": "Pending"}
		).insert(ignore_permissions=True)

	if job_order.assignment_reference != assignment.name:
		job_order.assignment_reference = assignment.name

	return assignment


@frappe.whitelist()
def assign_to_field_technician(job_order_name, field_technician):
	job_order = frappe.get_doc("PCB Job Order", job_order_name)
	job_order.check_permission("write")
	_ensure_assignment_permission(job_order)
	_validate_field_technician(field_technician)

	if job_order.job_order_status in ("Completed", "Cancelled"):
		frappe.throw(
			_("Completed or cancelled job orders cannot be assigned."),
			title=_("Invalid Status"),
		)

	assignment_name = _get_assignment_name(job_order)
	if assignment_name:
		assignment = frappe.get_doc("PCB Assignment", assignment_name)
		assignment.assigned_field_technician = field_technician
		assignment.assignment_status = "Assigned"
		assignment.assigned_by = frappe.session.user
		assignment.assignment_date_time = now_datetime()
		assignment.save(ignore_permissions=True)
	else:
		assignment = frappe.get_doc(
			{
				**_new_assignment_fields(job_order),
				"assigned_field_technician": field_technician,
				"assignment_status": "Assigned",
			}
		).insert(ignore_permissions=True)

	job_order.assignment_reference = assignment.name
	job_order.save(ignore_permissions=True)

	_ensure_journey_request(assignment)

	frappe.db.commit()

	return {"assignment": assignment.name}


def _ensure_status_update_permission():
	roles = set(frappe.get_roles())
	if not roles & {"System Manager", "Finance PCB"}:
		frappe.throw(
			_("Only Finance PCB can update the Job Order status."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def update_job_order_status(job_order_name, status):
	if status not in ("Completed", "Cancelled"):
		frappe.throw(_("Invalid status {0}.").format(status), title=_("Invalid Status"))

	job_order = frappe.get_doc("PCB Job Order", job_order_name)
	job_order.check_permission("write")
	_ensure_status_update_permission()

	if job_order.job_order_status in ("Completed", "Cancelled"):
		frappe.throw(
			_("This job order is already {0}.").format(job_order.job_order_status),
			title=_("Invalid Status"),
		)

	if status == "Completed" and not job_order.assigned_pcb_team_leader:
		frappe.throw(
			_("Cannot mark this job order as Completed before a PCB Team Leader is assigned."),
			title=_("PCB Team Leader Not Assigned"),
		)

	if status == "Completed":
		assignment = _ensure_assignment(job_order)

	job_order.job_order_status = status
	job_order.save(ignore_permissions=True)
	frappe.db.commit()

	result = {"job_order_status": job_order.job_order_status}
	if status == "Completed":
		result["assignment"] = assignment.name
	return result


def _build_job_order_filters(search=None, status=None, team_leader=None, from_date=None, to_date=None):
	if from_date and to_date and getdate(from_date) > getdate(to_date):
		frappe.throw(_("From Date cannot be after To Date."))

	base_filters = []
	if team_leader:
		base_filters.append(["assigned_pcb_team_leader", "=", team_leader])
	if from_date:
		base_filters.append(["scheduled_date_time", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["scheduled_date_time", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["tagging_booking", "like", search_text],
			["client_name", "like", search_text],
			["location", "like", search_text],
			["contact_person_name", "like", search_text],
			["contact_person_phone", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["job_order_status", "=", status])

	return base_filters, or_filters, filters


@frappe.whitelist()
def get_job_order_list(
	search=None,
	status=None,
	team_leader=None,
	from_date=None,
	to_date=None,
	page=1,
	page_length=25,
):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	base_filters, or_filters, filters = _build_job_order_filters(
		search, status, team_leader, from_date, to_date
	)

	job_orders = frappe.get_list(
		"PCB Job Order",
		fields=[
			"name",
			"tagging_booking",
			"client_name",
			"location",
			"scheduled_date_time",
			"contact_person_name",
			"contact_person_phone",
			"assigned_pcb_team_leader",
			"assignment_reference",
			"job_order_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="scheduled_date_time desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_rows = frappe.get_list(
		"PCB Job Order",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_rows[0].count) if total_rows else 0

	summary = {
		"All": 0,
		"Unassigned": 0,
		"Team Leader Assigned": 0,
		"Completed": 0,
		"Cancelled": 0,
	}
	summary_rows = frappe.get_list(
		"PCB Job Order",
		fields=["job_order_status", "count(*) as count"],
		filters=base_filters,
		or_filters=or_filters,
		group_by="job_order_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.job_order_status in summary:
			summary[row.job_order_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"job_orders": job_orders,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}


@frappe.whitelist()
def get_all_job_orders_for_export(search=None, status=None, team_leader=None, from_date=None, to_date=None):
	"""Same filters as get_job_order_list but unpaginated, for the PDF export."""
	_, or_filters, filters = _build_job_order_filters(search, status, team_leader, from_date, to_date)

	return frappe.get_list(
		"PCB Job Order",
		fields=[
			"name",
			"tagging_booking",
			"client_name",
			"location",
			"scheduled_date_time",
			"contact_person_name",
			"contact_person_phone",
			"assigned_pcb_team_leader",
			"job_order_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="scheduled_date_time desc, creation desc",
		limit_page_length=0,
	)


_EXPORT_ROLES = {
	"System Manager",
	"Finance PCB",
	"Management",
	"Managing Director",
	"PCB Team Leader",
}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the PCB Job Order list's currently filtered table (built
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
	("Job Order", "name", 20),
	("Tagging Booking", "tagging_booking", 20),
	("Client", "client_name", 28),
	("Location", "location", 24),
	("Scheduled", "scheduled_date_time", 20),
	("Contact Person", "contact_person_name", 24),
	("Phone", "contact_person_phone", 18),
	("PCB Team Leader", "assigned_pcb_team_leader", 24),
	("Status", "job_order_status", 26),
)


@frappe.whitelist()
def export_excel(search=None, status=None, team_leader=None, from_date=None, to_date=None, filename=None):
	"""Render the PCB Job Order list's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	job_orders = get_all_job_orders_for_export(search, status, team_leader, from_date, to_date)
	if not job_orders:
		frappe.throw(_("No PCB Job Orders match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	for job_order in job_orders:
		row = []
		for label, fieldname, width in _EXPORT_COLUMNS:
			value = job_order.get(fieldname)
			if fieldname == "scheduled_date_time" and value:
				value = frappe.utils.get_datetime(value).strftime("%Y-%m-%d %H:%M:%S")
			row.append(cstr(value) if value not in (None, "") else "")
		data.append(row)

	xlsx_file = make_xlsx(
		data,
		"PCB Job Orders",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"PCB Job Order Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export PCB job orders."),
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
