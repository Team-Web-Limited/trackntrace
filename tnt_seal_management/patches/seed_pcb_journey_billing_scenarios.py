import frappe

# Rate cards from the PCB Journey Current Billing Patterns document — Scenarios
# 1-3. These are transactional, per-journey (now per-seal) rates: a fixed
# number of days at a flat first-period amount, then a per-day rate beyond
# that. billing_period_type "Days" is used for all three since the day count
# is contractual (3, 7, 1), not a recurring calendar period.
#
# Scenario 3 (flat rate regardless of duration) is the same formula with
# extra_day_rate = 0: once total_days <= first_period_days the charge is just
# first_period_amount, and any days beyond it add zero, so the total never
# changes with duration.
#
# Scenarios 4-6 (recurring, per-owned/leased-seal subscription billing that is
# independent of journeys, and merging that with journey-based charges into a
# consolidated invoice) are NOT represented here — that requires a recurring
# billing engine and invoice consolidation that don't exist in this app yet.
SCENARIO_RULES = (
	{
		"billing_rule_name": "PCB Scenario 1 — $14/3-Day + $5/day (USD)",
		"currency": "USD",
		"first_period_days": 3,
		"first_period_amount": 14,
		"extra_day_rate": 5,
		"remarks": "PCB Journey Billing Patterns doc, Scenario 1: $14.00 baseline for Days 1-3, then $5.00/day beyond.",
	},
	{
		"billing_rule_name": "PCB Scenario 2 — $20/7-Day + $5/day (USD)",
		"currency": "USD",
		"first_period_days": 7,
		"first_period_amount": 20,
		"extra_day_rate": 5,
		"remarks": "PCB Journey Billing Patterns doc, Scenario 2: $20.00 baseline for Days 1-7, then $5.00/day beyond.",
	},
	{
		"billing_rule_name": "PCB Scenario 3 — Flat KES 1,000 per Journey",
		"currency": "KES",
		"first_period_days": 1,
		"first_period_amount": 1000,
		"extra_day_rate": 0,
		"remarks": (
			"PCB Journey Billing Patterns doc, Scenario 3: flat Ksh 1,000.00 regardless of "
			"duration. extra_day_rate is 0 so the charge never changes beyond the first day."
		),
	},
)


def execute():
	for data in SCENARIO_RULES:
		if frappe.db.exists("Seal Billing Rate", {"billing_rule_name": data["billing_rule_name"]}):
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Seal Billing Rate",
				"billing_type": "Subscription",
				"billing_period_type": "Days",
				"active": 1,
				"is_global_default": 0,
				**data,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
