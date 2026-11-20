# Copyright (c) 2026, TNT Seal Management and contributors
# For license information, please see license.txt

# Quotations with the customer they belong to, even when they were raised to a
# Lead or Prospect. ERPNext never updates a Lead quotation once the lead is
# converted: party_name keeps the CRM-LEAD id and the new Customer is linked
# back only through Customer.lead_name (or Customer.prospect_name). This report
# follows that link so every quotation shows a customer where one exists.

import frappe
from frappe import _

SOURCE_DIRECT = "Direct"
SOURCE_CONVERTED = "Converted Lead"
SOURCE_NOT_CONVERTED = "Not Converted"

# quotation_to -> Customer field that points back at that party
_BACKLINK_FIELD = {"Lead": "lead_name", "Prospect": "prospect_name"}


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Quotation"), "fieldname": "name", "fieldtype": "Link", "options": "Quotation", "width": 150},
		{"label": _("Date"), "fieldname": "transaction_date", "fieldtype": "Date", "width": 100},
		{"label": _("Quotation To"), "fieldname": "quotation_to", "fieldtype": "Data", "width": 100},
		{"label": _("Party"), "fieldname": "party_name", "fieldtype": "Dynamic Link", "options": "quotation_to", "width": 170},
		{"label": _("Party Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 200},
		{"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 200},
		{"label": _("Customer Source"), "fieldname": "customer_source", "fieldtype": "Data", "width": 120},
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
		{"label": _("Workflow State"), "fieldname": "workflow_state", "fieldtype": "Data", "width": 120},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "width": 80},
		{"label": _("Grand Total"), "fieldname": "grand_total", "fieldtype": "Currency", "options": "currency", "width": 130},
		{"label": _("Grand Total (Company Currency)"), "fieldname": "base_grand_total", "fieldtype": "Currency", "width": 150},
		{"label": _("Prepared By"), "fieldname": "prepared_by_name", "fieldtype": "Data", "width": 140},
		{"label": _("Owner"), "fieldname": "owner", "fieldtype": "Link", "options": "User", "width": 180},
		{"label": _("Valid Till"), "fieldname": "valid_till", "fieldtype": "Date", "width": 100},
		{"label": _("Company"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 150},
	]


def get_data(filters):
	list_filters = [["docstatus", "<", 2]]
	if filters.from_date:
		list_filters.append(["transaction_date", ">=", filters.from_date])
	if filters.to_date:
		list_filters.append(["transaction_date", "<=", filters.to_date])
	for field in ("company", "quotation_to", "status", "owner"):
		if filters.get(field):
			list_filters.append([field, "=", filters.get(field)])
	if filters.customer:
		list_filters.append(["party_name", "in", _parties_for_customer(filters.customer)])

	# get_list so the user's Company / other user permissions still apply.
	rows = frappe.get_list(
		"Quotation",
		filters=list_filters,
		fields=[
			"name", "transaction_date", "quotation_to", "party_name", "customer_name",
			"status", "workflow_state", "currency", "grand_total", "base_grand_total",
			"prepared_by_name", "owner", "valid_till", "company",
		],
		order_by="transaction_date desc, name desc",
		limit_page_length=0,
	)

	converted = _converted_customers(rows)
	data = []
	for row in rows:
		if row.quotation_to == "Customer":
			row.customer = row.party_name
			row.customer_source = SOURCE_DIRECT
		else:
			row.customer = converted.get((row.quotation_to, row.party_name))
			row.customer_source = SOURCE_CONVERTED if row.customer else SOURCE_NOT_CONVERTED

		if filters.customer and row.customer != filters.customer:
			continue
		if filters.customer_source and row.customer_source != filters.customer_source:
			continue
		data.append(row)
	return data


def _converted_customers(rows):
	"""{(quotation_to, party): customer} for Lead/Prospect quotations whose party became a Customer."""
	result = {}
	for party_type, backlink in _BACKLINK_FIELD.items():
		parties = {r.party_name for r in rows if r.quotation_to == party_type}
		if not parties:
			continue
		# Oldest customer wins if a lead was converted more than once.
		for c in frappe.get_all(
			"Customer",
			filters={backlink: ["in", list(parties)]},
			fields=["name", backlink],
			order_by="creation desc",
		):
			result[(party_type, c[backlink])] = c.name
	return result


def _parties_for_customer(customer):
	"""Every party_name a quotation for this customer could carry: itself plus its lead/prospect."""
	parties = [customer]
	backlinks = frappe.db.get_value("Customer", customer, list(_BACKLINK_FIELD.values()), as_dict=True) or {}
	parties.extend(v for v in backlinks.values() if v)
	return parties
