import frappe


def execute():
	"""The Seal Alert Log resolution status "Underway" is now "Escalated"."""
	if not frappe.db.has_column("Seal Alert Log", "resolution_status"):
		return

	frappe.db.set_value(
		"Seal Alert Log",
		{"resolution_status": "Underway"},
		"resolution_status",
		"Escalated",
		update_modified=False,
	)
	frappe.db.commit()
