import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Items backing the recurring, seal-count-based Subscription billing (PCB Journey
# Billing Patterns doc, Scenarios 4-6) — a fee per line item on the generated Sales
# Invoice via ERPNext's Subscription/Subscription Plan machinery. Both are seeded now:
# "Seal Lease Fee" is used immediately; "Seal Ownership Service Fee" is pre-seeded for
# the Scenario 5 fast-follow so that PR doesn't need its own Item-seeding patch.
LEASE_ITEMS = (
	{
		"item_code": "Seal Lease Fee",
		"item_name": "Seal Lease Fee",
	},
	{
		"item_code": "Seal Ownership Service Fee",
		"item_name": "Seal Ownership Service Fee",
	},
)


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	item_group = (
		"Subscription Services"
		if frappe.db.exists("Item Group", "Subscription Services")
		else "All Item Groups"
	)

	for data in LEASE_ITEMS:
		if frappe.db.exists("Item", data["item_code"]):
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Item",
				"item_group": item_group,
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				**data,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
