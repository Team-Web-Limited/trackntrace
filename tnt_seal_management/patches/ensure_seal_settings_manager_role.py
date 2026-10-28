import frappe


def execute():
	if not frappe.db.exists("Role", "Seal Settings Manager"):
		frappe.get_doc({"doctype": "Role", "role_name": "Seal Settings Manager"}).insert(ignore_permissions=True)
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_api_settings")
