# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""Recurring, seal-count-based billing (PCB Journey Billing Patterns doc,
Scenarios 4-6) — independent of journey activity, built on ERPNext's
Subscription + Subscription Plan doctypes. A daily scheduler job already ships
with ERPNext (process_subscription.create_subscription_process) and generates
a Sales Invoice per billing cycle, left as Draft (submit_invoice=0) for
Finance to review before issuing.

Two plan "kinds" share one generic upsert core (`_upsert_subscription_line`):

- Scenario 4 — "Seal Lease Fee": a fixed rate per *leased* seal, billed
  Month/Quarter/Year regardless of journey activity.
- Scenario 5 — "Seal Ownership Service Fee": a fixed rate per *owned* seal
  (the customer bought the hardware outright and only pays an ongoing
  platform/service fee), billed Month/Quarter/Semi-Annual/Year across the
  whole pool whether the seals are deployed or not.

Both plan kinds are looked up against the customer's *single* Subscription
(one Subscription per customer, `_find_customer_subscription`), so adding an
Ownership line to a customer who already has a Lease line — or vice versa —
appends a second plan row to the SAME Subscription document. ERPNext then
merges every active plan row into one Sales Invoice per cycle automatically
— that's Scenario 6, with no extra merge logic needed on our side."""

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

LEASE_ITEM = "Seal Lease Fee"
OWNERSHIP_ITEM = "Seal Ownership Service Fee"
SUBSCRIPTION_COMPANY = "Track and Trace Ltd"
SUBSCRIPTION_COST_CENTER = "PCB Business - TD"

# UI offers Month/Quarter/Semi-Annual/Year; Subscription Plan only has
# Day/Week/Month/Year, so Quarter and Semi-Annual are expressed as a Month
# interval with a multi-month count.
INTERVAL_MAP = {
	"Month": ("Month", 1),
	"Quarter": ("Month", 3),
	"Semi-Annual": ("Month", 6),
	"Year": ("Year", 1),
}
INTERVAL_REVERSE = {
	("Month", 1): "Month",
	("Month", 3): "Quarter",
	("Month", 6): "Semi-Annual",
	("Year", 1): "Year",
}

# Backwards-compatible aliases — Scenario 4 originally shipped without
# Semi-Annual (leasing contracts are Month/Quarter/Year only).
LEASE_INTERVAL_MAP = {k: v for k, v in INTERVAL_MAP.items() if k != "Semi-Annual"}
LEASE_INTERVAL_REVERSE = INTERVAL_REVERSE


# ---------------------------------------------------------------------------
# Generic core — one Subscription per customer, any number of plan rows
# ---------------------------------------------------------------------------

def _find_customer_subscription(customer):
	"""Return the customer's Subscription doc (any plan kind), or None. A
	customer has at most one Subscription across every plan kind — Lease and
	Ownership rows share it, which is what makes Scenario 6 a single merged
	invoice."""
	candidates = frappe.get_all(
		"Subscription",
		filters={"party_type": "Customer", "party": customer, "status": ["!=", "Cancelled"]},
		order_by="creation asc",
		pluck="name",
	)
	if not candidates:
		return None
	return frappe.get_doc("Subscription", candidates[0])


def _find_plan_row_for_item(sub, item_code):
	"""Return (plan_row, plan_doc) for the given item on ``sub``, or (None, None)."""
	if not sub:
		return None, None
	for row in sub.plans:
		plan_item = frappe.db.get_value("Subscription Plan", row.plan, "item")
		if plan_item == item_code:
			return row, frappe.get_doc("Subscription Plan", row.plan)
	return None, None


