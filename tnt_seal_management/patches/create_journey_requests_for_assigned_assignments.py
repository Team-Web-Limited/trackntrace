import frappe

from tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment import (
	_ensure_journey_request,
)


def execute():
	for assignment_name in frappe.get_all(
		"PCB Assignment",
		filters={"assignment_status": "Assigned"},
		pluck="name",
	):
		assignment = frappe.get_doc("PCB Assignment", assignment_name)
		_ensure_journey_request(assignment)
