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

	Returns ``None`` when nothing resolves. Thin wrapper over
	``resolve_customer_billing`` for callers that only need the rule name, not
	any per-customer rate override.
	"""
	return resolve_customer_billing(customer, on_date)["billing_rule"]


_NO_OVERRIDE = {"override_first_period_amount": None, "override_currency": None}


def resolve_customer_billing(customer, on_date=None):
	"""Like ``get_applicable_billing_rule``, but also returns any per-customer
	Rate/Currency override captured on the winning Customer Billing Assignment
	(see the Set Billing modal's Rate Terms section — Subscription only,
	Leasing already has its own fully private rate). Returns a dict:
	``{"billing_rule": name or None, "override_first_period_amount": value or
	None, "override_currency": value or None}``. The global-default fallback
	never carries an override (there's no assignment row to carry it on).
	"""
	if not customer:
		return {"billing_rule": _global_default_rule(), **_NO_OVERRIDE}

	on_date = getdate(on_date) if on_date else getdate(nowdate())

	resolved = _resolve_assignment("Customer", "customer", customer, on_date)
	if resolved:
		return resolved

	group = frappe.db.get_value("Customer", customer, "customer_group")
	if group:
		resolved = _resolve_assignment("Customer Group", "customer_group", group, on_date)
		if resolved:
			return resolved

	return {"billing_rule": _global_default_rule(), **_NO_OVERRIDE}


def _resolve_assignment(assignment_type, field, value, on_date):
	rows = frappe.get_all(
		"Customer Billing Assignment",
		# is_extra_billing rows are additional Scenario 6 leasing agreements that
		# coexist with the primary assignment — never the customer's primary
		# journey rule, so they're excluded here (see resolve_customer_extra_billing).
		filters={"assignment_type": assignment_type, field: value, "active": 1, "is_extra_billing": 0},
		fields=[
			"billing_rule", "priority", "effective_from", "effective_to",
			"override_first_period_amount", "override_currency",
		],
		order_by="priority desc, modified desc",
	)
	for row in rows:
		if not row.billing_rule:
			continue
		if not _date_valid(row.effective_from, row.effective_to, on_date):
			continue
		if not _rule_is_usable(row.billing_rule):
			continue
		return {
			"billing_rule": row.billing_rule,
			"override_first_period_amount": row.override_first_period_amount,
			"override_currency": row.override_currency,
		}
	return None


# Journey statuses where seals are physically tagged and out in the field —
# used to count a customer's currently-leased seals for Extra Billing (Scenario
# 6). Draft/pre-tagging and Completed/Cancelled journeys are excluded: leased
# seals are those actively deployed beyond the customer's owned pool. This is
# a *sibling* filter only — see Seal Journey._leased_seal_count, which uses it
# to find which of a customer's OTHER journeys are concurrently occupying
# seals right now. It must never gate whether *this* journey's own charge is
# computed — see BILLABLE_JOURNEY_STATUSES below for that.
ACTIVE_JOURNEY_STATUSES = (
	"Tagged",
	"Post-Tagging",
	"Ready for Journey",
	"In Transit",
	"Arrived",
	"Untagging In Progress",
)

# Statuses in which a journey's OWN Extra Billing charge (Scenario 6) is
# computed and, crucially, kept once set — see Seal Journey.set_extra_billing.
# Untagging finishes with a real doc.save() (complete_untagging), and
# Completed is reached afterwards via a raw db.set_value (no recompute), so
# both must be included here or the charge is wiped to zero during the
# journey's own routine completion, before it's ever billed — even though the
# seal genuinely was leased beyond the customer's base while the journey was
# active. ACTIVE_JOURNEY_STATUSES intentionally excludes these two because a
# journey that has already returned its seal shouldn't count against a LATER
# journey's cumulative base usage — that's a different question from whether
# THIS journey's own already-earned charge should survive.
BILLABLE_JOURNEY_STATUSES = ACTIVE_JOURNEY_STATUSES + ("Untagged", "Completed")


def resolve_customer_extra_billing(customer, on_date=None):
	"""Return the customer's active, date-valid Extra Billing (Scenario 6)
	leasing agreement, or None. Scenario 6 layers an *additional*, per-journey,
	day-based leasing rate on top of a customer's committed base seat count —
	this is the separate ``is_extra_billing=1`` Customer Billing Assignment
	(see current_customers.set_customer_extra_billing). ``base_seal_count`` is
	that committed base: ``owned_seal_count`` for an outright-purchase customer
	(Scenario 5), or their current Scenario 4 lease subscription's seat count
	otherwise — only seals beyond that base are billed on the extra rule.
	Returns ``{"billing_rule": name, "base_seal_count": int}`` or None."""
	if not customer:
		return None

	on_date = getdate(on_date) if on_date else getdate(nowdate())

	rows = frappe.get_all(
		"Customer Billing Assignment",
		filters={
			"assignment_type": "Customer",
			"customer": customer,
			"active": 1,
			"is_extra_billing": 1,
		},
		fields=["billing_rule", "effective_from", "effective_to"],
		order_by="modified desc",
	)
	for row in rows:
		if not row.billing_rule:
			continue
		if not _date_valid(row.effective_from, row.effective_to, on_date):
			continue
		if not _rule_is_usable(row.billing_rule):
			continue

		primary = frappe.db.get_value(
			"Customer Billing Assignment",
			{"assignment_type": "Customer", "customer": customer, "active": 1, "is_extra_billing": 0},
			["outright_purchase", "owned_seal_count"],
			order_by="priority desc, modified desc",
			as_dict=True,
		)
		if primary and cint(primary.outright_purchase):
			base_seal_count = cint(primary.owned_seal_count)
		else:
			# Not outright — the committed base is whatever they're already
			# leasing under Scenario 4 (lazy import: seal_lease_billing
			# imports current_customers, which would cycle back here if this
			# were a module-level import).
			from tnt_seal_management.tnt_seal_management.api.seal_lease_billing import (
				LEASE_ITEM,
				_get_subscription_line_info,
			)

			base_seal_count = cint(_get_subscription_line_info(customer, LEASE_ITEM)["seal_count"])

		return {"billing_rule": row.billing_rule, "base_seal_count": base_seal_count}
	return None


def apply_billing_overrides(rule, resolved):
	"""Merge a per-customer Rate/Currency override onto ``rule`` (a dict/doc
	with Seal Billing Rate fields) in place. Only Rate (first_period_amount)
	and Currency are overridable — Subscription's flat recurring rate model
	doesn't expose First Period Days/Extra Day Rate for per-customer editing
	(see the Set Billing modal). Scoped to Subscription rules only: Leasing
	already bills off the customer's own fully private rate, so an override
	left over from a prior Subscription assignment must never silently apply
	to it.

	override_first_period_amount is a Currency field — Frappe hard-codes every
	Currency/Float/Percent column as NOT NULL DEFAULT 0, so it can never
	actually be empty once an assignment row exists; nearly every assignment
	sits at its untouched default of 0.0. Checking "not in (None, '')" was
	therefore always true and silently zeroed first_period_amount for almost
	every Subscription customer. A positive value is the only override we can
	reliably tell apart from "unset" — matching the field's own description
	("leave blank to bill at the shared rule's own Rate")."""
	if rule.get("billing_type") == "Leasing":
		return
	if flt(resolved.get("override_first_period_amount")) > 0:
		rule["first_period_amount"] = resolved["override_first_period_amount"]
	if resolved.get("override_currency"):
		rule["currency"] = resolved["override_currency"]


def _global_default_rule():
	return frappe.db.get_value(
		"Seal Billing Rate",
		{"is_global_default": 1, "active": 1, "approval_status": "Approved"},
		"name",
	)


def _rule_is_usable(rule_name):
	rule = frappe.db.get_value(
		"Seal Billing Rate",
		rule_name,
		["active", "approval_status"],
		as_dict=True,
	)
	if not rule or not rule.active:
		return False
	# A rule pending (re-)approval by the Managing Director cannot be used for
	# billing, even if a customer already has an active assignment pointing to
	# it — e.g. its terms were edited after approval and reset to Pending.
	return rule.approval_status == "Approved"


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

	resolved = resolve_customer_billing(customer, on_date or start_date)
	rule_name = resolved["billing_rule"]
	if not rule_name:
		return {"billing_rule": None, "status": "no_rule", "total_amount": 0}

	rule = frappe.db.get_value(
		"Seal Billing Rate",
		rule_name,
		[
			"name",
			"billing_type",
			"billing_period_type",
			"currency",
			"first_period_days",
			"first_period_amount",
			"extra_day_rate",
		],
		as_dict=True,
	)
	apply_billing_overrides(rule, resolved)

	if not return_date:
		# Final billing needs a return date; surface the rule but keep it pending.
		result = compute_billing_amount(rule, 0, seal_count)
		result.update({"status": "pending", "billable_days": None, "total_amount": None})
		return result

	billable_days = get_billable_days(start_date, return_date)
	result = compute_billing_amount(rule, billable_days, seal_count)
	result["status"] = "final"
	return result
