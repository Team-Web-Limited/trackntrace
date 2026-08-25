import frappe

from tnt_seal_management.seed_guard import seeding_allowed
from tnt_seal_management.tnt_seal_management.api.current_customers import (
	_get_default_customer_group,
	_get_default_territory,
)

# Test data requested for the tax-exempt / zero-rated billing rollout — these
# two accounts exercise the non-standard tax categories end to end.
_TEST_TAX_CATEGORIES = {
	"Summit Link Movers Ltd": "Zero Rated",
	"Rift Valley Movers Ltd": "Tax Exempt",
}


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	customer_group = _get_default_customer_group()
	territory = _get_default_territory()

	for customer_name, tax_category in _TEST_TAX_CATEGORIES.items():
		existing = frappe.db.exists("Customer", {"customer_name": customer_name})
		if not existing:
			doc = frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": customer_name,
					"customer_type": "Company",
					"customer_group": customer_group,
					"territory": territory,
				}
			)
			doc.insert(ignore_permissions=True)
			existing = doc.name

		frappe.db.set_value("Customer", existing, "custom_tax_category", tax_category)

	frappe.db.commit()
