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

import math

import frappe
from frappe import _
from frappe.utils import cint, flt

from tnt_seal_management.tnt_seal_management.api.seal_lease_billing import (
	LEASE_ITEM,
	OWNERSHIP_ITEM,
	INTERVAL_REVERSE,
)
from tnt_seal_management.tnt_seal_management.api.current_customers import (
	TAX_CATEGORY_NORMAL,
	TAX_CATEGORY_EXEMPT,
	TAX_CATEGORY_ZERO_RATED,
)
from tnt_seal_management.tnt_seal_management.billing import resolve_customer_billing

VAT_RATE = 0.16

# Sales Order's "cost_center" field is relabeled "Business Line" (Property
# Setter) and set from the customer's billing type (Set Billing modal, Set
# Billing > Billing Type): Leasing customers are New Business, Subscription
# customers are Renewal Business — both PCB-specific Cost Centers under
# Track and Trace Ltd.
BUSINESS_LINE_LEASING = "New Business - PCB - TD"
BUSINESS_LINE_SUBSCRIPTION = "Renewal Business - PCB - TD"

# Sales Order line items for a generated order likewise follow the
# customer's billing_type: Leasing customers bill on PCB-LEASING (their
# per-journey day-tiered charge) / PCB-LEASING-EXTRADAYS (the extra-day
# portion of that same charge); Subscription customers bill everything —
# normal/extra billing plus recurring fees — on PCB SUBSCRIPTIONS.
ITEM_LEASING = "PCB-LEASING"
ITEM_LEASING_EXTRA_DAYS = "PCB-LEASING-EXTRADAYS"
ITEM_SUBSCRIPTION = "PCB SUBSCRIPTIONS"


def _get_customer_billing_type(customer, journeys=None):
	"""billing_type ("Leasing"/"Subscription") the Sales Order for ``journeys``
	should be raised under — it picks the order's item codes and its Cost
	Center (see _get_business_line / generate_sales_order).

	Read from the rules the journeys were *actually* billed on
	(Seal Journey.billing_rule), not by re-resolving the customer's current
	setting — the same reasoning as the currency snapshot in
	generate_sales_order: changing a customer's billing later must not
	retroactively relabel a Sales Order for journeys already billed under the
	old terms. It matters more now that rates are split by journey type, since
	a customer's Local and Import/Export rate sets are separate rules and may
	not even share a billing_type — so this is a property of the journeys being
	billed, not of the customer alone.

	Falls back to the customer's currently resolved rule when no journey
	carries one, which is how a Sales Order covering only recurring fees (no
	journeys) still gets its items and Cost Center. Returns None when nothing
	resolves.
	"""
	rule_names = {j.get("billing_rule") for j in (journeys or []) if j.get("billing_rule")}

	if not rule_names:
		fallback = resolve_customer_billing(customer).get("billing_rule")
		if not fallback:
			return None
		rule_names = {fallback}

	billing_types = {
		bt
		for bt in frappe.get_all(
			"Seal Billing Rate",
			filters={"name": ["in", list(rule_names)]},
			pluck="billing_type",
		)
		if bt
	}

	if not billing_types:
		return None

	if len(billing_types) > 1:
		# One Sales Order carries a single Cost Center and one pair of item
		# codes (PCB-LEASING/... vs PCB SUBSCRIPTIONS), so a mix would label
		# half the lines wrongly. Refuse rather than silently pick one —
		# mirrors the mixed_currency guard in generate_sales_order.
		frappe.throw(
			_(
				"These journeys were billed under more than one billing type ({0}) — a "
				"customer's Local and Import/Export rates can differ. Bill them in "
				"separate Sales Orders per billing type instead of combining them."
			).format(", ".join(sorted(billing_types)))
		)

	return billing_types.pop()


