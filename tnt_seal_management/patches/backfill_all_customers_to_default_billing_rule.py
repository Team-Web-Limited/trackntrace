import frappe

from tnt_seal_management.seed_guard import seeding_allowed

DEFAULT_BILLING_RULE = "sqf2gijhij"


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	if not frappe.db.exists("Seal Billing Rate", DEFAULT_BILLING_RULE):
		return

	if frappe.db.has_column("Customer", "custom_billing_type"):
		frappe.db.sql(
			"""
			update `tabCustomer`
			set custom_billing_type = %s
			where ifnull(custom_billing_type, '') != %s
			""",
			(DEFAULT_BILLING_RULE, DEFAULT_BILLING_RULE),
		)

	frappe.db.sql(
		"""
		update `tabCustomer Billing Assignment`
		set billing_rule = %s, active = 1
		where assignment_type = 'Customer'
		""",
		DEFAULT_BILLING_RULE,
	)

	customers = frappe.get_all("Customer", pluck="name")
	existing = set(
		frappe.get_all(
			"Customer Billing Assignment",
			filters={"assignment_type": "Customer"},
			pluck="customer",
		)
	)

	for customer in customers:
		if customer in existing:
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Customer Billing Assignment",
				"assignment_type": "Customer",
				"customer": customer,
				"billing_rule": DEFAULT_BILLING_RULE,
				"active": 1,
				"remarks": "Backfilled to the default billing rule.",
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
