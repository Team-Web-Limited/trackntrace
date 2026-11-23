import frappe


def execute():
	"""Office staff who fill in and finish RECTs journey requests for the Tag
	Operator, from the details the operator sends over Slack / WhatsApp."""
	if frappe.db.exists("Role", "RECTs Data Entry"):
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": "RECTs Data Entry",
			"desk_access": 1,
		}
	).insert(ignore_permissions=True)