def _get_business_line(billing_type):
	"""Cost Center ("Business Line") for a generated Sales Order, from the
	customer's billing_type. Returns None when unresolved (leaves the field
	for the user to fill in, same as Department/Project)."""
	if billing_type == "Leasing":
		return BUSINESS_LINE_LEASING
	if billing_type == "Subscription":
		return BUSINESS_LINE_SUBSCRIPTION
	return None

# Tax Exempt and Zero Rated customers both owe no VAT on their total payable —
# they differ for statutory reporting, not for this calculation.
_ZERO_VAT_CATEGORIES = frozenset({TAX_CATEGORY_EXEMPT, TAX_CATEGORY_ZERO_RATED})


def _get_customer_tax_categories(customer_names):
	"""Return {customer: tax_category}, defaulting to Normal Tax when unset."""
	if not customer_names:
		return {}
	rows = frappe.get_all(
		"Customer",
		filters={"name": ["in", list(customer_names)]},
		fields=["name", "custom_tax_category"],
	)
	return {r.name: r.custom_tax_category or TAX_CATEGORY_NORMAL for r in rows}


def _vat_rate_for_category(tax_category):
	return 0.0 if tax_category in _ZERO_VAT_CATEGORIES else VAT_RATE


def _apply_sales_order_taxes(so, tax_category):
	"""Copy the matching Sales Taxes and Charges Template's rows onto ``so``
	so the VAT already shown to Finance in the Completed Journeys review
	(_billing_summary's vat/total_payable, driven by the same tax_category)
	actually lands on the generated document instead of only being a display
	total. Picks the company's Standard (16%) or Zero Rate (0%) VAT template
	depending on whether ``tax_category`` is one of the zero-VAT categories —
	mirrors _vat_rate_for_category's own grouping."""
	name_fragment = "VAT Zero Rate" if tax_category in _ZERO_VAT_CATEGORIES else "VAT Standard"
	template_name = frappe.db.get_value(
		"Sales Taxes and Charges Template",
		{"company": so.company, "name": ["like", f"{name_fragment}%"]},
		"name",
	)
	if not template_name:
		return

	template = frappe.get_doc("Sales Taxes and Charges Template", template_name)
	so.taxes_and_charges = template_name
	for row in template.taxes:
		so.append("taxes", {
			"charge_type": row.charge_type,
			"account_head": row.account_head,
			"description": row.description,
			"rate": row.rate,
			"cost_center": row.cost_center,
			# Sales Taxes and Charges Row defaults this checkbox to checked, so
			# leaving it unset would silently flip an exclusive-tax template
			# into "rate already includes VAT" and back the tax out of the
			# item amount instead of adding it on top.
			"included_in_print_rate": row.included_in_print_rate,
		})

# Human labels for the recurring subscription line items (Scenarios 4-6).
_RECURRING_ITEM_LABELS = {
	LEASE_ITEM: _("Recurring Lease Fee (leased seals)"),
	OWNERSHIP_ITEM: _("Subscription Fee (owned seals)"),
}

_ALLOWED_ROLES = frozenset({
	"System Manager", "Finance PCB", "Accounts Manager", "Accounts User", "Account Manager",
})

_FIELDS = [
	"name", "customer", "container_number", "vehicle_plate_number",
	"origin", "destination", "tagging_date_time", "arrival_date_time",
	"untagging_completed_date_time", "completion_date_time",
	"assigned_seal", "file_number", "days_taken", "days_taken_display",
	"contact_person_name", "departure_card_number", "retrieval_card_number",
	"total_charge", "first_period_amount", "extra_day_amount", "seal_count",
	"extra_billing_amount", "extra_billing_seal_count",
	"extra_billing_first_period_amount", "extra_billing_extra_days",
	"extra_billing_extra_day_amount",
	"sales_order_reference", "billing_status", "extra_days", "currency",
	"billable_days",
	# The rule each journey was actually billed on, and which rate set it came
	# from — a customer's Local and Import/Export rates are separate rules, so
	# the Sales Order's billing type has to be read off the journeys rather
	# than off the customer (see _get_customer_billing_type).
	"billing_rule", "journey_type",
]


