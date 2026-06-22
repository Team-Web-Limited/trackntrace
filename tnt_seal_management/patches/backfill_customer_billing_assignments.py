import frappe

# Migrate the old single-link model (Customer.custom_billing_type) to the new
# Customer Billing Assignment doctype. Each customer that had a billing rule gets
# an equivalent customer-level assignment. Idempotent; the legacy field is left
# in place (unused) and can be dropped in a later cleanup patch once verified.


def execute():
	if not frappe.db.has_column("Customer", "custom_billing_type"):
		return

	rows = frappe.get_all(
		"Customer",
		filters={"custom_billing_type": ["is", "set"]},
		fields=["name", "custom_billing_type"],
	)

	for row in rows:
		rule = row.custom_billing_type
		if not rule or not frappe.db.exists("Seal Billing Rate", rule):
			continue

		already = frappe.db.exists(
			"Customer Billing Assignment",
			{"assignment_type": "Customer", "customer": row.name},
		)
		if already:
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Customer Billing Assignment",
				"assignment_type": "Customer",
				"customer": row.name,
				"billing_rule": rule,
				"active": 1,
				"remarks": "Backfilled from Customer.custom_billing_type.",
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
