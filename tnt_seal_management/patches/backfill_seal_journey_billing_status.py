import frappe


def execute():
	rows = frappe.get_all("Seal Journey", pluck="name")
	for name in rows:
		doc = frappe.get_doc("Seal Journey", name)
		doc.set_billing()
		frappe.db.set_value(
			"Seal Journey",
			doc.name,
			{
				"billing_rule": doc.billing_rule,
				"billing_status": doc.billing_status,
				"billing_start_date": doc.billing_start_date,
				"billing_return_date": doc.billing_return_date,
				"billable_days": doc.billable_days,
				"first_period_days": doc.first_period_days,
				"first_period_amount": doc.first_period_amount,
				"extra_days": doc.extra_days,
				"extra_day_rate": doc.extra_day_rate,
				"extra_day_amount": doc.extra_day_amount,
				"total_charge": doc.total_charge,
			},
			update_modified=False,
		)

	frappe.db.commit()
