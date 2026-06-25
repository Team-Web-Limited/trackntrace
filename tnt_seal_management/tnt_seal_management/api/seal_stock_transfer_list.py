# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.utils import cint, nowdate
from frappe.utils.xlsxutils import (
	build_xlsx_response,
	read_xls_file_from_attached_file,
	read_xlsx_file_from_attached_file,
)


SEAL_STOCK_TRANSFER_ROLES = {
	"System Manager",
	"Seal System Administrator",
	"Operations Control Room",
	"Management",
}

TEMPLATE_COLUMNS = ["Seal Device", "Seal Number"]
REQUIRED_COLUMNS = {"Seal Device"}


def _ensure_access(write=False):
	if frappe.session.user == "Administrator":
		return
	roles = set(frappe.get_roles())
	if roles & SEAL_STOCK_TRANSFER_ROLES:
		return
	if not write and "Field Technician" in roles:
		return
	frappe.throw(_("You are not permitted to access seal stock transfers."), frappe.PermissionError)


@frappe.whitelist()
def get_seal_stock_transfer_list(
	search=None,
	status="All",
	source_warehouse=None,
	target_warehouse=None,
	page=1,
	page_length=25,
):
	_ensure_access()

	page = max(1, cint(page) or 1)
	page_length = max(1, min(cint(page_length) or 25, 100))

	filters = []
	if status and status != "All":
		filters.append(["transfer_status", "=", status])
	if source_warehouse:
		filters.append(["source_warehouse", "=", source_warehouse])
	if target_warehouse:
		filters.append(["target_warehouse", "=", target_warehouse])

	or_filters = []
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["source_warehouse", "like", like],
			["target_warehouse", "like", like],
			["sent_by", "like", like],
			["received_by", "like", like],
		]

	transfers = frappe.get_all(
		"Seal Stock Transfer",
		filters=filters,
		or_filters=or_filters or None,
		fields=[
			"name",
			"transfer_status",
			"source_warehouse",
			"target_warehouse",
			"transfer_date",
			"received_date",
			"sent_by",
			"received_by",
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
			"Seal Stock Transfer",
			filters=filters,
			or_filters=or_filters or None,
			fields=["name"],
			limit_page_length=0,
		)
	)

	summary = {
		"All": frappe.db.count("Seal Stock Transfer"),
		"Draft": frappe.db.count("Seal Stock Transfer", {"transfer_status": "Draft"}),
		"In Transit": frappe.db.count("Seal Stock Transfer", {"transfer_status": "In Transit"}),
		"Received": frappe.db.count("Seal Stock Transfer", {"transfer_status": "Received"}),
		"Cancelled": frappe.db.count("Seal Stock Transfer", {"transfer_status": "Cancelled"}),
	}

	return {
		"transfers": transfers,
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
		["SEAL-0001", "SEAL-0001"],
		[],
		["Notes"],
		["Required columns", ", ".join(sorted(REQUIRED_COLUMNS))],
		["Seal Device", "Use the Seal Device document name. In this system it normally matches the Seal Number."],
		["Parent details", "Source warehouse, target warehouse and transfer date are selected in the import modal."],
	]
	build_xlsx_response(rows, "Seal Stock Transfer Import Template")


@frappe.whitelist()
def import_from_excel(
	file_url,
	source_warehouse,
	target_warehouse,
	transfer_date=None,
	remarks=None,
):
	_ensure_access(write=True)
	if not file_url:
		frappe.throw(_("Attach an Excel file before importing."))
	if not source_warehouse:
		frappe.throw(_("Source Warehouse is required."))
	if not target_warehouse:
		frappe.throw(_("Target Warehouse is required."))
	if source_warehouse == target_warehouse:
		frappe.throw(_("Source and target warehouses must be different."))

	rows = _read_excel_rows(file_url)
	items = _parse_rows(rows)
	if not items:
		frappe.throw(_("No seal rows found in the uploaded file."))

	doc = frappe.get_doc(
		{
			"doctype": "Seal Stock Transfer",
			"source_warehouse": source_warehouse,
			"target_warehouse": target_warehouse,
			"transfer_date": transfer_date or nowdate(),
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
		seal_device = _cell(row, index["Seal Device"])
		if not seal_device:
			continue
		if seal_device in seen:
			frappe.throw(_("Row {0}: Seal Device {1} appears more than once.").format(row_no, seal_device))
		seen.add(seal_device)
		items.append({"seal_device": seal_device})
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
	return values[0] in {"Notes", "Required columns", "Seal Device", "Parent details"}
