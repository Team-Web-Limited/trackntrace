import frappe


def execute():
	"""Copy each journey's Tagging Booking location into the new Booking Location
	field. Origin is left as it is: older journeys still hold the booking text
	there, newer ones get it from the Journey Request."""
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey")
	frappe.db.sql(
		"""update `tabSeal Journey` sj
		join `tabTagging Booking` tb on tb.name = sj.tagging_booking
		set sj.booking_location = tb.location
		where ifnull(sj.booking_location, '') = '' and ifnull(tb.location, '') != ''"""
	)
