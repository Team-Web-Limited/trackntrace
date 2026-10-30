import frappe


def execute():
	for fieldname in ("custom_seal_latitude", "custom_seal_longitude", "custom_seal_geofence_radius"):
		frappe.delete_doc("Custom Field", f"Warehouse-{fieldname}", ignore_missing=True, force=True)
