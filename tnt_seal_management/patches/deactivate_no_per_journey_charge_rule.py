import frappe

# "No Per-Journey Charge (Leasing)" let Finance manually zero a seat-based
# customer's per-journey charge by picking this specific rule — a convention
# that only worked if they remembered to pick it. Seal Journey.set_billing now
# auto-zeroes the per-journey base charge for any customer who has a seat-based
# recurring Subscription (Seal Lease Fee / Seal Ownership Service Fee — see
# seal_lease_billing.customer_has_seat_subscription), regardless of which
# per-journey rule is nominally assigned. Deactivated (not deleted — a Customer
# Billing Assignment may still reference it by name) so it drops out of the Set
# Billing modal's Billing Rule dropdown (get_customer_billing filters active=1).
RULE_NAME = "No Per-Journey Charge (Leasing)"


def execute():
	frappe.db.set_value("Seal Billing Rate", {"billing_rule_name": RULE_NAME}, "active", 0)
	frappe.db.commit()
