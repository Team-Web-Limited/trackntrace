# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""Billing resolution + calculation service for TNT Seal Management.

A single normalized formula drives every billing scenario — default or special,
fixed-day or weekly/monthly/quarterly/etc. The only thing that varies per
customer is *which* Seal Billing Rate gets resolved, never the math:

    first <= first_period_days        -> first_period_amount
    beyond first_period_days          -> first_period_amount + extra_days * extra_day_rate

Rules are resolved through a hierarchy: a customer-specific assignment overrides
a customer-group assignment, which overrides the system-wide default rule.
"""

import frappe
from frappe import _
from frappe.utils import cint, date_diff, flt, getdate, nowdate


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def get_applicable_billing_rule(customer, on_date=None):
	"""Return the name of the Seal Billing Rate that applies to ``customer`` on
	``on_date`` (defaults to today), resolved in priority order:

	1. An active, date-valid customer-specific Customer Billing Assignment.
	2. An active, date-valid assignment on the customer's direct customer group.
	3. The system-wide default Seal Billing Rate (``is_global_default``).

	Returns ``None`` when nothing resolves.
	"""
	if not customer:
		return _global_default_rule()

	on_date = getdate(on_date) if on_date else getdate(nowdate())

	rule = _resolve_assignment("Customer", "customer", customer, on_date)
	if rule:
		return rule

	group = frappe.db.get_value("Customer", customer, "customer_group")
	if group:
		rule = _resolve_assignment("Customer Group", "customer_group", group, on_date)
		if rule:
			return rule

	return _global_default_rule()


def _resolve_assignment(assignment_type, field, value, on_date):
	rows = frappe.get_all(
		"Customer Billing Assignment",
		filters={"assignment_type": assignment_type, field: value, "active": 1},
		fields=["billing_rule", "priority", "effective_from", "effective_to"],
		order_by="priority desc, modified desc",
	)
	for row in rows:
		if not row.billing_rule:
			continue
		if not _date_valid(row.effective_from, row.effective_to, on_date):
			continue
		if not _rule_is_usable(row.billing_rule, on_date):
			continue
		return row.billing_rule
	return None


def _global_default_rule():
	return frappe.db.get_value(
		"Seal Billing Rate",
		{"is_global_default": 1, "active": 1, "approval_status": "Approved"},
		"name",
	)


def _rule_is_usable(rule_name, on_date):
	rule = frappe.db.get_value(
		"Seal Billing Rate",
		rule_name,
		["active", "approval_status", "effective_from", "effective_to"],
		as_dict=True,
	)
	if not rule or not rule.active:
		return False
	# A rule pending (re-)approval by the Managing Director cannot be used for
	# billing, even if a customer already has an active assignment pointing to
	# it — e.g. its terms were edited after approval and reset to Pending.
	if rule.approval_status != "Approved":
		return False
	return _date_valid(rule.effective_from, rule.effective_to, on_date)


def _date_valid(effective_from, effective_to, on_date):
	on_date = getdate(on_date)
	if effective_from and getdate(effective_from) > on_date:
		return False
	if effective_to and getdate(effective_to) < on_date:
		return False
	return True


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------

def compute_billing_amount(rule, total_days, seal_count=1):
	"""Apply the single normalized billing formula. ``rule`` is a dict/doc with
	first_period_days/first_period_amount/extra_day_rate (+ name/billing_period_type/
	currency). ``total_days`` is the inclusive billable day count.

	Billing is per seal: the formula yields the charge for a single seal
	(``per_seal_amount``), and ``total_amount`` multiplies that by ``seal_count``
	— a journey can carry several seals and each is billed. The breakdown fields
	(first_period_amount, extra_day_rate, extra_day_amount) stay per-seal."""
	first_period_days = cint(rule.get("first_period_days"))
	first_period_amount = flt(rule.get("first_period_amount"))
	extra_day_rate = flt(rule.get("extra_day_rate"))
	total_days = cint(total_days)
	seal_count = max(cint(seal_count), 1)

	if total_days <= first_period_days:
		extra_days = 0
		extra_day_amount = 0.0
		per_seal_amount = first_period_amount
	else:
		extra_days = total_days - first_period_days
		extra_day_amount = extra_days * extra_day_rate
		per_seal_amount = first_period_amount + extra_day_amount

	total_amount = per_seal_amount * seal_count

	return {
		"billing_rule": rule.get("name"),
		"billing_period_type": rule.get("billing_period_type"),
		"currency": rule.get("currency"),
		"billable_days": total_days,
		"first_period_days": first_period_days,
		"first_period_amount": first_period_amount,
		"extra_days": extra_days,
		"extra_day_rate": extra_day_rate,
		"extra_day_amount": extra_day_amount,
		"seal_count": seal_count,
		"per_seal_amount": per_seal_amount,
		"total_amount": total_amount,
	}


def get_billable_days(start_date, return_date):
	"""Inclusive whole-day count between two dates: Jun 1 -> Jun 10 = 10 days."""
	if getdate(return_date) < getdate(start_date):
		frappe.throw(_("Return Date cannot be before Start Date."))
	return date_diff(return_date, start_date) + 1


@frappe.whitelist()
def calculate_billing(customer, start_date, return_date=None, on_date=None, seal_count=1):
	"""Resolve the applicable rule for ``customer`` and compute the charge over
	``start_date`` -> ``return_date`` (inclusive). When ``return_date`` is not yet
	known the result is left ``pending`` (no amount). ``on_date`` controls which
	rule version applies and defaults to ``start_date``. ``seal_count`` bills each
	seal on the journey (per-seal charging)."""
	if not start_date:
		frappe.throw(_("Start Date is required to calculate billing."))

	rule_name = get_applicable_billing_rule(customer, on_date or start_date)
	if not rule_name:
		return {"billing_rule": None, "status": "no_rule", "total_amount": 0}

	rule = frappe.db.get_value(
		"Seal Billing Rate",
		rule_name,
		[
			"name",
			"billing_period_type",
			"currency",
			"first_period_days",
			"first_period_amount",
			"extra_day_rate",
		],
		as_dict=True,
	)

	if not return_date:
		# Final billing needs a return date; surface the rule but keep it pending.
		result = compute_billing_amount(rule, 0, seal_count)
		result.update({"status": "pending", "billable_days": None, "total_amount": None})
		return result

	billable_days = get_billable_days(start_date, return_date)
	result = compute_billing_amount(rule, billable_days, seal_count)
	result["status"] = "final"
	return result
