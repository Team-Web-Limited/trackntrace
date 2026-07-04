# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Completed Journeys — per-customer consolidated billing view.

Replaces the old "Completed Journeys Report" script report with a single
whitelisted method that returns journeys already grouped by customer, each
group carrying its own Normal/Extra/VAT/Total Payable billing summary
(first_period_amount / extra_day_amount / total_charge are already computed
per journey by Seal Journey's billing logic — see billing.py).
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

from tnt_seal_management.tnt_seal_management.api.seal_lease_billing import (
	LEASE_ITEM,
	OWNERSHIP_ITEM,
	INTERVAL_REVERSE,
)

VAT_RATE = 0.16

# Human labels for the recurring subscription line items (Scenarios 4-6).
_RECURRING_ITEM_LABELS = {
	LEASE_ITEM: _("Recurring Lease Fee (leased seals)"),
	OWNERSHIP_ITEM: _("Ownership Service Fee (owned seals)"),
}

_ALLOWED_ROLES = frozenset({
	"System Manager", "Finance PCB", "Accounts Manager", "Accounts User",
})

_FIELDS = [
	"name", "customer", "container_number", "vehicle_plate_number",
	"origin", "destination", "tagging_date_time", "arrival_date_time",
	"untagging_completed_date_time", "completion_date_time",
	"assigned_seal", "file_number", "days_taken", "days_taken_display",
	"contact_person_name", "departure_card_number", "retrieval_card_number",
	"total_charge", "first_period_amount", "extra_day_amount", "seal_count",
]


@frappe.whitelist()
def get_completed_journeys(from_date=None, to_date=None, customer=None):
	"""Return Completed journeys grouped by customer, each with a billing
	summary. Shape: {"customers": [...], "grand_total": {...} | None}."""
	_require_billing_permission()

	journeys = _fetch_journeys(from_date, to_date, customer)
	return _build_customer_groups(journeys, customer)


def _require_billing_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _ALLOWED_ROLES:
		frappe.throw(_("Not permitted to view completed journey billing data."), frappe.PermissionError)


def _fetch_journeys(from_date, to_date, customer):
	conditions = {"journey_status": "Completed"}
	if customer:
		conditions["customer"] = customer

	to_datetime = f"{to_date} 23:59:59" if to_date else None
	if from_date and to_datetime:
		conditions["completion_date_time"] = ["between", [from_date, to_datetime]]
	elif from_date:
		conditions["completion_date_time"] = [">=", from_date]
	elif to_datetime:
		conditions["completion_date_time"] = ["<=", to_datetime]

	journeys = frappe.get_all(
		"Seal Journey",
		filters=conditions,
		fields=_FIELDS,
		order_by="customer asc, completion_date_time asc",
	)
	if not journeys:
		return []

	seals_by_journey = _get_seals_by_journey([j["name"] for j in journeys])
	for j in journeys:
		# Container falls back to the vehicle plate when no container is recorded.
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		# Prefer the concatenated list of journey seals; fall back to the primary seal.
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	return journeys


def _get_seals_by_journey(journey_names):
	"""Return {seal_journey_name: 'SEAL1, SEAL2'} from the journey_seals child table."""
	if not journey_names:
		return {}

	rows = frappe.get_all(
		"Journey Request Seal",
		filters={
			"parenttype": "Seal Journey",
			"parentfield": "journey_seals",
			"parent": ["in", journey_names],
		},
		fields=["parent", "seal_number"],
		order_by="idx asc",
	)

	seals_by_journey = {}
	for row in rows:
		if not row.get("seal_number"):
			continue
		seals_by_journey.setdefault(row["parent"], []).append(row["seal_number"])

	return {parent: ", ".join(seals) for parent, seals in seals_by_journey.items()}


def _build_customer_groups(journeys, customer_filter=None):
	groups = {}
	order = []
	for j in journeys:
		c = j["customer"]
		if c not in groups:
			groups[c] = []
			order.append(c)
		groups[c].append(j)

	# Recurring subscription fees (Scenarios 4-6) — billed independently of
	# journeys, but merged into each customer's summary so the per-customer
	# view reads as one consolidated invoice (the PDF's Scenario 6 requirement).
	recurring_by_customer = _get_recurring_fees_by_customer(customer_filter)

	# Surface customers who carry a recurring subscription but had no completed
	# journeys in the period — they still owe the recurring fee.
	for cust in recurring_by_customer:
		if cust not in groups:
			groups[cust] = []
			order.append(cust)

	customers = []
	all_recurring = []
	for c in order:
		group = groups[c]
		recurring = recurring_by_customer.get(c, [])
		all_recurring.extend(recurring)
		customers.append({
			"customer": c,
			"journeys": group,
			"journey_count": len(group),
			"total_days_taken": sum(flt(j.get("days_taken")) for j in group),
			"recurring_fees": recurring,
			"summary": _billing_summary(group, recurring),
		})

	grand_total = None
	if len(customers) > 1:
		grand_total = _billing_summary(journeys, all_recurring)
		grand_total["journey_count"] = len(journeys)

	return {"customers": customers, "grand_total": grand_total}


def _get_recurring_fees_by_customer(customer_filter=None):
	"""Return {customer: [fee, ...]} of active recurring subscription line items
	(Seal Lease Fee / Seal Ownership Service Fee) for the given customer, or all
	customers when unfiltered. Each fee is one Subscription Plan row expanded to
	its per-cycle amount (seal_count * rate)."""
	sub_filters = {"party_type": "Customer", "status": ["!=", "Cancelled"]}
	if customer_filter:
		sub_filters["party"] = customer_filter

	subs = frappe.get_all("Subscription", filters=sub_filters, fields=["name", "party"])
	if not subs:
		return {}

	party_by_sub = {s.name: s.party for s in subs}
	rows = frappe.get_all(
		"Subscription Plan Detail",
		filters={"parent": ["in", list(party_by_sub)]},
		fields=["parent", "plan", "qty"],
	)
	if not rows:
		return {}

	plan_names = list({r.plan for r in rows})
	plans = {
		p.name: p
		for p in frappe.get_all(
			"Subscription Plan",
			filters={"name": ["in", plan_names]},
			fields=["name", "item", "cost", "currency", "billing_interval", "billing_interval_count"],
		)
	}

	fees_by_customer = {}
	for row in rows:
		plan = plans.get(row.plan)
		if not plan or plan.item not in _RECURRING_ITEM_LABELS:
			continue
		seal_count = cint(row.qty)
		rate = flt(plan.cost)
		interval_label = INTERVAL_REVERSE.get(
			(plan.billing_interval, cint(plan.billing_interval_count)), plan.billing_interval
		)
		fees_by_customer.setdefault(party_by_sub[row.parent], []).append({
			"item": plan.item,
			"label": _RECURRING_ITEM_LABELS[plan.item],
			"seal_count": seal_count,
			"rate": rate,
			"amount": seal_count * rate,
			"currency": plan.currency,
			"billing_interval": interval_label,
		})

	return fees_by_customer


def _billing_summary(group, recurring=None):
	"""Normal Charges / Extra Charges / Recurring Fees / Total Cost / VAT / Total
	Payable for a set of journeys plus any recurring subscription fees.
	first_period_amount and extra_day_amount are stored per-seal on Seal Journey,
	so scale each by the journey's seal_count before summing (mirrors how
	total_charge itself is computed)."""
	recurring = recurring or []

	def scaled(fieldname, j):
		return flt(j.get(fieldname)) * max(cint(j.get("seal_count")), 1)

	normal_charges = sum(scaled("first_period_amount", j) for j in group)
	extra_charges = sum(scaled("extra_day_amount", j) for j in group)
	journey_total = sum(flt(j.get("total_charge")) for j in group)
	recurring_total = sum(flt(f["amount"]) for f in recurring)
	total_cost = journey_total + recurring_total
	vat = total_cost * VAT_RATE
	total_payable = total_cost + vat

	return {
		"normal_charges": normal_charges,
		"extra_charges": extra_charges,
		"journey_total": journey_total,
		"recurring_total": recurring_total,
		"total_cost": total_cost,
		"vat_rate": VAT_RATE,
		"vat": vat,
		"total_payable": total_payable,
	}
