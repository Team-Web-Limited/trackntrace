from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	create_custom_fields(
		{
			"Sales Order": [
				{
					"fieldname": "custom_customer_response",
					"label": "Customer Response",
					"fieldtype": "Select",
					"options": "\nAccepted\nRejected",
					"insert_after": "status",
					"read_only": 1,
					"description": "Set by the customer from the portal's Sales Orders tab (Seal Journeys modal) — accept/reject with remarks.",
				},
				{
					"fieldname": "custom_customer_response_remarks",
					"label": "Customer Response Remarks",
					"fieldtype": "Small Text",
					"insert_after": "custom_customer_response",
					"read_only": 1,
				},
				{
					"fieldname": "custom_customer_response_by",
					"label": "Customer Response By",
					"fieldtype": "Data",
					"insert_after": "custom_customer_response_remarks",
					"read_only": 1,
				},
				{
					"fieldname": "custom_customer_response_date",
					"label": "Customer Response Date",
					"fieldtype": "Datetime",
					"insert_after": "custom_customer_response_by",
					"read_only": 1,
				},
			]
		},
		update=True,
	)
