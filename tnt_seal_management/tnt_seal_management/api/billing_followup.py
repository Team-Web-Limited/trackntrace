# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Billing follow-up — Finance PCB's view over Seal Journeys whose charge is
computed but not yet settled (billing_status "Pending Billing").

These are the completed-but-unbilled journeys that have left the operational
monitoring views; this surfaces them so the money is followed up. Settlement
itself is done by seal_journey.mark_journey_billed.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

BILLING_FOLLOWUP_ROLES = {"System Manager", "Finance PCB", "Management"}

_LIST_FIELDS = [
	"name", "customer", "journey_status", "vehicle_plate_number", "container_number",
	"billing_status", "billing_rule", "billing_start_date", "billing_return_date",
	"billable_days", "total_charge", "completion_date_time",
]


def _ensure_billing_access():
	if frappe.session.user == "Administrator":
		return
	if set(frappe.get_roles()) & BILLING_FOLLOWUP_ROLES:
		return
	frappe.throw(
		_("You are not permitted to view billing follow-up."),
		frappe.PermissionError,
	)


# Billing statuses the follow-up list can be filtered by (plus the "All" pseudo
# option the front-end adds). Pending Billing is the default — the unsettled queue.
BILLING_STATUSES = ("Pending Billing", "Billed", "Not Billed", "Cancelled")


@frappe.whitelist()
def get_billing_followup_list(search=None, status="Pending Billing", page=1, page_length=30):
	"""Paginated list of seal journeys by billing status (default: the unsettled
	"Pending Billing" queue), with a headline summary (the outstanding queue
	count + total) and per-status counts for the filter dropdown."""
	_ensure_billing_access()

	page = max(1, cint(page) or 1)
	page_length = max(1, min(cint(page_length) or 30, 100))

	filters = []
	if status and status != "All":
		filters.append(["billing_status", "=", status])
	or_filters = []
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			["name", "like", like],
			["customer", "like", like],
			["vehicle_plate_number", "like", like],
			["container_number", "like", like],
		]

	journeys = frappe.get_all(
		"Seal Journey",
		filters=filters,
		or_filters=or_filters or None,
		fields=_LIST_FIELDS,
		order_by="completion_date_time asc, modified asc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	# Total respecting the active search + status (or_filters aren't honoured by db.count).
	total = len(
		frappe.get_all(
			"Seal Journey",
			filters=filters,
			or_filters=or_filters or None,
			fields=["name"],
			limit_page_length=0,
		)
	)

	# Headline figures are the unsettled queue, independent of the active filter.
	pending_filter = {"billing_status": "Pending Billing"}
	queue_count = frappe.db.count("Seal Journey", filters=pending_filter)
	outstanding = sum(
		flt(row.total_charge)
		for row in frappe.get_all(
			"Seal Journey", filters=pending_filter, fields=["total_charge"], limit_page_length=0
		)
	)

	by_status = {"All": frappe.db.count("Seal Journey")}
	for billing_status in BILLING_STATUSES:
		by_status[billing_status] = frappe.db.count(
			"Seal Journey", filters={"billing_status": billing_status}
		)

	return {
		"journeys": journeys,
		"total": total,
		"page": page,
		"page_length": page_length,
		"status": status,
		"summary": {"count": queue_count, "outstanding": outstanding, "by_status": by_status},
	}


@frappe.whitelist()
def get_billing_detail(name):
	"""Full billing detail for a single Seal Journey, for the per-journey finance
	management page."""
	_ensure_billing_access()

	fields = _LIST_FIELDS + [
		"origin", "destination", "assigned_seal", "assigned_technician",
		"journey_start_date_time", "arrival_date_time",
		"first_period_days", "first_period_amount",
		"extra_days", "extra_day_rate", "extra_day_amount",
		"invoice_reference", "billed_by", "billed_date_time",
	]
	doc = frappe.db.get_value("Seal Journey", name, fields, as_dict=True)
	if not doc:
		frappe.throw(_("Seal Journey {0} not found.").format(name))
	return doc
