# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate
from frappe.utils.xlsxutils import (
	build_xlsx_response,
	read_xls_file_from_attached_file,
	read_xlsx_file_from_attached_file,
)


SEAL_ACQUISITION_ROLES = {
	"System Manager",
	"Seal System Administrator",
	"Operations Control Room",
	"Management",
}

TEMPLATE_COLUMNS = [
	"Seal Number",
	"Device ID",
	"IMEI Number",
	"Serial Number",
	"Seal Type",
	"Purchase Cost",
]

REQUIRED_COLUMNS = {"Seal Number", "Device ID"}


def _ensure_access(write=False):
	if frappe.session.user == "Administrator":
		return
	roles = set(frappe.get_roles())
	if roles & SEAL_ACQUISITION_ROLES:
		return
	if not write and "Field Technician" in roles:
		return
	frappe.throw(_("You are not permitted to access seal acquisitions."), frappe.PermissionError)


@frappe.whitelist()
def get_seal_acquisition_list(search=None, status="All", warehouse=None, page=1, page_length=25):
	_ensure_access()

	page = max(1, cint(page) or 1)
	page_length = max(1, min(cint(page_length) or 25, 100))

	filters = []
	if status and status != "All":
		filters.append(["acquisition_status", "=", status])
	if warehouse:
		filters.append(["target_warehouse", "=", warehouse])

	or_filters = []
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["supplier", "like", like],
			["invoice_reference", "like", like],
			["target_warehouse", "like", like],
		]

	acquisitions = frappe.get_all(
		"Seal Acquisition",
		filters=filters,
		or_filters=or_filters or None,
		fields=[
			"name",
			"acquisition_status",
			"supplier",
			"invoice_reference",
			"received_date",
			"target_warehouse",
			"default_status",
			"total_seals",
			"docstatus",
			"modified",
		],
		order_by="modified desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total = len(
		frappe.get_all(
			"Seal Acquisition",
			filters=filters,
			or_filters=or_filters or None,
			fields=["name"],
			limit_page_length=0,
		)
	)

	summary = {
		"All": frappe.db.count("Seal Acquisition"),
		"Draft": frappe.db.count("Seal Acquisition", {"acquisition_status": "Draft"}),
		"Received": frappe.db.count("Seal Acquisition", {"acquisition_status": "Received"}),
		"Cancelled": frappe.db.count("Seal Acquisition", {"acquisition_status": "Cancelled"}),
	}

	return {
		"acquisitions": acquisitions,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}


@frappe.whitelist()
def download_template():
	_ensure_access()
	rows = [
		TEMPLATE_COLUMNS,
		[
			"SEAL-0001",
			"DEV-0001",
			"359762089123456",
			"SN-0001",
			"Electronic Seal",
			12500,
		],
		[],
		["Notes"],
		["Required columns", ", ".join(sorted(REQUIRED_COLUMNS))],
		["Optional columns", "IMEI Number, Serial Number, Seal Type, Purchase Cost"],
		["Parent details", "Supplier, invoice, receiving warehouse, received date and initial status are selected in the import modal."],
	]
	build_xlsx_response(rows, "Seal Acquisition Import Template")


@frappe.whitelist()
def import_from_excel(
	file_url,
	target_warehouse,
	received_date=None,
	default_status="Quality Check",
	supplier=None,
	invoice_reference=None,
	remarks=None,
):
	_ensure_access(write=True)
	if not file_url:
		frappe.throw(_("Attach an Excel file before importing."))
	if not target_warehouse:
		frappe.throw(_("Receiving Warehouse is required."))
	if default_status not in {"Quality Check", "Available"}:
		frappe.throw(_("Initial Seal Status must be Quality Check or Available."))

	rows = _read_excel_rows(file_url)
	items = _parse_rows(rows)
	if not items:
		frappe.throw(_("No seal rows found in the uploaded file."))

	doc = frappe.get_doc(
		{
			"doctype": "Seal Acquisition",
			"supplier": supplier,
			"invoice_reference": invoice_reference,
			"received_date": received_date or nowdate(),
			"target_warehouse": target_warehouse,
			"default_status": default_status,
			"remarks": remarks,
			"seals": items,
		}
	)
	doc.insert()
	return {"name": doc.name, "total_seals": len(items)}


def _read_excel_rows(file_url):
	file_name = frappe.db.get_value("File", {"file_url": file_url})
	if not file_name:
		frappe.throw(_("Uploaded file was not found."))
	file_doc = frappe.get_doc("File", file_name)
	content = file_doc.get_content()
	extension = os.path.splitext(file_doc.file_name or file_url)[1].lower().lstrip(".")

	if extension == "xlsx":
		return read_xlsx_file_from_attached_file(fcontent=content, read_only=True)
	if extension == "xls":
		return read_xls_file_from_attached_file(content)
	frappe.throw(_("Only .xlsx and .xls files are supported."))


def _parse_rows(rows):
	if not rows:
		return []

	header = [str(cell or "").strip() for cell in rows[0]]
	index = {label: pos for pos, label in enumerate(header) if label}
	missing = sorted(REQUIRED_COLUMNS - set(index))
	if missing:
		frappe.throw(_("Missing required columns: {0}").format(", ".join(missing)))

	items = []
	seen = set()
	for row_no, row in enumerate(rows[1:], start=2):
		if _is_note_or_blank(row):
			continue
		seal_number = _cell(row, index["Seal Number"])
		device_id = _cell(row, index["Device ID"])
		if not seal_number and not device_id:
			continue
		if not seal_number or not device_id:
			frappe.throw(_("Row {0}: Seal Number and Device ID are required.").format(row_no))
		if seal_number in seen:
			frappe.throw(_("Row {0}: Seal Number {1} appears more than once.").format(row_no, seal_number))
		seen.add(seal_number)
		items.append(
			{
				"seal_number": seal_number,
				"device_id": device_id,
				"imei_number": _cell(row, index.get("IMEI Number")),
				"serial_number": _cell(row, index.get("Serial Number")),
				"seal_type": _cell(row, index.get("Seal Type")),
				"purchase_cost": flt(_cell(row, index.get("Purchase Cost"))),
			}
		)
	return items


def _cell(row, idx):
	if idx is None or idx >= len(row):
		return ""
	value = row[idx]
	if value is None:
		return ""
	return str(value).strip()


def _is_note_or_blank(row):
	values = [str(cell or "").strip() for cell in row]
	if not any(values):
		return True
	return values[0] in {"Notes", "Required columns", "Optional columns", "Parent details"}
