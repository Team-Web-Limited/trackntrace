import frappe


def execute():
	if frappe.db.exists("Role", "Team Lead Technician") and not frappe.db.exists(
		"Role", "PCB Team Leader"
	):
		frappe.rename_doc("Role", "Team Lead Technician", "PCB Team Leader", force=True)
