import frappe


def execute():
	"""RECTs tagging assignments whose journey request has finished tagging are
	"Tagging Completed" (new ones are set when tagging completes)."""
	frappe.db.sql(
		"""
		update `tabPCB Assignment` a
		join `tabPCB Job Order` jo on jo.name = a.pcb_job_order
		set a.assignment_status = 'Tagging Completed'
		where a.system = 'RECTs'
			and a.request_type = 'Tagging'
			and a.assignment_status = 'Assigned'
			and exists (
				select 1 from `tabJourney Request` jr
				where jr.job_order = jo.name
					and jr.journey_request_status in ('Journey Ready', 'Completed')
			)
		"""
	)
