import frappe


def execute():
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey")

	rows = frappe.db.get_all(
		"Seal Journey",
		fields=["name", "customer_care_approval_date_time", "departure_confirmation"],
		filters={"customer_care_approval_date_time": ["is", "set"]},
	)

	for row in rows:
		if int(row.departure_confirmation or 0) == 1:
			continue
		frappe.db.set_value(
			"Seal Journey",
			row.name,
			"departure_confirmation",
			1,
			update_modified=False,
		)

	frappe.db.commit()
