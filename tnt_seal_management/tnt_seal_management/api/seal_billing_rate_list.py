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
	"creation",
	"approval_status", "approved_by", "approved_on", "approval_remarks",
]


def _can_approve_billing_rate():
	roles = set(frappe.get_roles())
	return "Managing Director" in roles or "System Manager" in roles or frappe.session.user == "Administrator"


@frappe.whitelist()
def get_billing_rate_list(search=None, billing_type="All", active="All", approval="All", page=1, page_length=25):
	page = max(1, int(page or 1))
	page_length = max(1, min(int(page_length or 25), 100))

	filters = []
	if billing_type not in ("All", None, ""):
		filters.append(["billing_type", "=", billing_type])
	if active == "Active":
		filters.append(["active", "=", 1])
	elif active == "Inactive":
		filters.append(["active", "=", 0])
	if approval not in ("All", None, ""):
		filters.append(["approval_status", "=", approval])

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
		order_by="modified desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	return {
		"rates": [dict(r) for r in rates],
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": _summary(),
		"can_approve": _can_approve_billing_rate(),
	}


def _summary():
	def count(extra=None):
		return frappe.db.count("Seal Billing Rate", filters=extra or {})

	return {
		"All": count(),
		"Subscription": count([["billing_type", "=", "Subscription"]]),
		"Leasing": count([["billing_type", "=", "Leasing"]]),
		"Active": count([["active", "=", 1]]),
		"Inactive": count([["active", "=", 0]]),
		"GlobalDefault": count([["is_global_default", "=", 1]]),
		# Rules Finance PCB has set (created or edited) that the Managing
		# Director has not yet signed off on — needs visibility on the list.
		# Both Subscription and Leasing rules go through the approval gate now,
		# so all types are counted (see _sbr_approval_cell_html).
		"PendingApproval": count([["approval_status", "=", "Pending Approval"]]),
		"Approved": count([["approval_status", "=", "Approved"]]),
		"Rejected": count([["approval_status", "=", "Rejected"]]),
	}


# ---------------------------------------------------------------------------
# Mass-assign Subscription billing rules to customers via Excel
#
# Rules are configured in Seal Billing Rate; this only writes the
# Customer <-> Billing Rule link (Customer Billing Assignment), the same as the
# "Set Billing" modal on Current Customer List — just for many customers at
# once. Subscription-only: a Subscription rule is a shared rate card and is
# expected to repeat across many rows. Leasing has no bulk-assign path — it's a
# private, per-customer contract entered directly in the Set Billing modal,
# which creates the customer's own rule rather than referencing a shared one.
# ---------------------------------------------------------------------------

ASSIGNMENT_TEMPLATE_COLUMNS = ["Customer", "Billing Rule", "Period From Date", "Period To Date"]
ASSIGNMENT_REQUIRED_COLUMNS = {"Customer", "Billing Rule"}


def _ensure_billing_access():
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)


@frappe.whitelist()
def download_subscription_assignment_template():
	_ensure_billing_access()
	rows = [
		ASSIGNMENT_TEMPLATE_COLUMNS,
		["CUST-00001", "Default Monthly", "2026-01-01", "2026-12-31"],
	]
	build_xlsx_response(rows, "Subscription Billing Assignment Template")


@frappe.whitelist()
def import_subscription_assignments(file_url):
	_ensure_billing_access()
	return _import_assignments(file_url)


def _import_assignments(file_url):
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
			rule = _resolve_rule(rule_value)

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


def _resolve_rule(value):
	rule_filters = {"billing_type": "Subscription", "active": 1, "approval_status": "Approved"}

	if frappe.db.exists("Seal Billing Rate", {"name": value, **rule_filters}):
		return frappe._dict(name=value)

	matches = frappe.get_all(
		"Seal Billing Rate",
		filters={"billing_rule_name": value, **rule_filters},
		fields=["name"],
		limit=2,
	)
	if len(matches) == 1:
		return matches[0]
	if not matches:
		frappe.throw(_("Active, approved Subscription billing rule {0} not found.").format(value))
	frappe.throw(
		_("Billing rule name {0} matches more than one active, approved Subscription rule — rename them or use the rule ID.").format(
			value
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
