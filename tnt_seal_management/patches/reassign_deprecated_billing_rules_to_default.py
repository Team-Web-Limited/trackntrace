import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Reassigns every Customer Billing Assignment still pointing at a rule that's
# about to be retired (see delete_deprecated_billing_rules.py, which runs
# right after this) to the global default rule, so nobody's per-journey
# billing loses its assignment:
#
# - sqf2gijhym: an old rule that no longer exists in Seal Billing Rate at all
#   (deleted at some point without its ~11.8k Customer Billing Assignment
#   references being cleaned up). billing._rule_is_usable already treats a
#   missing rule as unusable and falls every one of these customers through
#   to the global default today — this just makes that explicit instead of
#   dangling.
# - PCB Scenario 1/2/3: still the live per-journey rule for a handful of real
#   customers (Apex Transit, BlueRoute, CargoSpan East Africa, Delta Haulage,
#   Frontier Gate, HarborBridge, Summit Link) — confirmed via
#   bench console that none of them carry an outright/override/date-window
#   worth preserving, so a plain billing_rule swap is safe.
#
# Default Monthly (nvi5neb62g) is the current is_global_default rule — same
# rate (15,000/rate) these customers already effectively bill at via fallback.
STALE_RULE_IDS = ("sqf2gijhym", "e20pkdsi1f", "e22mv28124", "e22pmnvnck")
DEFAULT_RULE_ID = "nvi5neb62g"


def execute():
	# Operates on document ids hardcoded from the dev database — never runs
	# on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	if not frappe.db.exists("Seal Billing Rate", DEFAULT_RULE_ID):
		frappe.throw(f"Expected global default rule {DEFAULT_RULE_ID} not found — aborting reassignment.")

	frappe.db.set_value(
		"Customer Billing Assignment",
		{"billing_rule": ["in", STALE_RULE_IDS]},
		"billing_rule",
		DEFAULT_RULE_ID,
	)
	frappe.db.commit()