@frappe.whitelist()
def get_completed_journeys(from_date=None, to_date=None, customer=None):
	"""Return Completed journeys grouped by customer, each with a billing
	summary. Shape: {"customers": [...], "grand_total": {...} | None}."""
	_require_billing_permission()

	journeys = _fetch_journeys(from_date, to_date, customer)
	return _build_customer_groups(journeys, customer)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_valid_customers_for_filter(doctype, txt, searchfield, start, page_len, filters):
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")
	to_datetime = f"{to_date} 23:59:59" if to_date else None

	conditions = ["journey_status = 'Completed'"]
	values = []

	if from_date and to_datetime:
		conditions.append("completion_date_time between %s and %s")
		values.extend([from_date, to_datetime])
	elif from_date:
		conditions.append("completion_date_time >= %s")
		values.append(from_date)
	elif to_datetime:
		conditions.append("completion_date_time <= %s")
		values.append(to_datetime)

	condition_str = " and ".join(conditions) if conditions else "1=1"

	journey_customers = frappe.db.sql(f"""
		select distinct customer from `tabSeal Journey`
		where {condition_str}
	""", tuple(values), as_dict=True)

	valid_customers = {r.customer for r in journey_customers if r.customer}
	
	recurring = _get_recurring_fees_by_customer(None)
	valid_customers.update(recurring.keys())

	if not valid_customers:
		return []

	return frappe.db.sql(f"""
		select name from `tabCustomer`
		where name in %s and name like %s
		order by name asc
		limit %s, %s
	""", (tuple(valid_customers), f"%{txt}%", cint(start), cint(page_len)))


def _require_billing_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _ALLOWED_ROLES:
		frappe.throw(_("Not permitted to view completed journey billing data."), frappe.PermissionError)


@frappe.whitelist()
def is_journey_sales_order(sales_order):
	"""True if any Seal Journey was billed onto ``sales_order`` — i.e. it came
	out of generate_sales_order rather than being an unrelated ERPNext order.
	Drives whether the desk Sales Order form shows the customer-response pill
	(see public/js/sales_order.js). Kept separate from the item-code check the
	client does first, because a journey-generated order falls back to generic
	items (SJ-Subscription / Extra Days) when the customer's billing rule
	doesn't resolve — those orders are still journey orders."""
	if not sales_order:
		return False
	if not frappe.has_permission("Sales Order", "read", doc=sales_order):
		frappe.throw(_("Not permitted to read this Sales Order."), frappe.PermissionError)
	# Seal Journey read permission is intentionally not required — this leaks
	# only a boolean about an order the caller can already read.
	return bool(
		frappe.db.exists("Seal Journey", {"sales_order_reference": sales_order})
	)


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


_COMPOUND_RULE_FIELDS = ["name", "computation_method", "first_period_days", "first_period_amount"]


def _get_customer_compound_rules(customer, journeys=None):
	"""The Compound-computation rules these journeys were billed on, keyed by
	rule name — ``{}`` when none of them are Compound.

	Computation = Compound (Set Billing modal, Non-Flat Rate Subscription
	only) zeroes each journey's own charge at billing time
	(Seal Journey.set_billing); the real charge only exists in aggregate, so
	it's rebuilt here from the rules the journeys were actually billed on
	(Seal Journey.billing_rule) rather than by re-resolving the customer's
	current setting — same reasoning as _get_customer_billing_type.

	A customer's Local and Import/Export rate sets are separate rules with
	their own first_period_days/first_period_amount, so more than one can come
	back and each batches independently — see _compute_compound_charge.

	Journeys carrying no rule of their own (and the recurring-fees-only case,
	where there are no journeys at all) fall back to the customer's currently
	resolved rule, keyed under ``None`` to match how _compute_compound_charge
	buckets them.
	"""
	journeys = journeys or []
	rule_names = {j.get("billing_rule") for j in journeys if j.get("billing_rule")}

	rules = {}
	if rule_names:
		for row in frappe.get_all(
			"Seal Billing Rate",
			filters={"name": ["in", list(rule_names)], "computation_method": "Compound"},
			fields=_COMPOUND_RULE_FIELDS,
		):
			rules[row.name] = row

	if not rule_names or any(not j.get("billing_rule") for j in journeys):
		fallback_name = resolve_customer_billing(customer).get("billing_rule")
		if fallback_name:
			fallback = frappe.db.get_value(
				"Seal Billing Rate", fallback_name, _COMPOUND_RULE_FIELDS, as_dict=True
			)
			if fallback and fallback.computation_method == "Compound":
				rules[None] = fallback

	return rules


