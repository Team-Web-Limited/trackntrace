# Creates Quotation.custom_account_manager (see quotation_account_manager.py) and
# fills it on existing quotations. The account manager at the time those were
# made was never recorded, so they get their customer's *current* account
# manager. Only blanks are filled; `modified` is left alone.

import frappe

from tnt_seal_management.quotation_account_manager import FIELD, NAME_FIELD, make_custom_fields
from tnt_seal_management.quotation_customer import BACKLINK_FIELD


def execute():
	make_custom_fields()

	# Quoted straight to a customer.
	frappe.db.sql(
		f"""update `tabQuotation` q
		join `tabCustomer` c on c.name = q.party_name
		left join `tabUser` u on u.name = c.account_manager
		set q.`{FIELD}` = c.account_manager, q.`{NAME_FIELD}` = u.full_name
		where q.quotation_to = 'Customer' and ifnull(c.account_manager, '') <> ''
		and ifnull(q.`{FIELD}`, '') = ''"""
	)

	# Quoted to a lead/prospect that became a customer (oldest customer wins,
	# same rule as quotation_customer.resolve_customer).
	for quotation_to, backlink in BACKLINK_FIELD.items():
		frappe.db.sql(
			f"""update `tabQuotation` q
			join (
				select c.`{backlink}` party, c.account_manager
				from `tabCustomer` c
				join (
					select `{backlink}` party, min(creation) first_created
					from `tabCustomer` where ifnull(`{backlink}`, '') <> ''
					group by `{backlink}`
				) f on f.party = c.`{backlink}` and f.first_created = c.creation
				group by c.`{backlink}`
			) m on m.party = q.party_name
			left join `tabUser` u on u.name = m.account_manager
			set q.`{FIELD}` = m.account_manager, q.`{NAME_FIELD}` = u.full_name
			where q.quotation_to = %s and ifnull(m.account_manager, '') <> ''
			and ifnull(q.`{FIELD}`, '') = ''""",
			(quotation_to,),
		)
