# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""RECTs billing is paid upfront, so a Sales Order is raised when the billing is
saved (for the first period) and again at the start of every later period by a
daily job, instead of waiting for journeys to complete. Seals sold from the
warehouse raise their own Sales Order when the Material Transfer is approved.

ERPNext's own Subscription only generates Sales Invoices, so RECTs customers do
not get a recurring Subscription; the period dates on the customer's billing
assignment (``billed_from``/``billed_to``) are the schedule instead.

Both kinds of order are marked on ``custom_rects_order_type`` so the Sales Order
list can colour them. Turning ``rects_auto_invoice`` on in the site config would
also submit the order and draft its Sales Invoice; it is off."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, today

ORDER_TYPE_BILLING = "RECTs Billing"
ORDER_TYPE_SEAL_SALE = "RECTs Seal Sale"
MAX_CATCH_UP_PERIODS = 12


def is_rects_customer(customer):
	"""A customer on RECTs only (RECTS branch ticked, ECTS not)."""
	rects, ects = frappe.db.get_value("Customer", customer, ["custom_division_rects", "custom_division_ects"]) or (0, 0)
	return bool(cint(rects) and not cint(ects))


def _primary_assignment(customer):
	return frappe.db.get_value(
		"Customer Billing Assignment",
		{"assignment_type": "Customer", "customer": customer, "active": 1, "is_extra_billing": 0},
		["name", "billing_rule", "outright_purchase", "owned_seal_count", "billed_from", "billed_to", "last_sales_order"],
		order_by="priority desc, modified desc",
		as_dict=True,
	)


def is_upfront_billed(customer):
	"""True for a RECTs customer whose billing is already running upfront: their
	journeys carry no per-journey charge, the period order covers them."""
	if not customer or not is_rects_customer(customer):
		return False
	a = _primary_assignment(customer)
	return bool(a and a.billed_to)


def _period_days(rule_name_or_type, first_period_days=None):
	from tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate import PERIOD_TYPE_DAYS

	return PERIOD_TYPE_DAYS.get(rule_name_or_type) or cint(first_period_days) or 30


def resolve_period(customer, billing_period_type, first_period_days=None):
	"""(from, to) the customer's current upfront period, driven by Frequency:
	the running period when one is still open, otherwise today for one Frequency."""
	a = _primary_assignment(customer)
	if a and a.billed_to and getdate(a.billed_to) >= getdate(today()):
		return a.billed_from, a.billed_to
	days = _period_days(billing_period_type, first_period_days)
	start = today()
	return start, add_days(start, days - 1)


def _new_sales_order(customer, order_type, reference, currency=None, billing_type=None):
	from tnt_seal_management.tnt_seal_management.api.completed_journeys import _get_business_line

	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.transaction_date = today()
	so.custom_rects_order_type = order_type
	so.custom_rects_reference = reference
	if currency:
		so.currency = currency
	business_line = _get_business_line(billing_type) if billing_type else None
	if business_line:
		so.cost_center = business_line
	so.append("custom_installation_location", {
		"contact_name": "N/A", "contact_mobile_no": "N/A", "vehicle_registration_no": "N/A",
		"vehicle_model": "N/A", "vehicle_make": "N/A", "vehicle_colour": "N/A", "location": "N/A",
	})
	return so


def _finish_sales_order(so, customer):
	from tnt_seal_management.tnt_seal_management.api.completed_journeys import _apply_sales_order_taxes
	from tnt_seal_management.tnt_seal_management.api.current_customers import TAX_CATEGORY_NORMAL

	tax_category = frappe.db.get_value("Customer", customer, "custom_tax_category") or TAX_CATEGORY_NORMAL
	if tax_category != TAX_CATEGORY_NORMAL:
		so.tax_category = tax_category
	_apply_sales_order_taxes(so, tax_category)
	so.insert(ignore_permissions=True, ignore_mandatory=True)
	_maybe_invoice(so)
	return so


def _maybe_invoice(so):
	"""Disabled for now (site config ``rects_auto_invoice``): submits the order and
	drafts its Sales Invoice for Finance."""
	if not frappe.conf.get("rects_auto_invoice"):
		return None
	from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

	so.submit()
	invoice = make_sales_invoice(so.name)
	invoice.insert(ignore_permissions=True)
	return invoice.name


