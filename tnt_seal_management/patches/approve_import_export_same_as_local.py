import frappe

from tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate import (
	_reenable_customers_pending_on_rule,
	approve_matching_import_export,
)


def execute():
	"""Import/Export rates no longer need approval when their terms match the
	approved Local rate: approve the ones already waiting, and re-enable their
	customers if nothing else is pending."""
	frappe.set_user("Administrator")
	names = {
		frappe.db.get_value("Seal Billing Rate", n, "billing_rule_name")
		for n in frappe.get_all(
			"Seal Billing Rate",
			filters={"journey_type": "Import/Export", "approval_status": ["!=", "Approved"], "active": 1},
			pluck="name",
		)
	}
	for local in frappe.get_all(
		"Seal Billing Rate",
		filters={"billing_rule_name": ["in", list(names) or [""]], "approval_status": "Approved", "active": 1},
		fields=["name", "journey_type"],
	):
		if (local.journey_type or "Local") != "Local":
			continue
		if approve_matching_import_export(frappe.get_doc("Seal Billing Rate", local.name)):
			_reenable_customers_pending_on_rule(local.name)
