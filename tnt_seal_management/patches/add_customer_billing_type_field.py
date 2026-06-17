import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	create_custom_fields(
		{
			"Customer": [
				{
					"fieldname": "custom_billing_type",
					"label": "Billing Type",
					"fieldtype": "Link",
					"options": "Seal Billing Rate",
					"insert_after": "customer_group",
				}
			]
		},
		update=True,
	)
	frappe.clear_cache(doctype="Customer")