def _compute_compound_charge(compound_rules, group):
	"""Batch the journeys in ``group`` per rate set: for each Compound rule,
	sum the billable_days of the journeys billed on it, divide by that rule's
	first_period_days, round UP to a whole period (any partial period bills a
	full one — Set Billing modal's Computation = Compound spec), times its
	first_period_amount. Returns (total charge, total batched days).

	Batching is per rule rather than across the whole group because a
	customer's Local and Import/Export rate sets price differently — pooling
	their days and applying one set's numbers would misprice both. Journeys
	billed on a non-Compound rule are skipped entirely: their own charge was
	never zeroed, so it's already counted in journey_total.

	Zero when there's nothing to batch (an empty group, or a customer who only
	carries a recurring fee this period)."""
	if not compound_rules:
		return 0, 0

	days_by_rule = {}
	for j in group:
		key = j.get("billing_rule") or None
		if key not in compound_rules:
			continue
		days_by_rule[key] = days_by_rule.get(key, 0) + cint(j.get("billable_days"))

	total_charge = 0
	total_days = 0
	for key, days in days_by_rule.items():
		if not days:
			continue
		rule = compound_rules[key]
		period_days = cint(rule.first_period_days) or 1
		total_charge += math.ceil(days / period_days) * flt(rule.first_period_amount)
		total_days += days

	return total_charge, total_days


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

	tax_category_by_customer = _get_customer_tax_categories(order)

	customers = []
	for c in order:
		group = groups[c]
		recurring = recurring_by_customer.get(c, [])
		tax_category = tax_category_by_customer.get(c, TAX_CATEGORY_NORMAL)
		compound_rules = _get_customer_compound_rules(c, group)
		customers.append({
			"customer": c,
			"journeys": group,
			"journey_count": len(group),
			"total_days_taken": sum(flt(j.get("days_taken")) for j in group),
			"recurring_fees": recurring,
			"tax_category": tax_category,
			"summary": _billing_summary(group, recurring, tax_category, compound_rules),
		})

	grand_total = None
	if len(customers) > 1:
		# Customers can carry different tax categories, so the grand total is
		# summed from each customer's own already-correctly-rated summary
		# rather than recomputed with a single VAT rate.
		grand_total = _sum_summaries([c["summary"] for c in customers])
		grand_total["journey_count"] = len(journeys)

	return {"customers": customers, "grand_total": grand_total}


