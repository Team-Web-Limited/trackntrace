# Keeps Quotation.custom_customer ("Customer", a site-level Custom Field) filled
# so Report Builder views that use it show the customer on every quotation:
#   - quoted to a Customer   -> that customer (party_name)
#   - quoted to a Lead/Prospect that became a Customer -> that customer
#   - Lead/Prospect not converted yet -> left as is (normally blank)
# ERPNext never updates a Lead quotation after conversion; the only link back is
# Customer.lead_name / Customer.prospect_name, so conversion is handled from the
# Customer side as well. Writes use db_set-style updates without touching
# `modified`, so submitted quotations aren't re-saved and no versions are added.

import frappe

FIELD = "custom_customer"

# quotation_to -> Customer field that points back at that party
BACKLINK_FIELD = {"Lead": "lead_name", "Prospect": "prospect_name"}


def _has_field():
	return frappe.get_meta("Quotation").has_field(FIELD)


def resolve_customer(quotation_to, party_name):
	if not party_name:
		return None
	if quotation_to == "Customer":
		return party_name
	backlink = BACKLINK_FIELD.get(quotation_to)
	if not backlink:
		return None
	# Oldest customer wins if a lead was converted more than once.
	return frappe.db.get_value("Customer", {backlink: party_name}, "name", order_by="creation asc")


def set_quotation_customer(doc, method=None):
	"""Quotation validate: fill custom_customer from the party."""
	if not _has_field():
		return
	customer = resolve_customer(doc.quotation_to, doc.party_name)
	if customer:
		doc.set(FIELD, customer)


def link_quotations_to_new_customer(doc, method=None):
	"""Customer after_insert: a lead/prospect just became this customer."""
	if not _has_field():
		return
	for quotation_to, backlink in BACKLINK_FIELD.items():
		party = doc.get(backlink)
		if not party:
			continue
		frappe.db.sql(
			f"""update `tabQuotation` set `{FIELD}` = %s
			where quotation_to = %s and party_name = %s and ifnull(`{FIELD}`, '') = ''""",
			(doc.name, quotation_to, party),
		)
