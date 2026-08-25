import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Some customers are billed entirely through the recurring Lease/Ownership
# Service Fee (Scenario 4/5, seal_lease_billing.py) rather than per journey —
# there's no journey-level rate to charge them at all. These two rules exist
# so Finance has an explicit, pickable "no per-journey charge" option in the
# Set Billing modal's Billing Rule dropdown, distinguished by whether the
# customer leases or owns their seals outright (see the Seal Ownership /
# Outright Purchase toggle on Customer Billing Assignment). The Set Billing
# modal auto-syncs that toggle when either of these two rules is picked.
NO_CHARGE_RULES = (
	{
		"billing_rule_name": "No Charge — Leased Seals",
		"remarks": (
			"No per-journey charge — this customer's seals are leased and billed "
			"entirely through the recurring Seal Lease Fee (Scenario 4), not per "
			"journey. Picking this rule in Set Billing sets Outright Purchase to No."
		),
	},
	{
		"billing_rule_name": "No Charge — Owned Seals",
		"remarks": (
			"No per-journey charge — this customer owns their seals outright and is "
			"billed entirely through the recurring Ownership Service Fee (Scenario 5), "
			"not per journey. Picking this rule in Set Billing sets Outright Purchase to Yes."
		),
	},
)


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	for data in NO_CHARGE_RULES:
		if frappe.db.exists("Seal Billing Rate", {"billing_rule_name": data["billing_rule_name"]}):
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Seal Billing Rate",
				"billing_type": "Subscription",
				"billing_period_type": "Monthly",
				"active": 1,
				"is_global_default": 0,
				"currency": "KES",
				"first_period_amount": 0,
				"extra_day_rate": 0,
				# Foundational system rules, not a Finance-authored rate card —
				# approved up front like the grandfathered defaults, so they're
				# immediately usable in the Set Billing modal.
				"approval_status": "Approved",
				**data,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.db.commit()
