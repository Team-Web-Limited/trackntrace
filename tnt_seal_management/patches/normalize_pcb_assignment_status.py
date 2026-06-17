import frappe


def execute():
	for assignment in frappe.get_all(
		"PCB Assignment",
		filters={"assignment_status": ["in", ("In Progress", "Completed")]},
		fields=["name", "assigned_field_technician"],
	):
		new_status = "Assigned" if assignment.assigned_field_technician else "Pending"
		frappe.db.set_value(
			"PCB Assignment",
			assignment.name,
			"assignment_status",
			new_status,
			update_modified=False,
		)
