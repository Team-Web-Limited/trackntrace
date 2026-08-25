import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Companion to reassign_deprecated_billing_rules_to_default.py (must run
# after it): 18 Seal Journey records still carry billing_rule = one of the
# three PCB Scenario rules directly (Apex Transit, BlueRoute, CargoSpan East
# Africa, Delta Haulage, Frontier Gate, HarborBridge, Summit Link — all
# "Pending Billing" / "No Per-Journey Charge", none terminal/Billed).
# set_billing() always re-resolves the rule from the customer's current
# assignment rather than trusting the journey's stored value, so recomputing
# now refreshes billing_rule to the reassigned Default Monthly before
# delete_deprecated_billing_rules.py removes the old rule docs — otherwise
# these 18 would briefly dangle on a Link field pointing at a deleted doc.

_BILLING_FIELDS = (
	"billing_rule",
	"billable_days",
	"first_period_days",
	"first_period_amount",
	"extra_days",
	"extra_day_rate",
	"extra_day_amount",
	"seal_count",
	"per_seal_amount",
	"total_charge",
	"billing_status",
	"extra_billing_rule",
	"extra_billing_seal_count",
	"extra_billing_first_period_amount",
	"extra_billing_extra_days",
	"extra_billing_extra_day_rate",
	"extra_billing_extra_day_amount",
	"extra_billing_amount",
)

STALE_RULE_IDS = ("e20pkdsi1f", "e22mv28124", "e22pmnvnck")


def execute():
	# Operates on document ids hardcoded from the dev database — never runs
	# on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	names = frappe.get_all(
		"Seal Journey",
		filters={"billing_rule": ["in", STALE_RULE_IDS]},
		pluck="name",
	)
	for name in names:
		doc = frappe.get_doc("Seal Journey", name)
		doc.set_billing()
		frappe.db.set_value(
			"Seal Journey",
			name,
			{field: doc.get(field) for field in _BILLING_FIELDS},
			update_modified=False,
		)

	frappe.db.commit()
