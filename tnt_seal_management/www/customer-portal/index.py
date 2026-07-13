import frappe


no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/customer-portal"
		raise frappe.Redirect
	if (
		frappe.db.get_value("User", frappe.session.user, "user_type") != "Website User"
		or "Customer" not in set(frappe.get_roles())
	):
		frappe.throw("Customer portal access is required.", frappe.PermissionError)

	context.no_cache = 1
	context.title = "Customer Portal"
	return context
