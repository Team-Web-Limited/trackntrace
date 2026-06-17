import frappe


def execute():
	if frappe.db.exists("Role", "Account Manager"):
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": "Account Manager",
			"desk_access": 1,
		}
	).insert(ignore_permissions=True)
