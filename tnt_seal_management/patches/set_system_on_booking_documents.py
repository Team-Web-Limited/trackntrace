import frappe


def execute():
	"""Copy System from the Tagging Booking onto the documents already created from
	it (new ones get it via fetch_from). Everything else keeps the PCB default."""
	for doctype in ("PCB Job Order", "Seal Journey", "PCB Assignment"):
		if not frappe.db.has_column(doctype, "system"):
			continue
		frappe.db.sql(
			f"""
			update `tab{doctype}` d
			join `tabTagging Booking` b on b.name = d.tagging_booking
			set d.system = b.system
			"""
		)

	# Untagging / seal return assignments have no booking: they follow their journey.
	if frappe.db.has_column("PCB Assignment", "system"):
		frappe.db.sql(
			"""
			update `tabPCB Assignment` a
			join `tabSeal Journey` j on j.name = a.seal_journey
			set a.system = j.system
			"""
		)

	if frappe.db.has_column("Journey Request", "system"):
		frappe.db.sql(
			"""
			update `tabJourney Request` r
			join `tabPCB Job Order` j on j.name = r.job_order
			set r.system = j.system
			"""
		)
