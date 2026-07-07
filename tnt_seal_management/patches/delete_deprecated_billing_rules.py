import frappe

# Deletes six unused/superseded Seal Billing Rate rules. Must run after
# reassign_deprecated_billing_rules_to_default.py and
# recompute_journeys_on_deprecated_rules.py so no Customer Billing Assignment
# or Seal Journey still links to any of them (verified via bench console
# before writing this patch — 0 references to all six once those two ran):
#
# - "No Charge — Leased Seals" / "No Charge — Owned Seals": already
#   deactivated in deactivate_no_charge_billing_rules.py, 0 usages — the
#   seat-based Rate override and Extra Billing agreement now express this
#   without a dedicated zero-rate rule.
# - "test3": stray Pending Approval rule, never used.
# - PCB Scenario 1/2/3: superseded by the general per-seal formula every rule
#   now uses (billing.compute_billing_amount) — their customers were moved to
#   Default Monthly.
DEPRECATED_RULE_IDS = (
	"5m46cfsu9s",  # No Charge — Leased Seals
	"5m697o3edp",  # No Charge — Owned Seals
	"godh2b7iht",  # test3
	"e20pkdsi1f",  # PCB Scenario 1 — $14/3-Day + $5/day (USD)
	"e22mv28124",  # PCB Scenario 2 — $20/7-Day + $5/day (USD)
	"e22pmnvnck",  # PCB Scenario 3 — Flat KES 1,000 per Journey
)


def execute():
	for rule_id in DEPRECATED_RULE_IDS:
		if not frappe.db.exists("Seal Billing Rate", rule_id):
			continue
		still_referenced = frappe.db.count("Customer Billing Assignment", {"billing_rule": rule_id}) or frappe.db.count(
			"Seal Journey", {"billing_rule": rule_id}
		)
		if still_referenced:
			# Safety net — don't silently orphan live data if the pre-checks
			# this patch relied on turn out stale by the time it runs.
			continue
		frappe.delete_doc("Seal Billing Rate", rule_id, ignore_permissions=True)

	frappe.db.commit()
