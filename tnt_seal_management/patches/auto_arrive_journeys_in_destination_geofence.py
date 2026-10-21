import frappe

from tnt_seal_management.tnt_seal_management.api.geofence_arrivals import (
	_auto_arrive,
	destination_geofence,
)


def execute():
	"""Journeys whose seal entered the destination geofence before auto-arrival
	existed are still In Transit; arrive them as of their entry time."""
	rows = frappe.get_all(
		"Seal Journey",
		filters={"journey_status": "In Transit", "destination_entered_date_time": ["is", "set"]},
		fields=["name", "destination", "destination_geofence", "destination_entered_date_time"],
	)
	for r in rows:
		geofence = destination_geofence(r.destination_geofence) or frappe._dict(geofence_name=None)
		try:
			_auto_arrive(r.name, r.destination_entered_date_time, geofence)
		except Exception:
			frappe.log_error(title=f"Auto-arrive patch failed for {r.name}", message=frappe.get_traceback())
