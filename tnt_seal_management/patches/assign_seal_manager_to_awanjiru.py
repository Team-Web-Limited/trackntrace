import frappe


def execute():
	"""Seal Manager (the only role that may transfer RECTs seals) goes to Agnes."""
	user = "awanjiru@trackntrace.co.ke"
	if not frappe.db.exists("User", user):
		return
	doc = frappe.get_doc("User", user)
	if "Seal Manager" not in [r.role for r in doc.roles]:
		doc.append("roles", {"role": "Seal Manager"})
		doc.save(ignore_permissions=True)
