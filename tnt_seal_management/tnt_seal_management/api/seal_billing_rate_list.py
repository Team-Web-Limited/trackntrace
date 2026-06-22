# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _

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