@frappe.whitelist()
def generate_sales_order(customer, from_date=None, to_date=None):
	"""Generate a Sales Order for a customer's unbilled completed journeys."""
	_require_billing_permission()

	if not customer:
		frappe.throw(_("Customer is required to generate a Sales Order."))

	# Filter specifically for unbilled journeys
	conditions = {
		"journey_status": "Completed",
		"customer": customer,
		"billing_status": ["in", ["Pending Billing", "No Per-Journey Charge"]],
		"sales_order_reference": ["in", ["", None]]
	}
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
		order_by="completion_date_time asc",
	)

	seals_by_journey = _get_seals_by_journey([j["name"] for j in journeys])
	for j in journeys:
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	# We reuse _build_customer_groups to calculate the total charges
	group_data = _build_customer_groups(journeys, customer)
	customer_data = group_data["customers"][0] if group_data["customers"] else None

	if not customer_data or (not journeys and not customer_data.get("recurring_fees")):
		frappe.throw(_("No unbilled completed journeys or active recurring subscription fees found for this customer in the selected period."))

	summary = customer_data["summary"]
	recurring_fees = customer_data["recurring_fees"]

	if summary.get("mixed_currency"):
		frappe.throw(
			_(
				"These journeys were billed in more than one currency (the customer's "
				"billing currency changed between them). Bill them in separate Sales "
				"Orders per currency instead of combining them."
			)
		)

	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.transaction_date = frappe.utils.today()
	if summary.get("currency"):
		# Snapshot from the journeys' own billed currency (Seal Journey.currency)
		# rather than re-resolving the customer's *current* billing currency —
		# a later change to that setting must not retroactively affect a Sales
		# Order for journeys already billed under the old currency.
		so.currency = summary["currency"]
	if summary.get("tax_category") and summary["tax_category"] != TAX_CATEGORY_NORMAL:
		so.tax_category = summary["tax_category"]

	billing_type = _get_customer_billing_type(customer, journeys)
	business_line = _get_business_line(billing_type)
	if business_line:
		so.cost_center = business_line

	so.append("custom_installation_location", {
		"contact_name": "N/A",
		"contact_mobile_no": "N/A",
		"vehicle_registration_no": "N/A",
		"vehicle_model": "N/A",
		"vehicle_make": "N/A",
		"vehicle_colour": "N/A",
		"location": "N/A"
	})

	def add_item(item_code, qty, rate, description):
		if flt(rate) > 0 or flt(qty) > 0:
			so.append("items", {
				"item_code": item_code,
				"qty": qty,
				"rate": rate,
				"price_list_rate": rate,
				"description": description,
				"delivery_date": frappe.utils.today()
			})

	if billing_type == "Leasing":
		rental_item = ITEM_LEASING
		extra_item = ITEM_LEASING_EXTRA_DAYS
	elif billing_type == "Subscription":
		rental_item = ITEM_SUBSCRIPTION
		extra_item = ITEM_SUBSCRIPTION
	else:
		# No resolved rule (shouldn't normally happen) — fall back to the
		# original generic items rather than fail Sales Order creation.
		rental_item = "SJ-Subscription"
		extra_item = "Extra Days" if frappe.db.exists("Item", "Extra Days") else "SJ-Subscription"

	if flt(summary["normal_charges"]) > 0:
		# Quantity is the total seal count across all journeys — each seal is
		# billed individually (see billing.compute_billing_amount) — and rate
		# is the per-seal baseline charge. A journey-count quantity would
		# collapse a multi-seal journey into one inflated rate instead of
		# reflecting the actual per-seal contract terms.
		seal_total = sum(max(cint(j.get("seal_count")), 1) for j in journeys) or 1
		rate = flt(summary["normal_charges"]) / seal_total
		add_item(rental_item, seal_total, rate, "Completed Journeys - Normal Charges")
	
	if flt(summary["extra_charges"]) > 0:
		# Quantity is the total extra days across all journeys, and rate is the extra day rate
		extra_days = sum(cint(j.get("extra_days")) * max(cint(j.get("seal_count")), 1) for j in journeys)
		if extra_days > 0:
			rate = flt(summary["extra_charges"]) / extra_days
			add_item(extra_item, extra_days, rate, "Completed Journeys - Extra Charges for Extra Days")
		else:
			# Fallback if extra days is 0 (should not happen if extra_charges > 0)
			add_item(extra_item, 1, summary["extra_charges"], "Completed Journeys - Extra Charges for Extra Days")

	if flt(summary["extra_billing_total"]) > 0:
		# Scenario 6's leasing component is always billed on PCB-LEASING /
		# PCB-LEASING-EXTRADAYS, distinct from the customer's own PCB
		# SUBSCRIPTIONS/PCB-LEASING lines above — even a Subscription
		# (outright-purchase) customer's overflow seals are a leasing charge,
		# not a subscription one. Split the same way Normal/Extra Charges
		# are split above: a base line (per overflow seal) and, only when
		# the overflow ran past the rule's first period, a separate
		# extra-days line — instead of one lump "Extra Billing" amount that
		# hides whether it came from the base rate or extra days.
		extra_billing_seals = sum(cint(j.get("extra_billing_seal_count")) for j in journeys)
		if extra_billing_seals > 0:
			if flt(summary["extra_billing_base"]) > 0:
				rate = flt(summary["extra_billing_base"]) / extra_billing_seals
				add_item(ITEM_LEASING, extra_billing_seals, rate, "Completed Journeys - Extra Billing (leased seals)")

			if flt(summary["extra_billing_extra_day_total"]) > 0:
				extra_billing_extra_days = sum(
					cint(j.get("extra_billing_extra_days")) * cint(j.get("extra_billing_seal_count"))
					for j in journeys
				)
				if extra_billing_extra_days > 0:
					rate = flt(summary["extra_billing_extra_day_total"]) / extra_billing_extra_days
					add_item(
						ITEM_LEASING_EXTRA_DAYS, extra_billing_extra_days, rate,
						"Completed Journeys - Extra Billing - Extra Days",
					)
		else:
			# Fallback if seal count is 0 (should not happen if extra_billing_total > 0)
			add_item(ITEM_LEASING, 1, summary["extra_billing_total"], "Completed Journeys - Extra Billing (leased seals)")

	if flt(summary.get("compound_charges")) > 0:
		# Computation = Compound (Set Billing modal, Non-Flat Rate Subscription):
		# each journey's own charge was already zeroed at billing time — this is
		# the one batched line for the whole period (see _compute_compound_charge),
		# a single quantity-1 line rather than per-journey/per-seal, since the
		# amount only exists in aggregate.
		add_item(
			rental_item, 1, summary["compound_charges"],
			_("Completed Journeys - Compound Billing ({0} days)").format(cint(summary.get("compound_days"))),
		)

	for r in recurring_fees:
		if flt(r["amount"]) > 0:
			# The recurring items might be set up in ERPNext, but we fallback to rental_item if needed.
			# Using rental_item to avoid Missing Item errors.
			add_item(rental_item, r["seal_count"], r["rate"], f"{r['label']} - {r['billing_interval']}")

	if not so.items:
		frappe.throw(_("Total billable amount is zero. No Sales Order created."))

	_apply_sales_order_taxes(so, summary["tax_category"])

	so.insert(ignore_permissions=True, ignore_mandatory=True)

	for j in journeys:
		frappe.db.set_value("Seal Journey", j["name"], {
			"sales_order_reference": so.name,
			"billing_status": "Processing Payment"
		})

	frappe.db.commit()

	return so.name


