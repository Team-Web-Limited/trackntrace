"""One-time fix for customers left disabled despite fully-Approved billing.

Customer.disabled doubles as a "billing pending approval" gate (see
seal_billing_rate._reenable_customers_pending_on_rule), but
current_customers.py used to set disabled=1 unconditionally on every billing
save, even when the assigned rule was already Approved and nothing was
actually pending. Since disabled=0 is only restored on a fresh Pending ->
Approved transition, any customer re-saved after their rule was already
approved was left disabled with no future event to ever re-enable them
(see _gate_customer_on_rule_approval, which replaces the unconditional write).

This re-checks every currently-disabled customer against their real standing
and re-enables the ones who are, in fact, fully approved.
"""

import frappe


def execute():
	from tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate import (
		_customer_billing_fully_approved,
	)

	disabled_customers = frappe.get_all("Customer", filters={"disabled": 1}, pluck="name")
	for customer in disabled_customers:
		if _customer_billing_fully_approved(customer):
			frappe.db.set_value("Customer", customer, "disabled", 0)
