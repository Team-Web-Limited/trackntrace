import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# Corrects two data mismatches found while verifying the Set Billing modal
# against real customer data (see bench console investigation):
#
# 1. Rift Valley Movers Ltd / Savanna Express Logistics Ltd each carry a real
#    Seal Ownership Service Fee subscription (5 seats), but their primary
#    Customer Billing Assignment still has outright_purchase=0 — a leftover
#    from an earlier ad hoc "Default Monthly" backfill that didn't pass
#    outright_purchase (defaulted to 0). The modal's Number of Seals Owned /
#    Rate per Seal (Owned) fields only render when outright_purchase is
#    checked, so the real data was invisible/uneditable in the UI even though
#    billing itself was already correct (customer_has_seat_subscription
#    doesn't care about this flag). Flips outright_purchase on, sets
#    owned_seal_count to match the subscription's qty.
#
# 2. Lakeside Cargo Partners Ltd / Northgate Transit Solutions Ltd each carry
#    BOTH a Seal Lease Fee AND a stray Seal Ownership Service Fee line (test
#    debris — confirmed with the user these two are leased-only, Scenario 4).
#    The modal can only show one side of the owned/leased toggle at a time, so
#    the stray ownership row was invisible in the UI too. Removes that plan
#    row (and its now-unused Subscription Plan doc) from their Subscription,
#    leaving the real Lease Fee line untouched.
OWNERSHIP_ITEM = "Seal Ownership Service Fee"

OUTRIGHT_FIX_CUSTOMERS = ("Rift Valley Movers Ltd", "Savanna Express Logistics Ltd")
STRAY_OWNERSHIP_CUSTOMERS = ("Lakeside Cargo Partners Ltd", "Northgate Transit Solutions Ltd")


def execute():
	# Operates on document ids hardcoded from the dev database — never runs
	# on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	for customer in OUTRIGHT_FIX_CUSTOMERS:
		sub_name = frappe.db.get_value("Subscription", {"party": customer, "status": ["!=", "Cancelled"]}, "name")
		if not sub_name:
			continue
		qty = frappe.db.sql(
			"""
			select spd.qty from `tabSubscription Plan Detail` spd
			join `tabSubscription Plan` sp on sp.name = spd.plan
			where spd.parent = %s and sp.item = %s
			""",
			(sub_name, OWNERSHIP_ITEM),
		)
		if not qty:
			continue
		assignment = frappe.db.get_value(
			"Customer Billing Assignment",
			{"customer": customer, "is_extra_billing": 0, "active": 1},
			"name",
		)
		if not assignment:
			continue
		frappe.db.set_value(
			"Customer Billing Assignment", assignment,
			{"outright_purchase": 1, "owned_seal_count": qty[0][0]},
		)

	for customer in STRAY_OWNERSHIP_CUSTOMERS:
		sub_name = frappe.db.get_value("Subscription", {"party": customer, "status": ["!=", "Cancelled"]}, "name")
		if not sub_name:
			continue
		sub = frappe.get_doc("Subscription", sub_name)
		stray_plans = [
			row.plan for row in sub.plans
			if frappe.db.get_value("Subscription Plan", row.plan, "item") == OWNERSHIP_ITEM
		]
		if not stray_plans:
			continue
		sub.plans = [
			row for row in sub.plans
			if frappe.db.get_value("Subscription Plan", row.plan, "item") != OWNERSHIP_ITEM
		]
		sub.save(ignore_permissions=True)
		for plan_name in stray_plans:
			frappe.delete_doc("Subscription Plan", plan_name, ignore_permissions=True)

	frappe.db.commit()