def _upsert_subscription_line(
	customer, item_code, plan_label, qty, rate, billing_interval, currency, start_date
):
	"""Idempotent upsert of one plan row (identified by ``item_code``) on the
	customer's single Subscription. Creates the Subscription on first use for
	either plan kind; a second plan kind added later is appended as a new row
	on the SAME Subscription rather than creating a second one."""
	interval, interval_count = INTERVAL_MAP[billing_interval]
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer

	sub = _find_customer_subscription(customer)
	row, plan = _find_plan_row_for_item(sub, item_code)

	if sub:
		# ERPNext requires every plan row on a Subscription to share one
		# billing cycle (it generates a single invoice per cycle). Surface
		# that constraint up front against any *other* plan row's cycle,
		# rather than letting the generic ERPNext ValidationError surface.
		other_rows = [r for r in sub.plans if r.plan != (plan.name if plan else None)]
		if other_rows:
			other_plan = frappe.db.get_value(
				"Subscription Plan", other_rows[0].plan, ["billing_interval", "billing_interval_count"], as_dict=True
			)
			other_cycle = (other_plan.billing_interval, cint(other_plan.billing_interval_count))
			if other_cycle != (interval, interval_count):
				other_label = INTERVAL_REVERSE.get(other_cycle, other_plan.billing_interval)
				frappe.throw(
					_(
						"{0} already has a recurring fee billed every {1}. A second recurring fee on the "
						"same customer must use the same billing cycle so they merge into one invoice."
					).format(customer_name, other_label)
				)

	if plan:
		plan.currency = currency or plan.currency or "KES"
		plan.cost = flt(rate)
		plan.billing_interval = interval
		plan.billing_interval_count = interval_count
		plan.save(ignore_permissions=True)

		row.qty = cint(qty)
		sub.save(ignore_permissions=True)
		return sub, plan

	plan = frappe.get_doc(
		{
			"doctype": "Subscription Plan",
			"plan_name": f"{customer_name} — {plan_label}",
			"item": item_code,
			"currency": currency or "KES",
			"price_determination": "Fixed Rate",
			"cost": flt(rate),
			"billing_interval": interval,
			"billing_interval_count": interval_count,
			"cost_center": SUBSCRIPTION_COST_CENTER,
		}
	)
	plan.insert(ignore_permissions=True)

	if sub:
		sub.append("plans", {"plan": plan.name, "qty": cint(qty)})
		sub.save(ignore_permissions=True)
	else:
		sub = frappe.get_doc(
			{
				"doctype": "Subscription",
				"party_type": "Customer",
				"party": customer,
				"company": SUBSCRIPTION_COMPANY,
				"cost_center": SUBSCRIPTION_COST_CENTER,
				"start_date": start_date or nowdate(),
				"submit_invoice": 0,
				"plans": [{"plan": plan.name, "qty": cint(qty)}],
			}
		)
		sub.insert(ignore_permissions=True)

	return sub, plan


def _get_subscription_line_info(customer, item_code):
	sub = _find_customer_subscription(customer)
	row, plan = _find_plan_row_for_item(sub, item_code)
	if not plan:
		return {
			"status": None,
			"seal_count": None,
			"rate_per_seal": None,
			"billing_interval": "Month",
			"currency": None,
		}
	return {
		"status": sub.status,
		"seal_count": row.qty,
		"rate_per_seal": plan.cost,
		"billing_interval": INTERVAL_REVERSE.get(
			(plan.billing_interval, cint(plan.billing_interval_count)), "Month"
		),
		"currency": plan.currency,
	}


def _current_journey_billing(customer):
	from tnt_seal_management.tnt_seal_management.api.current_customers import RULE_DISPLAY_FIELDS

	assignment = frappe.db.get_value(
		"Customer Billing Assignment",
		{"assignment_type": "Customer", "customer": customer, "active": 1},
		"billing_rule",
		order_by="priority desc, modified desc",
	)
	if not assignment:
		return None, None
	rule = frappe.db.get_value("Seal Billing Rate", assignment, RULE_DISPLAY_FIELDS, as_dict=True)
	if not rule:
		return None, None
	return rule.billing_type, (rule.billing_rule_name or rule.name)


# ---------------------------------------------------------------------------
# Scenario 4 — Seal Lease Fee (leased seals)
# ---------------------------------------------------------------------------

