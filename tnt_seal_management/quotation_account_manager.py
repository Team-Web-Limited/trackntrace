# Quotation.custom_account_manager: who the customer's Account Manager was when
# the quotation was made. ERPNext only keeps the account manager on the Customer
# (Customer.account_manager), and that value changes over time, so it is copied
# onto the quotation as a snapshot:
#   - a draft takes it from its customer when created, and again if its party
#     changes while still a draft;
#   - after that it is never refreshed, so later changes on the Customer don't
#     rewrite history;
#   - a Lead/Prospect quotation has no customer yet, so it stays blank until the
#     lead is converted, then the new customer's account manager is filled in.

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from tnt_seal_management.quotation_customer import BACKLINK_FIELD, resolve_customer

FIELD = "custom_account_manager"
NAME_FIELD = "custom_account_manager_name"

CUSTOM_FIELDS = {
	"Quotation": [
		{
			"fieldname": FIELD,
			"label": "Account Manager",
			"fieldtype": "Link",
			"options": "User",
			"insert_after": "customer_name",
			"read_only": 1,
			"in_standard_filter": 1,
			"description": "Copied from the customer when the quotation is created.",
		},
		{
			"fieldname": NAME_FIELD,
			"label": "Account Manager Name",
			"fieldtype": "Data",
			"insert_after": FIELD,
			"fetch_from": f"{FIELD}.full_name",
			"read_only": 1,
			"in_list_view": 0,
		},
	]
}


def make_custom_fields():
	create_custom_fields(CUSTOM_FIELDS, update=True)
	frappe.clear_cache(doctype="Quotation")


def _has_field():
	return frappe.get_meta("Quotation").has_field(FIELD)


def _customer_account_manager(customer):
	return customer and frappe.db.get_value("Customer", customer, "account_manager") or None


def set_account_manager(doc, method=None):
	"""Quotation validate: snapshot the customer's account manager."""
	if not _has_field() or doc.docstatus != 0:
		return
	party_changed = not doc.is_new() and (
		doc.has_value_changed("party_name") or doc.has_value_changed("quotation_to")
	)
	if doc.get(FIELD) and not party_changed:
		return
	manager = _customer_account_manager(resolve_customer(doc.quotation_to, doc.party_name))
	if manager or party_changed:
		doc.set(FIELD, manager)
		doc.set(NAME_FIELD, manager and frappe.db.get_value("User", manager, "full_name"))


def fill_for_converted_customer(doc, method=None):
	"""Customer after_insert: a lead/prospect became this customer."""
	if not _has_field() or not doc.account_manager:
		return
	full_name = frappe.db.get_value("User", doc.account_manager, "full_name")
	for quotation_to, backlink in BACKLINK_FIELD.items():
		party = doc.get(backlink)
		if not party:
			continue
		frappe.db.sql(
			f"""update `tabQuotation` set `{FIELD}` = %s, `{NAME_FIELD}` = %s
			where quotation_to = %s and party_name = %s and ifnull(`{FIELD}`, '') = ''""",
			(doc.account_manager, full_name, quotation_to, party),
		)
