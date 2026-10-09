import json

import frappe
from frappe.utils import get_datetime

MILESTONE_ALERT_IDS = ("13", "20", "21", "63")


def execute():
	"""Arrived / departed / entered / exited events are journey milestones, not
	alerts. Flag their mappings, then move any Geofence "alerts" already stored
	onto their Seal Journey as milestones and drop the alert rows."""
	frappe.reload_doc("tnt_seal_management", "doctype", "alert_type_mapping")
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey_milestone")
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey")

	for name in frappe.get_all("Alert Type Mapping", filters={"alert_id": ["in", MILESTONE_ALERT_IDS]}, pluck="name"):
		frappe.db.set_value("Alert Type Mapping", name, "as_milestone", 1)

	from tnt_seal_management.tnt_seal_management.api.journey_milestones import record_milestone

	rows = frappe.get_all(
		"Seal Alert Log",
		filters={"alert_source": "Uffizio", "uffizio_alert_id": ["in", MILESTONE_ALERT_IDS]},
		fields=["name", "seal_journey", "uffizio_alert_id", "raw_data", "source_alert_id", "occurred_at"],
	)
	for row in rows:
		try:
			raw = json.loads(row.raw_data or "{}")
		except ValueError:
			raw = {}
		if row.seal_journey and raw:
			record_milestone(
				row.seal_journey,
				{"alert_id": row.uffizio_alert_id, "_raw": raw},
				row.source_alert_id,
				get_datetime(row.occurred_at),
			)
		frappe.delete_doc("Seal Alert Log", row.name, ignore_permissions=True, force=True)
