# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""RECTs Sales Orders: seals sold from the warehouse raise their own Sales Order
when the Material Transfer is approved (``create_seal_sale_order``). RECTs
billing itself is per journey, like ECTS.

Orders are marked on ``custom_rects_order_type`` so the Sales Order list can
colour them (``RECTs Billing`` remains for orders raised before upfront billing
was removed). Turning ``rects_auto_invoice`` on in the site config would also
submit the order and draft its Sales Invoice; it is off."""

import frappe
from frappe import _
from frappe.utils import cint, flt, today

ORDER_TYPE_BILLING = "RECTs Billing"
ORDER_TYPE_SEAL_SALE = "RECTs Seal Sale"


def is_rects_customer(customer):
	"""A customer on RECTs only (RECTS branch ticked, ECTS not)."""
	rects, ects = frappe.db.get_value("Customer", customer, ["custom_division_rects", "custom_division_ects"]) or (0, 0)
	return bool(cint(rects) and not cint(ects))


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
