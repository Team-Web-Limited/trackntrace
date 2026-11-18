import frappe


def execute():
	"""Copy Consignment Category and Salesperson from each Tagging Booking onto
	its Seal Journeys. Only fills blanks, so it is safe to re-run."""
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey")
	for field in ("consignment_category", "salesperson"):
		frappe.db.sql(
			f"""
			UPDATE `tabSeal Journey` sj
			JOIN `tabTagging Booking` tb ON tb.name = sj.tagging_booking
			SET sj.{field} = tb.{field}
			WHERE IFNULL(tb.{field}, '') != '' AND IFNULL(sj.{field}, '') = ''
			"""
		)
