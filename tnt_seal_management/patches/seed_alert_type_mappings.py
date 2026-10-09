import json

import frappe

# (uffizio alert_id, name, shared category, level, match_text, ignore, journey_only).
# Categories match the
# locally-derived alerts (Security / Connectivity / Battery) so both sources
# merge into the same incident. Ids/names come from the getAlertData feed.
MAPPINGS = [
	("168", "ELock Steel String Cut", "Security", "Critical", "", 0, 0),
	("172", "ELock Open Back Cap", "Security", "Critical", "", 0, 0),
	# 169 carries both lock and unlock events. Only an unlock while the seal is on a
	# journey is an alert; a lock (or an unlock at a warehouse) is routine.
	("169", "ELock Status - Unlock", "Security", "Critical", "status unlock", 0, 1),
	("169", "ELock Status - Lock", "Security", "Info", "status lock", 1, 0),
	("195", "Off Route", "Route", "Warning", "", 0, 0),
	("20", "Out Of Geofence", "Geofence", "Info", "", 0, 0),
	("21", "Enter In Geofence", "Geofence", "Info", "", 0, 0),
	("13", "Reached Address", "Geofence", "Info", "", 0, 0),
	("63", "Depart From Address", "Geofence", "Info", "", 0, 0),
	("16", "OverStay", "Operational", "Info", "", 0, 0),
	("117", "RFID", "Operational", "Info", "", 0, 0),
	("1", "Over Speed", "Operational", "Warning", "", 0, 0),
	("210", "GSM Signal Loss", "Connectivity", "Warning", "", 0, 0),
	("8", "GPS", "Connectivity", "Warning", "", 0, 0),
	("25", "InActive", "Connectivity", "Warning", "", 0, 0),
	("99", "Low Battery", "Battery", "Warning", "", 0, 0),
]


def execute():
	"""Seed Alert Type Mapping and re-label existing Uffizio alerts (stored with
	their raw type name as alert_type) with the shared category."""
	frappe.reload_doc("tnt_seal_management", "doctype", "alert_type_mapping")
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_alert_occurrence")
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_alert_log")

	# An earlier draft keyed one row per alert_id (named after the id); drop the
	# unsplit 169 so the lock/unlock rows below replace it.
	for stale in frappe.get_all(
		"Alert Type Mapping", filters={"alert_id": "169", "match_text": ["in", ["", None]]}, pluck="name"
	):
		frappe.delete_doc("Alert Type Mapping", stale, ignore_permissions=True, force=True)

	for alert_id, name, category, level, match_text, ignore, journey_only in MAPPINGS:
		# match_text is stored as NULL when blank, so compare through ifnull.
		if frappe.db.sql(
			"select name from `tabAlert Type Mapping` where alert_id = %s and ifnull(match_text, '') = %s",
			(alert_id, match_text),
		):
			continue
		frappe.get_doc(
			{
				"doctype": "Alert Type Mapping",
				"alert_id": alert_id,
				"match_text": match_text,
				"uffizio_name": name,
				"category": category,
				"level": level,
				"ignore": ignore,
				"journey_only": journey_only,
			}
		).insert(ignore_permissions=True)

	by_id = {m[0]: m for m in MAPPINGS if not m[4]}
	rows = frappe.get_all(
		"Seal Alert Log",
		filters={"alert_source": "Uffizio", "source_alert_type": ["is", "not set"]},
		fields=["name", "alert_type", "raw_data"],
	)
	for row in rows:
		values = {"source_alert_type": row.alert_type}
		try:
			alert_id = str(json.loads(row.raw_data or "{}").get("alert_id") or "")
		except ValueError:
			alert_id = ""
		values["uffizio_alert_id"] = alert_id or None
		if alert_id in by_id:
			values["alert_type"] = by_id[alert_id][2]
			values["level"] = by_id[alert_id][3]
		frappe.db.set_value("Seal Alert Log", row.name, values, update_modified=False)