def _sum_summaries(summaries):
	total_cost = sum(s["total_cost"] for s in summaries)
	vat = sum(s["vat"] for s in summaries)

	# Customers can carry different tax categories, so there is no single VAT
	# rate to report once mixed — a blended average (e.g. "VAT @11%") reads as
	# a real rate and confuses. When every customer shares the same rate we
	# still show it; otherwise the client just labels the line "VAT".
	distinct_rates = {s["vat_rate"] for s in summaries}
	mixed_vat_rates = len(distinct_rates) > 1

	# Same reasoning as _billing_summary's own mixed_currency: once any
	# customer in the grand total carries mixed_currency, or two customers
	# were billed in different currencies, there's no single currency to sum
	# into — the grand total figure is still shown (as raw numbers) but the
	# client must not label it with one currency symbol.
	distinct_currencies = {s["currency"] for s in summaries if s["currency"]}
	mixed_currency = any(s.get("mixed_currency") for s in summaries) or len(distinct_currencies) > 1

	return {
		"normal_charges": sum(s["normal_charges"] for s in summaries),
		"extra_charges": sum(s["extra_charges"] for s in summaries),
		"journey_total": sum(s["journey_total"] for s in summaries),
		"extra_billing_total": sum(s["extra_billing_total"] for s in summaries),
		"extra_billing_base": sum(s["extra_billing_base"] for s in summaries),
		"extra_billing_extra_day_total": sum(s["extra_billing_extra_day_total"] for s in summaries),
		"recurring_total": sum(s["recurring_total"] for s in summaries),
		"compound_charges": sum(s.get("compound_charges") or 0 for s in summaries),
		"total_cost": total_cost,
		"vat_rate": None if mixed_vat_rates else next(iter(distinct_rates), 0.0),
		"mixed_vat_rates": mixed_vat_rates,
		"vat": vat,
		"total_payable": total_cost + vat,
		"currency": None if mixed_currency else next(iter(distinct_currencies), None),
		"mixed_currency": mixed_currency,
	}


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


