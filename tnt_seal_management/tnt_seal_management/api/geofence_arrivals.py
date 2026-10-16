import json
import math

import frappe
from frappe.utils import flt, now_datetime

# Uffizio's own Enter/Out Of Geofence alerts are switched off on purpose, so
# arrival at the destination is worked out here from the GPS fix the seal sync
# already pulls every minute.

_EARTH_KM = 6371.0


def _distance_km(lat1, lng1, lat2, lng2):
	p1, p2 = math.radians(lat1), math.radians(lat2)
	dp, dl = p2 - p1, math.radians(lng2 - lng1)
	a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
	return 2 * _EARTH_KM * math.asin(math.sqrt(a))


def _in_polygon(lat, lng, pts):
	"""Ray casting over [lat, lng] vertices."""
	inside = False
	j = len(pts) - 1
	for i in range(len(pts)):
		yi, xi = pts[i][0], pts[i][1]
		yj, xj = pts[j][0], pts[j][1]
		if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
			inside = not inside
		j = i
	return inside


def point_in_geofence(geofence, lat, lng):
	"""True when (lat, lng) lies inside an Uffizio Geofence row. Coordinates are
	[lat, lng] pairs; a circle's radius is in km and its tolerance in metres."""
	try:
		pts = [(flt(p[0]), flt(p[1])) for p in json.loads(geofence.coordinates or "[]") if len(p) >= 2]
	except (TypeError, ValueError):
		return False
	if not pts:
		return False
	if geofence.shape == "Circle":
		reach = flt(geofence.radius) + flt(geofence.tolerance) / 1000
		return reach > 0 and _distance_km(lat, lng, pts[0][0], pts[0][1]) <= reach
	if geofence.shape == "Rectangle" and len(pts) == 2:
		(a_lat, a_lng), (b_lat, b_lng) = pts
		return min(a_lat, b_lat) <= lat <= max(a_lat, b_lat) and min(a_lng, b_lng) <= lng <= max(a_lng, b_lng)
	if geofence.shape in ("Polygon", "Rectangle") and len(pts) >= 3:
		return _in_polygon(lat, lng, pts)
	return False


def destination_geofence(destination, destination_geofence=None):
	"""The Uffizio Geofence behind a journey's destination: the geofence picked on
	the Journey Request, or for older journeys the one linked to the destination's
	Transport Location."""
	geofence = destination_geofence
	if not geofence and destination:
		geofence = frappe.db.get_value("Transport Location", destination, "uffizio_geofence")
	if not geofence:
		return None
	return frappe.db.get_value(
		"Uffizio Geofence",
		geofence,
		["name", "geofence_name", "shape", "coordinates", "radius", "tolerance"],
		as_dict=True,
	)


def check_destination_entry(journey_name, lat, lng):
	"""Stamp destination_entered_date_time (and an Arrived milestone) the first
	time an In Transit journey's seal is inside its destination geofence, and
	move the journey to Arrived. Returns True when the entry was recorded on this
	call."""
	lat, lng = flt(lat), flt(lng)
	if not journey_name or (not lat and not lng):
		return False
	journey = frappe.db.get_value(
		"Seal Journey",
		journey_name,
		["journey_status", "destination", "destination_geofence", "destination_entered_date_time"],
		as_dict=True,
	)
	if not journey or journey.journey_status != "In Transit" or journey.destination_entered_date_time:
		return False
	geofence = destination_geofence(journey.destination, journey.destination_geofence)
	if not geofence or not point_in_geofence(geofence, lat, lng):
		return False

	entered = now_datetime()
	frappe.db.set_value(
		"Seal Journey", journey_name, "destination_entered_date_time", entered, update_modified=False
	)
	_record_entry_milestone(journey_name, journey.destination, geofence, entered, lat, lng)
	frappe.db.commit()

	# The entry stamp and milestone are already committed; if the status change
	# fails the journey stays In Transit in the Arrivals queue for confirming by hand.
	try:
		_auto_arrive(journey_name, entered, geofence)
		frappe.db.commit()
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(
			f"Auto-arrival failed for {journey_name}: {exc}", "Seal Journey Destination Geofence"
		)
	return True


def _auto_arrive(journey_name, entered, geofence):
	"""Arrival on geofence entry. No unlock method is picked and no untagging or
	seal-return request is raised: the journey stays in the Control Room Arrivals
	until confirm_arrival records how the seal was unlocked."""
	doc = frappe.get_doc("Seal Journey", journey_name)
	if doc.journey_status != "In Transit":
		return
	doc.arrival_date_time = doc.arrival_date_time or entered
	doc.arrival_location = doc.arrival_location or doc.api_device_location or geofence.geofence_name
	doc.journey_status = "Arrived"
	doc.flags.ignore_field_locks = True
	doc.flags.ignore_permissions = True
	doc.save()


def _record_entry_milestone(journey_name, destination, geofence, entered, lat, lng):
	from tnt_seal_management.tnt_seal_management.api.journey_milestones import _renumber

	frappe.get_doc(
		{
			"doctype": "Seal Journey Milestone",
			"parent": journey_name,
			"parenttype": "Seal Journey",
			"parentfield": "milestones",
			"idx": 0,
			"event_time": entered,
			"event_type": "Arrived",
			"place_name": geofence.geofence_name,
			"transport_location": destination if frappe.db.exists("Transport Location", destination) else None,
			"journey_stage": "Destination",
			"uffizio_geofence": geofence.name,
			"latitude": lat,
			"longitude": lng,
			"source_alert_id": f"gps-destination:{journey_name}",
		}
	).db_insert()
	_renumber(journey_name)


def arrival_queue_journey_names():
	"""Journeys that belong in the Control Room Arrivals: those auto-arrived on
	geofence entry that still need an unlock method, In Transit journeys whose
	seal has entered the destination geofence, plus those whose destination has
	no geofence to detect (legacy free-text destinations, or a Transport Location
	not yet linked to Uffizio), which still need confirming by hand."""
	return frappe.db.sql_list(
		"""
		select sj.name
		from `tabSeal Journey` sj
		left join `tabTransport Location` tl on tl.name = sj.destination
		where (
				sj.journey_status = 'In Transit'
				and (
					sj.destination_entered_date_time is not null
					or (ifnull(sj.destination_geofence, '') = '' and ifnull(tl.uffizio_geofence, '') = '')
				)
			)
			or (sj.journey_status = 'Arrived' and ifnull(sj.seal_unlock_method, '') = '')
		"""
	)
