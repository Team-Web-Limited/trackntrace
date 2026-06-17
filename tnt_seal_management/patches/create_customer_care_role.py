import frappe


def execute():
	if frappe.db.exists("Role", "Customer Care"):
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": "Customer Care",
			"desk_access": 1,
		}
	).insert(ignore_permissions=True)
