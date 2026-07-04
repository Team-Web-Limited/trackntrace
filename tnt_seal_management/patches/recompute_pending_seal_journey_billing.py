import frappe

# Billing moved from per-journey to per-seal: the charge for a journey is now the
# per-seal amount multiplied by the number of seals on the journey. Journeys that
# were already computed under the old per-journey model still hold single-seal
# totals until their next save. Recompute every journey that is still open
# (Pending Billing) so the new totals — plus the new seal_count / per_seal_amount
# fields — take effect immediately. Billed journeys are settled and left as-is.

# Fields written back after re-running the billing computation.
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
