# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.utils import getdate
from frappe.utils.xlsxutils import (
	build_xlsx_response,
	read_xls_file_from_attached_file,
	read_xlsx_file_from_attached_file,
)

from tnt_seal_management.tnt_seal_management.api.current_customers import _upsert_customer_assignment

_FIELDS = [
	"name", "billing_rule_name", "billing_type", "active",
	"currency", "billing_period_type", "is_global_default",
	"first_period_days", "first_period_amount", "extra_day_rate",
	"effective_from", "effective_to", "creation",
]


@frappe.whitelist()
def get_billing_rate_list(search=None, billing_type="All", active="All", page=1, page_length=25):
	page = max(1, int(page or 1))
	page_length = max(1, min(int(page_length or 25), 100))

	filters = []
	if billing_type not in ("All", None, ""):
		filters.append(["billing_type", "=", billing_type])
	if active == "Active":
		filters.append(["active", "=", 1])
	elif active == "Inactive":
		filters.append(["active", "=", 0])

	or_filters = []
	if search:
		like = f"%{search}%"
		or_filters = [
			["name", "like", like],
			["billing_rule_name", "like", like],
			["billing_type", "like", like],
			["billing_period_type", "like", like],
			["currency", "like", like],
		]

	total = frappe.db.count("Seal Billing Rate", filters=filters)

	rates = frappe.db.get_all(
		"Seal Billing Rate",
		filters=filters,
		or_filters=or_filters or None,
		fields=_FIELDS,
		order_by="creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	return {
		"rates": [dict(r) for r in rates],
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": _summary(),
	}


def _summary():
	def count(extra=None):
		return frappe.db.count("Seal Billing Rate", filters=extra or {})

	return {
		"All": count(),
		"Default": count([["billing_type", "=", "Default"]]),
		"Special": count([["billing_type", "=", "Special"]]),
		"Active": count([["active", "=", 1]]),
		"Inactive": count([["active", "=", 0]]),
		"GlobalDefault": count([["is_global_default", "=", 1]]),
	}


# ---------------------------------------------------------------------------
# Mass-assign billing rules to customers via Excel
#
# Rules are configured in Seal Billing Rate; this only writes the
# Customer <-> Billing Rule link (Customer Billing Assignment), the same as the
# "Set Billing" modal on Current Customer List — just for many customers at
# once. Default and Special use separate sheets/templates because they
# validate differently: a Default rule is expected to repeat across many rows
# (a shared rate card), while a Special rule is a private, per-customer
# contract and must not be reused across rows in the same import.
# ---------------------------------------------------------------------------

ASSIGNMENT_TEMPLATE_COLUMNS = ["Customer", "Billing Rule", "Period From Date", "Period To Date"]
ASSIGNMENT_REQUIRED_COLUMNS = {"Customer", "Billing Rule"}


def _ensure_billing_access():
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)


@frappe.whitelist()
def download_default_assignment_template():
	_ensure_billing_access()
	rows = [
		ASSIGNMENT_TEMPLATE_COLUMNS,
		["CUST-00001", "Default Monthly", "2026-01-01", "2026-12-31"],
	]
	build_xlsx_response(rows, "Default Billing Assignment Template")


@frappe.whitelist()
def download_special_assignment_template():
	_ensure_billing_access()
	rows = [
		ASSIGNMENT_TEMPLATE_COLUMNS,
		["CUST-00042", "Apex Transit — Special Contract", "2026-01-01", "2026-12-31"],
	]
	build_xlsx_response(rows, "Special Billing Assignment Template")


@frappe.whitelist()
def import_default_assignments(file_url):
	_ensure_billing_access()
	return _import_assignments(file_url, "Default")


@frappe.whitelist()
def import_special_assignments(file_url):
	_ensure_billing_access()
	return _import_assignments(file_url, "Special")


def _import_assignments(file_url, billing_type):
	if not file_url:
		frappe.throw(_("Attach an Excel file before importing."))

	rows = _read_excel_rows(file_url)
	if not rows:
		frappe.throw(_("No rows found in the uploaded file."))

	header = [str(cell or "").strip() for cell in rows[0]]
	index = {label: pos for pos, label in enumerate(header) if label}
	missing = sorted(ASSIGNMENT_REQUIRED_COLUMNS - set(index))
	if missing:
		frappe.throw(_("Missing required columns: {0}").format(", ".join(missing)))

	updated = 0
	errors = []
	seen_rules = set()

	for row_no, row in enumerate(rows[1:], start=2):
		if _is_blank(row):
			continue

		customer_value = _cell(row, index.get("Customer"))
		rule_value = _cell(row, index.get("Billing Rule"))
		period_from_value = _cell(row, index.get("Period From Date"))
		period_to_value = _cell(row, index.get("Period To Date"))

		save_point = f"mass_assign_row_{row_no}"
		frappe.db.savepoint(save_point)
		try:
			if not customer_value:
				frappe.throw(_("Customer is required."))
			if not rule_value:
				frappe.throw(_("Billing Rule is required."))

			customer_name = _resolve_customer(customer_value)
			rule = _resolve_rule(rule_value, billing_type)

			if billing_type == "Special":
				if rule.name in seen_rules:
					frappe.throw(
						_("Special rule {0} is assigned to more than one row in this file.").format(rule.name)
					)
				seen_rules.add(rule.name)

			_upsert_customer_assignment(
				customer_name,
				rule.name,
				effective_from=getdate(period_from_value) if period_from_value else None,
				effective_to=getdate(period_to_value) if period_to_value else None,
			)
			frappe.db.release_savepoint(save_point)
			updated += 1
		except Exception as e:
			frappe.db.rollback(save_point=save_point)
			errors.append({"row": row_no, "message": str(e)})

	frappe.db.commit()
	return {"updated": updated, "errors": errors}


def _resolve_customer(value):
	if frappe.db.exists("Customer", value):
		return value

	matches = frappe.get_all("Customer", filters={"customer_name": value}, fields=["name"], limit=2)
	if len(matches) == 1:
		return matches[0].name
	if not matches:
		frappe.throw(_("Customer {0} not found.").format(value))
	frappe.throw(_("Customer name {0} matches more than one customer — use the Customer ID instead.").format(value))


def _resolve_rule(value, billing_type):
	if frappe.db.exists("Seal Billing Rate", {"name": value, "billing_type": billing_type, "active": 1}):
		return frappe._dict(name=value)

	matches = frappe.get_all(
		"Seal Billing Rate",
		filters={"billing_rule_name": value, "billing_type": billing_type, "active": 1},
		fields=["name"],
		limit=2,
	)
	if len(matches) == 1:
		return matches[0]
	if not matches:
		frappe.throw(_("Active {0} billing rule {1} not found.").format(billing_type, value))
	frappe.throw(
		_("Billing rule name {0} matches more than one active {1} rule — rename them or use the rule ID.").format(
			value, billing_type
		)
	)


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


def _cell(row, idx):
	if idx is None or idx >= len(row):
		return ""
	value = row[idx]
	if value is None:
		return ""
	return str(value).strip()


def _is_blank(row):
	return not any(str(cell or "").strip() for cell in row)