def _billing_summary(group, recurring=None, tax_category=None, compound_rules=None):
	"""Normal Charges / Extra Charges / Extra Billing / Recurring Fees / Total
	Cost / VAT / Total Payable for a set of journeys plus any recurring
	subscription fees. first_period_amount and extra_day_amount are stored
	per-seal on Seal Journey, so scale each by the journey's seal_count before
	summing (mirrors how total_charge itself is computed). extra_billing_amount
	(Scenario 6 — leased seals beyond an outright-purchase customer's owned
	pool, see billing.resolve_customer_extra_billing) is already a per-journey
	total, not per-seal, so it's summed as-is. Tax Exempt / Zero Rated
	customers owe no VAT — see ``_vat_rate_for_category``.

	``compound_rules`` (Set Billing modal's Computation = Compound, Non-Flat
	Rate Subscription only — see _get_customer_compound_rules) means
	normal_charges/journey_total are already zero for the journeys billed on
	those rules (each such journey's own charge was zeroed at billing time);
	the real charge is compound_charges, batched per rate set across the
	journeys in ``group`` — see _compute_compound_charge."""
	recurring = recurring or []
	tax_category = tax_category or TAX_CATEGORY_NORMAL
	vat_rate = _vat_rate_for_category(tax_category)

	def scaled(fieldname, j):
		return flt(j.get(fieldname)) * max(cint(j.get("seal_count")), 1)

	# extra_billing_first_period_amount/extra_billing_extra_day_amount are also
	# per-seal (see billing.compute_billing_amount), scaled by the OVERFLOW
	# seal count (extra_billing_seal_count), not the journey's own seal_count —
	# together they split extra_billing_total into its base vs extra-day
	# portions, the same distinction Normal/Extra Charges already make.
	def scaled_extra_billing(fieldname, j):
		return flt(j.get(fieldname)) * cint(j.get("extra_billing_seal_count"))

	normal_charges = sum(scaled("first_period_amount", j) for j in group)
	extra_charges = sum(scaled("extra_day_amount", j) for j in group)
	journey_total = sum(flt(j.get("total_charge")) for j in group)
	extra_billing_total = sum(flt(j.get("extra_billing_amount")) for j in group)
	extra_billing_base = sum(scaled_extra_billing("extra_billing_first_period_amount", j) for j in group)
	extra_billing_extra_day_total = sum(scaled_extra_billing("extra_billing_extra_day_amount", j) for j in group)
	recurring_total = sum(flt(f["amount"]) for f in recurring)
	compound_charges, compound_days = _compute_compound_charge(compound_rules, group)
	total_cost = journey_total + extra_billing_total + recurring_total + compound_charges
	vat = total_cost * vat_rate
	total_payable = total_cost + vat

	# Each journey's currency was snapshotted at the time it was billed (see
	# Seal Journey.set_billing) — a customer whose billing currency changed
	# between journeys can carry more than one here. When they all agree we
	# report the single currency; otherwise there's no one right answer to
	# display/bill in, so callers must handle mixed_currency explicitly
	# (Sales Order generation refuses to combine currencies into one order).
	currencies = {j.get("currency") for j in group if j.get("currency")}
	currencies.update(f.get("currency") for f in recurring if f.get("currency"))
	mixed_currency = len(currencies) > 1

	return {
		"normal_charges": normal_charges,
		"extra_charges": extra_charges,
		"journey_total": journey_total,
		"extra_billing_total": extra_billing_total,
		"extra_billing_base": extra_billing_base,
		"extra_billing_extra_day_total": extra_billing_extra_day_total,
		"recurring_total": recurring_total,
		"compound_charges": compound_charges,
		"compound_days": compound_days,
		"total_cost": total_cost,
		"tax_category": tax_category,
		"vat_rate": vat_rate,
		"vat": vat,
		"total_payable": total_payable,
		"currency": None if mixed_currency else next(iter(currencies), None),
		"mixed_currency": mixed_currency,
	}

