import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# A generic, pickable "Flat Rate" option for the Set Billing modal's Billing
# Rule dropdown — the same flat-charge-regardless-of-duration formula as PCB
# Scenario 3 (extra_day_rate = 0, so any days beyond first_period_days add
# nothing), but as a normal rate card rather than a PCB-specific named rule
# (those are excluded from the modal's picker — see
# seed_pcb_journey_billing_scenarios.py and current_customers.get_customer_billing).


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	billing_rule_name = "Flat Rate"
	if frappe.db.exists("Seal Billing Rate", {"billing_rule_name": billing_rule_name}):
		return

	doc = frappe.get_doc(
		{
			"doctype": "Seal Billing Rate",
			"billing_rule_name": billing_rule_name,
			"billing_type": "Subscription",
			"billing_period_type": "Days",
			"first_period_days": 1,
			"first_period_amount": 1000,
			"extra_day_rate": 0,
			"active": 1,
			"is_global_default": 0,
			"currency": "KES",
			"approval_status": "Approved",
			"remarks": (
				"Seeded default rule — review the amount before use. Flat charge "
				"regardless of journey duration (extra_day_rate is 0, same formula "
				"as PCB Scenario 3)."
			),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
