import frappe


def execute():
	"""RECTs Journey Requests now show Origin / Destination as text
	(origin_location / destination_location). Fill them from the geofence for
	requests that only have the geofence link."""
	frappe.reload_doc("tnt_seal_management", "doctype", "journey_request")
	for link, text in (("origin", "origin_location"), ("destination", "destination_location")):
		frappe.db.sql(
			f"""update `tabJourney Request` jr
			join `tabUffizio Geofence` g on g.name = jr.`{link}`
			set jr.`{text}` = coalesce(nullif(g.geofence_name, ''), g.name)
			where jr.system = 'RECTs' and ifnull(jr.`{text}`, '') = ''"""
		)
