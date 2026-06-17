import frappe

from tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order import (
	_ensure_assignment,
)


def execute():
	job_order_names = frappe.get_all(
		"PCB Job Order",
		filters={"job_order_status": "Completed"},
		pluck="name",
	)
	for job_order_name in job_order_names:
		job_order = frappe.get_doc("PCB Job Order", job_order_name)
		_ensure_assignment(job_order)
		job_order.save(ignore_permissions=True)
