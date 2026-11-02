import frappe


def execute():
	if frappe.db.exists("Role", "Seal Manager"):
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": "Seal Manager",
			"desk_access": 1,
		}
	).insert(ignore_permissions=True)
