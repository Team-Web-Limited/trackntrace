import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Seeded default rules — one per billing period. Amounts are placeholders meant
# to be reviewed/edited; the day counts follow the standard period lengths. The
# monthly rule is the system-wide fallback (is_global_default). Each rule still
# carries its own first_period_amount / extra_day_rate, so contract terms can
# differ per period without changing the calculation.
DEFAULT_RULES = (
	{
		"billing_rule_name": "Default Weekly",
		"billing_period_type": "Weekly",
		"first_period_days": 7,
		"first_period_amount": 5000,
		"extra_day_rate": 500,
	},
	{
		"billing_rule_name": "Default Monthly",
		"billing_period_type": "Monthly",
		"first_period_days": 30,
		"first_period_amount": 15000,
		"extra_day_rate": 200,
		"is_global_default": 1,
	},
	{
		"billing_rule_name": "Default Quarterly",
		"billing_period_type": "Quarterly",
		"first_period_days": 90,
		"first_period_amount": 40000,
		"extra_day_rate": 200,
	},
	{
		"billing_rule_name": "Default Semi-Annual",
		"billing_period_type": "Semi-Annually",
		"first_period_days": 180,
		"first_period_amount": 75000,
		"extra_day_rate": 150,
	},
	{
		"billing_rule_name": "Default Annual",
		"billing_period_type": "Annually",
		"first_period_days": 365,
		"first_period_amount": 140000,
		"extra_day_rate": 150,
	},
)


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	for data in DEFAULT_RULES:
		if frappe.db.exists("Seal Billing Rate", {"billing_rule_name": data["billing_rule_name"]}):
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Seal Billing Rate",
				"billing_type": "Subscription",
				"active": 1,
				"currency": "KES",
				"remarks": "Seeded default rule — review the amounts before use.",
				**data,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
