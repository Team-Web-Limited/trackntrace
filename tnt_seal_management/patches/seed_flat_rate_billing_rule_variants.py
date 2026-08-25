import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# "Flat Rate" (seed_flat_rate_billing_rule.py) covered only one cadence
# (Days / 1-day). A flat, no-per-day-proration charge (extra_day_rate = 0) can
# just as well be agreed at any billing cadence — Daily, Weekly, Bi-Weekly,
# Monthly, Quarterly, Semi-Annual, Annual — so each cadence gets its own
# pickable rate card in the Set Billing modal's Billing Rule dropdown, same
# pattern as the generic Default Weekly/Monthly/... rules
# (seed_default_billing_rules.py). No "Bi-Weekly"/"Daily" Billing Period Type
# exists on Seal Billing Rate — both use the generic "Days" type with the
# matching day count instead.
FLAT_RATE_VARIANTS = (
	{
		"billing_rule_name": "Flat Rate — Daily",
		"billing_period_type": "Days",
		"first_period_days": 1,
	},
	{
		"billing_rule_name": "Flat Rate — Weekly",
		"billing_period_type": "Weekly",
	},
	{
		"billing_rule_name": "Flat Rate — Bi-Weekly",
		"billing_period_type": "Days",
		"first_period_days": 14,
	},
	{
		"billing_rule_name": "Flat Rate — Monthly",
		"billing_period_type": "Monthly",
	},
	{
		"billing_rule_name": "Flat Rate — Quarterly",
		"billing_period_type": "Quarterly",
	},
	{
		"billing_rule_name": "Flat Rate — Semi-Annual",
		"billing_period_type": "Semi-Annually",
	},
	{
		"billing_rule_name": "Flat Rate — Annual",
		"billing_period_type": "Annually",
	},
)


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	# The original single "Flat Rate" rule (Days / 1-day) is superseded by the
	# explicit "Flat Rate — Daily" variant below — rename it in place rather
	# than leaving two overlapping "1-day flat" rules in the dropdown.
	old_name = frappe.db.exists("Seal Billing Rate", {"billing_rule_name": "Flat Rate"})
	if old_name and not frappe.db.exists("Seal Billing Rate", {"billing_rule_name": "Flat Rate — Daily"}):
		frappe.db.set_value("Seal Billing Rate", old_name, "billing_rule_name", "Flat Rate — Daily")

	for data in FLAT_RATE_VARIANTS:
		if frappe.db.exists("Seal Billing Rate", {"billing_rule_name": data["billing_rule_name"]}):
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Seal Billing Rate",
				"billing_type": "Subscription",
				"first_period_amount": 1000,
				"extra_day_rate": 0,
				"active": 1,
				"is_global_default": 0,
				"currency": "KES",
				"approval_status": "Approved",
				"remarks": (
					"Seeded default rule — review the amount before use. Flat charge "
					"regardless of duration within the period (extra_day_rate is 0)."
				),
				**data,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
