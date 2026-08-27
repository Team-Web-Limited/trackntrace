# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cstr, today

_FIELDS = [
	"name", "customer", "vehicle_plate_number", "container_number",
	"origin", "destination", "journey_status",
	"journey_start_date_time", "arrival_date_time", "completion_date_time",
	"assigned_seal", "creation", "days_taken"
]

_DOCTYPE = "Seal Journey"
_TERMINAL_STATUSES = ("Completed", "Cancelled")


def _build_seal_journey_filters(status="All", search=None):
	filters = []
	if status == "Active":
		filters.append(["journey_status", "not in", _TERMINAL_STATUSES + ("Draft",)])
	elif status == "Pending Billing":
		# Billing is a separate axis from the journey lifecycle — this surfaces the
		# completed-but-unsettled journeys that have left the active views.
		filters.append(["billing_status", "=", "Pending Billing"])
	elif status in ("Completed", "Cancelled", "Draft"):
		filters.append(["journey_status", "=", status])

	or_filters = []
	if search:
		like = f"%{search}%"
		or_filters = [
			["name", "like", like],
			["customer", "like", like],
			["vehicle_plate_number", "like", like],
			["container_number", "like", like],
			["assigned_seal", "like", like],
		]

	return filters, or_filters


@frappe.whitelist()
def get_seal_journey_list_data(status="All", search=None, page=1, page_length=30):
	page = max(1, int(page or 1))
	page_length = max(1, min(int(page_length or 30), 100))

	filters, or_filters = _build_seal_journey_filters(status, search)

	total = frappe.db.count(_DOCTYPE, filters=filters)

	journeys = frappe.db.get_all(
		_DOCTYPE,
		filters=filters,
		or_filters=or_filters or None,
		fields=_FIELDS,
		order_by="modified desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
		distinct=1
	)

	return {
		"journeys": [dict(j) for j in journeys],
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": _summary(),
	}

@frappe.whitelist()
def get_all_seal_journeys_for_export(status="All", search=None):
	"""Same filters as get_seal_journey_list_data but unpaginated, for the PDF export."""
	filters, or_filters = _build_seal_journey_filters(status, search)

	journeys = frappe.db.get_all(
		_DOCTYPE,
		filters=filters,
		or_filters=or_filters or None,
		fields=_FIELDS,
		order_by="modified desc",
		distinct=1,
	)
	return [dict(j) for j in journeys]


_EXPORT_ROLES = {
	"System Manager",
	"Account Manager",
	"Managing Director",
	"Finance PCB",
	"Operations Control Room",
}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Seal Journey list's currently filtered table (built
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


# (label, fieldname, column width). Route and Duration are computed at export
# time (same as the PDF row rendering) rather than stored fields.
_EXPORT_COLUMNS = (
	("Journey ID", "name", 20),
	("Customer", "customer", 28),
	("Vehicle", "vehicle_plate_number", 18),
	("Container", "container_number", 18),
	("Origin", "origin", 22),
	("Destination", "destination", 22),
	("Duration (days)", "days_taken", 16),
	("Status", "journey_status", 20),
)


@frappe.whitelist()
def export_excel(status="All", search=None, filename=None):
	"""Render the Seal Journey list's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	journeys = get_all_seal_journeys_for_export(status, search)
	if not journeys:
		frappe.throw(_("No journeys match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	for journey in journeys:
		row = []
		for label, fieldname, width in _EXPORT_COLUMNS:
			value = journey.get(fieldname)
			if fieldname == "days_taken" and value:
				value = round(float(value), 1)
			row.append(cstr(value) if value not in (None, "") else "")
		data.append(row)

	xlsx_file = make_xlsx(
		data,
		"Seal Journeys",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"Seal Journey Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export seal journeys."),
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


def _summary():
	def count(extra=None):
		return frappe.db.count(_DOCTYPE, filters=extra or {})

	all_count = count()
	completed = count([["journey_status", "=", "Completed"]])
	active = count([["journey_status", "not in", _TERMINAL_STATUSES + ("Draft",)]])
	cancelled = count([["journey_status", "=", "Cancelled"]])
	pending_billing = count([["billing_status", "=", "Pending Billing"]])

	return {
		"All": all_count,
		"Active": active,
		"Pending Billing": pending_billing,
		"Completed": completed,
		"Cancelled": cancelled,
	}
