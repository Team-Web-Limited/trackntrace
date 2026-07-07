import frappe

# Corrects a typo in reassign_deprecated_billing_rules_to_default.py: it
# targeted "sqf2gijhym" (a transcription error) instead of the actual dangling
# rule id "sqf2gijhij", so its ~11.8k Customer Billing Assignment rows were
# never reassigned — that patch's filter matched nothing and silently no-opped.
# Also catches a second, separately-discovered dangling reference
# ("bnt9ae0nf0", KCB Bank Kenya Ltd) that wasn't part of the original count.
# Both ids confirmed absent from Seal Billing Rate via bench console before
# writing this patch. Patches already executed are immutable — this is a new
# patch rather than an edit to the broken one.
STALE_RULE_IDS = ("sqf2gijhij", "bnt9ae0nf0")
DEFAULT_RULE_ID = "nvi5neb62g"


def execute():
	if not frappe.db.exists("Seal Billing Rate", DEFAULT_RULE_ID):
		frappe.throw(f"Expected global default rule {DEFAULT_RULE_ID} not found — aborting reassignment.")

	frappe.db.set_value(
		"Customer Billing Assignment",
		{"billing_rule": ["in", STALE_RULE_IDS]},
		"billing_rule",
		DEFAULT_RULE_ID,
	)
	frappe.db.commit()
