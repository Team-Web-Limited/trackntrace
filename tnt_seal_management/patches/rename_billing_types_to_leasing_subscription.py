import frappe

# The Seal Billing Rate.billing_type Select options were renamed:
#   Default -> Subscription   (shared rate card / global-default-capable)
#   Special -> Leasing        (private, per-customer contract)
# Update existing rows so they match the new option values. Runs after the
# doctype schema is synced (post_model_sync), so the new options are in place.
RENAMES = (("Default", "Subscription"), ("Special", "Leasing"))


def execute():
	if not frappe.db.has_column("Seal Billing Rate", "billing_type"):
		return

	for old, new in RENAMES:
		frappe.db.sql(
			"""
			update `tabSeal Billing Rate`
			set billing_type = %s
			where billing_type = %s
			""",
			(new, old),
		)

	frappe.db.commit()
