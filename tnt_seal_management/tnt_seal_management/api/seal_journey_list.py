# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _

_FIELDS = [
	"name", "customer", "vehicle_plate_number", "container_number",
	"origin", "destination", "journey_status",
	"journey_start_date_time", "arrival_date_time", "completion_date_time",
	"assigned_seal", "creation", "days_taken"
]

_TERMINAL_STATUSES = ("Completed", "Cancelled")

@frappe.whitelist()
def get_seal_journey_list_data(status="All", search=None, page=1, page_length=30):
	page = max(1, int(page or 1))
	page_length = max(1, min(int(page_length or 30), 100))

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

	total = frappe.db.count("Seal Journey", filters=filters)

	journeys = frappe.db.get_all(
		"Seal Journey",
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

def _summary():
	def count(extra=None):
		return frappe.db.count("Seal Journey", filters=extra or {})

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
