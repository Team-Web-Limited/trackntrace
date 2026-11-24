"""Customer.disabled is no longer a "billing pending approval" gate.

The old gate disabled a customer whenever their billing was set and only
re-enabled them on a fresh Pending -> Approved approval. So customers were left
disabled while their billing was pending or rejected, and also after it was
approved by any other route. This re-enables every disabled customer who has
billing set up (an active billing assignment) — the ones the gate could have
caught — so they list in Tagging Booking again. Billing is now enforced when
Finance approves the booking. A disabled customer with no billing assignment was
never touched by the gate and is left alone.
"""

import frappe


def execute():
	assigned = set(
		frappe.get_all(
			"Customer Billing Assignment",
			filters={"assignment_type": "Customer", "active": 1},
			pluck="customer",
		)
	)
	for customer in frappe.get_all("Customer", filters={"disabled": 1}, pluck="name"):
		if customer in assigned:
			frappe.db.set_value("Customer", customer, "disabled", 0)
