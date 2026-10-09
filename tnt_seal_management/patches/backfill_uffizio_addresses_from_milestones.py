import frappe


def execute():
	"""List every Uffizio address already seen in journey milestones, so they can
	be linked to Transport Locations."""
	frappe.reload_doc("tnt_seal_management", "doctype", "uffizio_address")
	rows = frappe.db.sql(
		"""select uffizio_address_id, max(place_name), count(*), min(event_time), max(event_time)
		from `tabSeal Journey Milestone`
		where ifnull(uffizio_address_id, '') != ''
		group by uffizio_address_id""",
	)
	for address_id, name, count, first, last in rows:
		if frappe.db.exists("Uffizio Address", address_id):
			continue
		frappe.get_doc(
			{
				"doctype": "Uffizio Address",
				"address_id": address_id,
				"address_name": name or address_id,
				"event_count": count,
				"first_seen": first,
				"last_seen": last,
			}
		).insert(ignore_permissions=True)
