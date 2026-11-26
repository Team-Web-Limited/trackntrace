"""Show Vehicle Registration No as a column in the Sales Order's Installation
Location table. Generated orders put each journey's vehicle there beside the
seal IMEI, but the column was only visible after opening the row."""

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter


def execute():
	if not frappe.db.exists("DocType", "Installation Location"):
		return
	if not frappe.get_meta("Installation Location").get_field("vehicle_registration_no"):
		return
	make_property_setter(
		"Installation Location",
		"vehicle_registration_no",
		"in_list_view",
		1,
		"Check",
		validate_fields_for_doctype=False,
	)
