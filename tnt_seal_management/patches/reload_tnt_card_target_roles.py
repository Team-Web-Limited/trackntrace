import frappe


TARGET_PAGES = (
	"tagging_booking_list",
	"journey_request_list",
	"pcb_job_order_list",
	"assignment_list",
	"current_customer_list",
	"vehicle_list",
	"seal_device_dashboard",
	"seal_tracking_dashboard",
)


def execute():
	for page_name in TARGET_PAGES:
		frappe.reload_doc(
			"tnt_seal_management",
			"page",
			page_name,
			force=True,
		)
