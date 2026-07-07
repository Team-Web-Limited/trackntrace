import frappe


no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/docs"
		raise frappe.Redirect

	context.no_cache = 1
	context.title = "Documentation"
	context.full_width = True
	return context
