# One-off fill of Quotation.custom_customer on existing quotations (see
# tnt_seal_management/quotation_customer.py). Only blank values are filled, and
# `modified` is left alone so submitted quotations aren't touched otherwise.

import frappe

from tnt_seal_management.quotation_customer import BACKLINK_FIELD, FIELD


def execute():
	if not frappe.get_meta("Quotation").has_field(FIELD):
		return

	# Quoted straight to a customer.
	frappe.db.sql(
		f"""update `tabQuotation` set `{FIELD}` = party_name
		where quotation_to = 'Customer' and ifnull(party_name, '') <> ''
		and ifnull(`{FIELD}`, '') = ''"""
	)

	# Quoted to a lead/prospect that has since become a customer (oldest customer wins).
	for quotation_to, backlink in BACKLINK_FIELD.items():
		frappe.db.sql(
			f"""update `tabQuotation` q
			join (
				select c.`{backlink}` party, min(c.name) customer
				from `tabCustomer` c
				join (
					select `{backlink}` party, min(creation) first_created
					from `tabCustomer` where ifnull(`{backlink}`, '') <> ''
					group by `{backlink}`
				) f on f.party = c.`{backlink}` and f.first_created = c.creation
				group by c.`{backlink}`
			) m on m.party = q.party_name
			set q.`{FIELD}` = m.customer
			where q.quotation_to = %s and ifnull(q.`{FIELD}`, '') = ''""",
			(quotation_to,),
		)
