import frappe

# "No Charge — Leased Seals" / "No Charge — Owned Seals" (seed_no_charge_billing_rules)
# predate the seat-based Rate override (Number of Seals Leased × Rate per Seal,
# see applySeatBasedRateOverride in current_customer_list.js) and the Extra
# Billing (Scenario 6) agreement — both now express "billed via the recurring
# fee, not a flat per-journey rate" without needing a dedicated zero-rate rule,
# and picking one of these without also filling in the matching seat fields
# silently zeroes a customer's per-journey billing. Deactivated (not deleted —
# unused, but a Customer Billing Assignment could still reference the rule by
# name) so they drop out of the Set Billing modal's Billing Rule dropdown
# (get_customer_billing filters active=1).
NO_CHARGE_RULE_NAMES = ("No Charge — Leased Seals", "No Charge — Owned Seals")


def execute():
	for billing_rule_name in NO_CHARGE_RULE_NAMES:
		frappe.db.set_value(
			"Seal Billing Rate", {"billing_rule_name": billing_rule_name}, "active", 0
		)
	frappe.db.commit()