def _find_lease_subscription(customer):
	"""Kept for backward compatibility with any external caller expecting the
	old (sub, row, plan) shape."""
	sub = _find_customer_subscription(customer)
	row, plan = _find_plan_row_for_item(sub, LEASE_ITEM)
	return (sub, row, plan) if plan else (None, None, None)


@frappe.whitelist()
def get_customer_lease_subscription(customer):
	"""Prefill payload for the 'Recurring Lease Fee' tab."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	billing_type, billing_rule = _current_journey_billing(customer)
	info = _get_subscription_line_info(customer, LEASE_ITEM)

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
		"current_billing_type": billing_type,
		"current_billing_rule": billing_rule,
		"lease_status": info["status"],
		"seal_count": info["seal_count"],
		"rate_per_seal": info["rate_per_seal"],
		"billing_interval": info["billing_interval"],
		"currency": info["currency"],
	}


@frappe.whitelist()
def set_customer_lease_subscription(
	customer, seal_count, rate_per_seal, billing_interval, currency=None, start_date=None
):
	"""Idempotent upsert of the customer's recurring Seal Lease Fee line."""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))
	if not seal_count or cint(seal_count) <= 0:
		frappe.throw(_("Enter the Number of Seals Leased."))
	if rate_per_seal in (None, "") or flt(rate_per_seal) < 0:
		frappe.throw(_("Enter the Rate per Seal."))
	if billing_interval not in LEASE_INTERVAL_MAP:
		frappe.throw(_("Billing Interval must be one of Month, Quarter, Year."))

	sub, plan = _upsert_subscription_line(
		customer, LEASE_ITEM, "Seal Lease Fee", seal_count, rate_per_seal, billing_interval, currency, start_date
	)

	frappe.db.commit()
	return {
		"customer": customer,
		"subscription": sub.name,
		"plan": plan.name,
		"status": sub.status,
		"seal_count": cint(seal_count),
		"rate_per_seal": flt(rate_per_seal),
		"billing_interval": billing_interval,
	}


# ---------------------------------------------------------------------------
# Scenario 5 — Seal Ownership Service Fee (owned seals)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_customer_ownership_subscription(customer):
	"""Prefill payload for the 'Ownership Service Fee' tab."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	billing_type, billing_rule = _current_journey_billing(customer)
	info = _get_subscription_line_info(customer, OWNERSHIP_ITEM)

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
		"current_billing_type": billing_type,
		"current_billing_rule": billing_rule,
		"ownership_status": info["status"],
		"seal_count": info["seal_count"],
		"rate_per_seal": info["rate_per_seal"],
		"billing_interval": info["billing_interval"],
		"currency": info["currency"],
	}


@frappe.whitelist()
def set_customer_ownership_subscription(
	customer, seal_count, rate_per_seal, billing_interval, currency=None, start_date=None
):
	"""Idempotent upsert of the customer's recurring Seal Ownership Service Fee
	line — applies to the whole owned pool regardless of utilization
	(Scenario 5). Adding this to a customer who already has a Lease line
	(Scenario 4) appends to the same Subscription, merging into one invoice
	(Scenario 6)."""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))
	if not seal_count or cint(seal_count) <= 0:
		frappe.throw(_("Enter the Number of Seals Owned."))
	if rate_per_seal in (None, "") or flt(rate_per_seal) < 0:
		frappe.throw(_("Enter the Service Fee Rate."))
	if billing_interval not in INTERVAL_MAP:
		frappe.throw(_("Billing Interval must be one of Month, Quarter, Semi-Annual, Year."))

	sub, plan = _upsert_subscription_line(
		customer, OWNERSHIP_ITEM, "Seal Ownership Service Fee", seal_count, rate_per_seal,
		billing_interval, currency, start_date,
	)

	frappe.db.commit()
	return {
		"customer": customer,
		"subscription": sub.name,
		"plan": plan.name,
		"status": sub.status,
		"seal_count": cint(seal_count),
		"rate_per_seal": flt(rate_per_seal),
		"billing_interval": billing_interval,
	}
