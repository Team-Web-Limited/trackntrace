import frappe

from tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking import (
	_get_or_create_pcb_job_order,
)


def execute():
	approved_bookings = frappe.get_all(
		"Tagging Booking",
		filters={"booking_status": "Finance PCB Approved"},
		pluck="name",
	)

	for booking_name in approved_bookings:
		booking = frappe.get_doc("Tagging Booking", booking_name)
		job_order = _get_or_create_pcb_job_order(booking)
		if booking.pcb_job_order_reference != job_order.name:
			frappe.db.set_value(
				"Tagging Booking",
				booking.name,
				"pcb_job_order_reference",
				job_order.name,
				update_modified=False,
			)
