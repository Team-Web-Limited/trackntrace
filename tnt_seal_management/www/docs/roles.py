import frappe

no_cache = 1

def get_context(context):
	if frappe.session.user == "Guest" and not frappe.flags.in_pdf_generation:
		frappe.local.flags.redirect_location = "/login?redirect-to=/docs/roles"
		raise frappe.Redirect

	context.no_cache = 1
	context.title = "Role-Based Manuals"
	context.full_width = True
	return context
