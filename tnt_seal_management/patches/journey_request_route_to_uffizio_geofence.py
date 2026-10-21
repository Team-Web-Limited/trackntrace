import frappe


def execute():
	"""Journey Request origin/destination moved from Transport Location to Uffizio
	Geofence. Convert each stored Transport Location to its linked geofence (blank
	when it has none), and record the geofences on the Seal Journeys that copied
	them so arrival detection keeps working."""
	if not frappe.db.table_exists("Journey Request") or not frappe.db.table_exists("Transport Location"):
		return
	# Transport Location's geofence link was later removed; nothing to convert
	# on a site created after that.
	if not frappe.db.has_column("Transport Location", "uffizio_geofence"):
		return

	geofence_of = dict(
		frappe.get_all(
			"Transport Location",
			filters={"uffizio_geofence": ["is", "set"]},
			fields=["name", "uffizio_geofence"],
			as_list=True,
		)
	)
	locations = set(frappe.get_all("Transport Location", pluck="name"))

	for row in frappe.get_all(
		"Journey Request", fields=["name", "origin", "destination"], filters={"docstatus": ["<", 2]}
	):
		values = {}
		for field in ("origin", "destination"):
			current = row.get(field)
			if not current or current not in locations:  # blank, or already a geofence
				continue
			values[field] = geofence_of.get(current)
		if values:
			frappe.db.set_value("Journey Request", row.name, values, update_modified=False)

	for row in frappe.get_all(
		"Seal Journey", fields=["name", "origin", "destination"], filters={"journey_request": ["is", "set"]}
	):
		values = {
			"origin_geofence": geofence_of.get(row.origin),
			"destination_geofence": geofence_of.get(row.destination),
		}
		frappe.db.set_value("Seal Journey", row.name, values, update_modified=False)
