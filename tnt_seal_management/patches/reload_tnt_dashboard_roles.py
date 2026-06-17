import frappe


def execute():
	frappe.reload_doc(
		"tnt_seal_management",
		"page",
		"tnt_seal_management",
		force=True,
	)
