import frappe


def execute():
	for job_order_name in frappe.get_all("PCB Job Order", pluck="name"):
		job_order = frappe.get_doc("PCB Job Order", job_order_name)
		assignment_name = job_order.assignment_reference or frappe.db.get_value(
			"PCB Assignment",
			{"pcb_job_order": job_order.name},
			"name",
		)

		if not assignment_name:
			continue

		if job_order.assignment_reference != assignment_name:
			frappe.db.set_value(
				"PCB Job Order",
				job_order.name,
				"assignment_reference",
				assignment_name,
				update_modified=False,
			)

		assignment = frappe.get_doc("PCB Assignment", assignment_name)
		assignment.update(
			{
				"pcb_job_order": job_order.name,
				"tagging_booking": job_order.tagging_booking,
				"client_name": job_order.client_name,
				"location": job_order.location,
				"scheduled_date_time": job_order.scheduled_date_time,
				"contact_person_name": job_order.contact_person_name,
				"contact_person_phone": job_order.contact_person_phone,
				"pcb_team_leader": job_order.assigned_pcb_team_leader,
			}
		)
		assignment.save(ignore_permissions=True)
