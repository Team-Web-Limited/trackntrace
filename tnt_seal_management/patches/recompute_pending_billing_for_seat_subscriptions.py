import frappe

# Seal Journey.set_billing now zeroes the per-journey base charge for any
# customer with a recurring Seal Lease Fee / Seal Ownership Service Fee
# Subscription (see seal_lease_billing.customer_has_seat_subscription) —
# their base is billed on the recurring cycle instead, and
# billing_status becomes "No Per-Journey Charge". Any journey still open
# (Pending Billing) for such a customer needs recomputing so it reflects
# this immediately, rather than waiting for its next incidental save. This
# also corrects the double-billing introduced by an earlier ad hoc backfill
# (some dev customers were assigned a normal per-journey rule on top of an
# already-active recurring lease subscription).

# Same field list as recompute_pending_billing_after_override_fix.py.
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
		filters={"billing_status": ["in", ("Pending Billing", "No Per-Journey Charge")]},
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
