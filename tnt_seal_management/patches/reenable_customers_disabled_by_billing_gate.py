"""Customer.disabled is no longer a "billing pending approval" gate.

Customers disabled only because their billing rule was awaiting Finance approval
(or were left disabled after it was approved) are re-enabled so they list in
Tagging Booking. Billing is now enforced when Finance approves the booking.
Only customers with an active billing assignment are touched.
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