def _period_sales_order(customer, assignment, period_from, period_to):
	rule = frappe.db.get_value(
		"Seal Billing Rate",
		assignment.billing_rule,
		["billing_type", "currency", "first_period_amount", "owned_rate_per_seal"],
		as_dict=True,
	)
	if not rule:
		return None
	billing_type = rule.billing_type
	item = "PCB-LEASING" if billing_type == "Leasing" else "PCB SUBSCRIPTIONS"
	seals, per_seal = cint(assignment.owned_seal_count), flt(rule.owned_rate_per_seal)
	if cint(assignment.outright_purchase) and seals > 0 and per_seal > 0:
		qty, rate = seals, per_seal
	else:
		qty, rate = 1, flt(rule.first_period_amount)
	if rate <= 0:
		return None

	so = _new_sales_order(customer, ORDER_TYPE_BILLING, f"{assignment.name}:{period_from}", rule.currency, billing_type)
	so.append("items", {
		"item_code": item,
		"qty": qty,
		"rate": rate,
		"price_list_rate": rate,
		"description": _("Upfront billing {0} to {1}").format(period_from, period_to),
		"delivery_date": today(),
	})
	return _finish_sales_order(so, customer)


def on_billing_saved(customer, period_from, period_to):
	"""After Set Billing is saved for a RECTs customer: raise the Sales Order for
	the first period. A period already running keeps its order; changed terms
	apply from the next one. Returns the Sales Order name, or None."""
	if not is_rects_customer(customer):
		return None
	a = _primary_assignment(customer)
	if not a:
		return None
	if a.billed_to and getdate(a.billed_to) >= getdate(today()):
		frappe.msgprint(
			_("The current period ({0} to {1}) is already billed on {2}. Changed terms apply from the next period.").format(
				a.billed_from, a.billed_to, a.last_sales_order
			),
			alert=True,
		)
		return None
	so = _period_sales_order(customer, a, period_from, period_to)
	if not so:
		frappe.msgprint(_("No Sales Order raised: the billing rate is zero."), alert=True, indicator="orange")
		return None
	frappe.db.set_value(
		"Customer Billing Assignment",
		a.name,
		{
			"effective_from": period_from,
			"effective_to": period_to,
			"billed_from": period_from,
			"billed_to": period_to,
			"last_sales_order": so.name,
		},
	)
	frappe.msgprint(_("Sales Order {0} raised for {1} to {2}.").format(so.name, period_from, period_to), alert=True, indicator="green")
	return so.name


def raise_due_cycle_sales_orders():
	"""Daily: a RECTs customer whose paid period has ended gets the next period's
	Sales Order (one per missed period, up to a year of them)."""
	rows = frappe.get_all(
		"Customer Billing Assignment",
		filters={
			"assignment_type": "Customer", "active": 1, "is_extra_billing": 0,
			"billed_to": ["<", today()], "customer": ["is", "set"],
		},
		fields=["name", "customer"],
	)
	for row in rows:
		try:
			if not is_rects_customer(row.customer):
				continue
			for _i in range(MAX_CATCH_UP_PERIODS):
				a = frappe.db.get_value(
					"Customer Billing Assignment", row.name,
					["name", "billing_rule", "outright_purchase", "owned_seal_count", "billed_to"], as_dict=True,
				)
				if not a.billed_to or getdate(a.billed_to) >= getdate(today()):
					break
				rule = frappe.db.get_value("Seal Billing Rate", a.billing_rule, ["billing_period_type", "first_period_days"], as_dict=True)
				start = add_days(a.billed_to, 1)
				end = add_days(start, _period_days(rule.billing_period_type, rule.first_period_days) - 1)
				so = _period_sales_order(row.customer, a, start, end)
				if not so:
					break
				frappe.db.set_value("Customer Billing Assignment", a.name, {
					"effective_from": start, "effective_to": end,
					"billed_from": start, "billed_to": end, "last_sales_order": so.name,
				})
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"RECTs cycle Sales Order {row.customer}", message=frappe.get_traceback())


def create_seal_sale_order(stock_entry, customer, lines):
	"""One Sales Order for the seals a Material Transfer sold to ``customer``:
	``lines`` is {item_code: [serial, ...]}. Priced from the item's selling price."""
	reference = stock_entry
	if frappe.db.exists("Sales Order", {"custom_rects_reference": reference, "docstatus": ["<", 2]}):
		return None
	so = _new_sales_order(customer, ORDER_TYPE_SEAL_SALE, reference)
	for item_code, serials in lines.items():
		rate = frappe.db.get_value("Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate") \
			or frappe.db.get_value("Item", item_code, "standard_rate") or 0
		so.append("items", {
			"item_code": item_code,
			"qty": len(serials),
			"rate": flt(rate),
			"price_list_rate": flt(rate),
			"description": _("Seals sold from stock ({0}): {1}").format(stock_entry, ", ".join(serials)),
			"delivery_date": today(),
		})
	if not so.items:
		return None
	return _finish_sales_order(so, customer).name