@frappe.whitelist()
def export_pdf(html, filename):
	from frappe.utils.pdf import get_pdf

	# Strip columns that should not appear on the exported statement.
	html = _strip_pdf_columns(html, {"Seal Number", "Departure Card #", "Retrieval Card #"})

	options = {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "15mm",
		"margin-right": "15mm",
		"margin-bottom": "15mm",
		"margin-left": "15mm"
	}

	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = get_pdf(html, options=options)
	frappe.local.response.type = "pdf"


def _strip_pdf_columns(html, drop_labels):
	"""Remove table columns whose header text is in ``drop_labels``.

	Runs server-side so the export is unaffected by any stale client asset.
	"""
	from bs4 import BeautifulSoup

	soup = BeautifulSoup(html, "html.parser")

	for table in soup.find_all("table"):
		header_row = table.find("tr")
		if not header_row:
			continue

		headers = header_row.find_all(["th", "td"])
		drop_idx = [
			i for i, cell in enumerate(headers)
			if cell.get_text(strip=True) in drop_labels
		]
		if not drop_idx:
			continue

		for row in table.find_all("tr"):
			cells = row.find_all(["th", "td"])
			for i in drop_idx:
				if i < len(cells):
					cells[i].decompose()

	return str(soup)

@frappe.whitelist()
def export_xlsx(data, filename):
	import json
	from io import BytesIO

	import openpyxl
	from openpyxl.styles import Font

	from frappe.desk.utils import provide_binary_file

	data_list = json.loads(data)

	# Labels whose rows should be bolded
	bold_labels = {
		"Customer", "Total Journeys", "Total Days Taken",
		"Journey",  # column header row
		"Summary", "Recurring Subscription Fees",
		"Normal Charges", "Extra Charges for Extra Days",
		"Extra Billing (leased seals)",
		"Total Cost", "Total Payable",
	}
	# Also bold any row whose first cell starts with "VAT"
	bold_font = Font(name="Calibri", bold=True)

	wb = openpyxl.Workbook()
	ws = wb.active
	ws.title = filename[:31] if filename else "Sheet1"

	for row_data in data_list:
		ws.append(row_data if row_data else [])

	# Apply bold formatting
	for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
		first_val = row[0].value
		if first_val and (
			str(first_val) in bold_labels
			or str(first_val).startswith("VAT")
		):
			for cell in row:
				cell.font = bold_font

	# Auto-fit column widths (approximate)
	for col in ws.columns:
		max_len = 0
		col_letter = col[0].column_letter
		for cell in col:
			if cell.value:
				max_len = max(max_len, len(str(cell.value)))
		ws.column_dimensions[col_letter].width = min(max_len + 3, 40)

	xlsx_file = BytesIO()
	wb.save(xlsx_file)
	provide_binary_file(filename, "xlsx", xlsx_file.getvalue())
