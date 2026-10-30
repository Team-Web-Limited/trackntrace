import frappe


def execute():
	"""RECTs no longer has a Control Room approval: requests still waiting for one go to Tagging."""
	for name in frappe.get_all(
		"Journey Request",
		filters={"system": "RECTs", "journey_request_status": "Pending Control Room Approval"},
		pluck="name",
	):
		frappe.db.set_value("Journey Request", name, "journey_request_status", "Tagging", update_modified=False)
		frappe.db.sql(
			"update `tabJourney Request Vehicle` set status = 'Tagging' where parent = %s and status = 'Pending Control Room Approval'",
			name,
		)
		journey = frappe.db.get_value("Journey Request", name, "journey_reference")
		if journey:
			frappe.db.set_value("Seal Journey", journey, "journey_status", "Tagging In Progress", update_modified=False)
