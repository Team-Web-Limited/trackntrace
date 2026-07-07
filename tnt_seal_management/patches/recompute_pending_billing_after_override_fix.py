import frappe

# billing.apply_billing_overrides / current_customers.get_customer_billing both
# checked override_first_period_amount with `not in (None, "")` — but it's a
# Currency field (Frappe hard-codes Currency/Float/Percent columns as NOT NULL
# DEFAULT 0), so it can never truly be empty once a Customer Billing Assignment
# exists. Nearly every assignment sits at its untouched default of 0.0, so that
# check was always true and silently zeroed first_period_amount for almost
# every Subscription customer. Billed journeys are settled and left as-is (same
# rule as recompute_pending_seal_journey_billing); any journey still open
# (Pending Billing) may be holding a zeroed total from before the fix and needs
# recomputing so it reflects the correct rate immediately.

# Fields written back after re-running the billing computation — same list as
# recompute_pending_seal_journey_billing.py, plus the Extra Billing (Scenario
# 6) line added since that patch was written.
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


def execute():
	names = frappe.get_all(
		"Seal Journey",
		filters={"billing_status": "Pending Billing"},
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
