"""Adds the IMEI Number column to the Sales Order's Installation Location table, so
each vehicle line can show the IMEI of the seal attached at tagging."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	if not frappe.db.exists("DocType", "Installation Location"):
		return
	create_custom_fields(
		{
			"Installation Location": [
				{
					"fieldname": "custom_imei_number",
					"fieldtype": "Data",
					"label": "IMEI Number",
					"insert_after": "vehicle_registration_no",
					"in_list_view": 1,
				}
			]
		}
	)
