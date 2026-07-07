import frappe

# Reverts seed_flat_rate_billing_rule_variants.py — a "period" (Daily/Weekly/
# Bi-Weekly/Monthly/Quarterly/Semi-Annual/Annual) turned out to be meaningless
# for a flat rate: PCB Scenario 3 is a fixed KES 1,000 charge per journey/seal
# with extra_day_rate = 0, and once extra_day_rate is 0 the formula in
# billing.compute_billing_amount collapses to first_period_amount regardless
# of total_days or first_period_days — so every variant billed identically
# and the period never did anything. Back to a single generic "Flat Rate"
# rule (Days / 1-day threshold, matching Scenario 3 exactly), with any
# Customer Billing Assignment still pointing at one of the other variants
# repointed to it before the duplicates are removed.
VARIANT_NAMES = (
	"Flat Rate — Daily",
	"Flat Rate — Weekly",
	"Flat Rate — Bi-Weekly",
	"Flat Rate — Monthly",
	"Flat Rate — Quarterly",
	"Flat Rate — Semi-Annual",
	"Flat Rate — Annual",
)
CANONICAL_NAME = "Flat Rate"


def execute():
	if not frappe.db.table_exists("Seal Billing Rate"):
		return

	canonical = frappe.db.exists("Seal Billing Rate", {"billing_rule_name": CANONICAL_NAME})
	if not canonical:
		# Prefer promoting "Flat Rate — Daily" (already exactly Scenario 3's
		# shape) back to the generic name; fall back to creating one fresh.
		canonical = frappe.db.exists("Seal Billing Rate", {"billing_rule_name": "Flat Rate — Daily"})
		if canonical:
			frappe.db.set_value("Seal Billing Rate", canonical, "billing_rule_name", CANONICAL_NAME)
		else:
			doc = frappe.get_doc(
				{
					"doctype": "Seal Billing Rate",
					"billing_rule_name": CANONICAL_NAME,
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
						"per journey/seal regardless of duration (extra_day_rate is 0, "
						"same formula as PCB Scenario 3)."
					),
				}
			)
			doc.insert(ignore_permissions=True)
			canonical = doc.name

	# Ensure the canonical rule actually has Scenario 3's shape, in case it was
	# edited in the meantime.
	frappe.db.set_value(
		"Seal Billing Rate",
		canonical,
		{"billing_period_type": "Days", "first_period_days": 1, "extra_day_rate": 0},
	)

	for variant_name in VARIANT_NAMES:
		variant = frappe.db.exists("Seal Billing Rate", {"billing_rule_name": variant_name})
		if not variant or variant == canonical:
			continue

		frappe.db.set_value(
			"Customer Billing Assignment", {"billing_rule": variant}, "billing_rule", canonical
		)
		frappe.delete_doc("Seal Billing Rate", variant, ignore_permissions=True, force=True)

	frappe.db.commit()
