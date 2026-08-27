# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe

_FIELDS = [
	"name", "billing_rule_name", "billing_type", "journey_type", "active",
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
			# Both of a customer's rate sets share one rule name, so searching
			# "Import" / "Local" is how they're told apart from the search box.
			["journey_type", "like", like],
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
