import frappe


def execute():
	frappe.db.set_value(
		"PCB Job Order",
		{"job_order_status": "Field Technician Assigned"},
		"job_order_status",
		"Team Leader Assigned",
	)
