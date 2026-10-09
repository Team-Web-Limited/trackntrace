import re

import frappe
from frappe.utils import cstr

# Uffizio alert_id -> milestone event.
EVENT_BY_ALERT_ID = {"13": "Arrived", "63": "Departed", "21": "Entered", "20": "Exited"}


def _norm(value):
	return re.sub(r"[^a-z0-9]", "", cstr(value).lower())


def _resolve_place(raw):
	"""(place_name, geofence, address_id, transport_location) for one alert.

	Enter/Out Of Geofence (20/21) carry a geofence_id, which resolves through
	Uffizio Geofence to a Transport Location. Reached/Depart Address (13/63) carry
	a different Uffizio concept — an address-book entry — whose id is not in the
	geofence list; those resolve through Uffizio Address (linked by hand to a
	Transport Location), or when the address name equals a Transport Location."""
	geofence = cstr(raw.get("geofence_id")).strip() or None
	if geofence and not frappe.db.exists("Uffizio Geofence", geofence):
		geofence = None
	address_id = cstr(raw.get("address_id")).strip() or None
	place = cstr(raw.get("geofence_name") or raw.get("address_name")).strip()

	location = None
	if geofence:
		rows = frappe.get_all(
			"Transport Location",
			filters={"uffizio_geofence": geofence},
			fields=["name", "location_role"],
		)
		# Prefer the Checkpoint record when a place has both a Checkpoint and a
		# Terminal entry (e.g. "Eldoret" and "Eldoret, Kenya").
		rows.sort(key=lambda r: r.location_role != "Checkpoint")
		location = rows[0].name if rows else None
	elif address_id:
		location = frappe.db.get_value("Uffizio Address", address_id, "transport_location")
	if not location and place and frappe.db.exists("Transport Location", place):
		location = place
	return place, geofence, address_id, location


def _journey_stage(journey, place, location):
	"""'Origin' / 'Destination' when the place is the journey's own, otherwise the
	Transport Location's role (Checkpoint / Terminal), otherwise blank."""
	origin, destination = frappe.db.get_value("Seal Journey", journey, ["origin", "destination"]) or (None, None)
	names = {_norm(place), _norm(location)} - {""}
	for stage, target in (("Origin", origin), ("Destination", destination)):
		t = _norm(target)
		t_head = _norm(cstr(target).split(",")[0])
		if t and (t in names or t_head in names):
			return stage
	if location:
		return frappe.db.get_value("Transport Location", location, "location_role")
	return None


def is_duplicate_milestone(source_alert_id):
	return bool(
		source_alert_id
		and frappe.db.exists("Seal Journey Milestone", {"source_alert_id": source_alert_id})
	)


def record_milestone(journey, rec, source_alert_id, event_time):
	"""Add one milestone to a Seal Journey from a getAlertData record.

	Written straight to the child table (no Seal Journey save), so it triggers no
	journey hooks and doesn't touch the journey's ``modified``. Returns True when a
	row was added, False when skipped (duplicate, unknown event, or the event
	predates this journey)."""
	raw = rec.get("_raw") or rec
	event = EVENT_BY_ALERT_ID.get(cstr(rec.get("alert_id")))
	if not journey or not event or not event_time:
		return False
	if is_duplicate_milestone(source_alert_id):
		return False

	# A device's current journey can already be the next one when a late alert
	# arrives; ignore anything older than this journey's tagging/start.
	ref = frappe.db.get_value("Seal Journey", journey, ["tagging_date_time", "journey_start_date_time", "creation"])
	floor = next((v for v in ref if v), None) if ref else None
	if floor and event_time < floor:
		return False

	place, geofence, address_id, location = _resolve_place(raw)
	if address_id:
		_note_address(address_id, place, event_time, raw)
	idx = (frappe.db.count("Seal Journey Milestone", {"parent": journey, "parenttype": "Seal Journey"}) or 0) + 1
	frappe.get_doc(
		{
			"doctype": "Seal Journey Milestone",
			"parent": journey,
			"parenttype": "Seal Journey",
			"parentfield": "milestones",
			"idx": idx,
			"event_time": event_time,
			"event_type": event,
			"place_name": place or None,
			"transport_location": location,
			"journey_stage": _journey_stage(journey, place, location),
			"uffizio_geofence": geofence,
			"uffizio_address_id": address_id,
			"latitude": raw.get("latitude") or 0,
			"longitude": raw.get("longitude") or 0,
			"source_alert_id": source_alert_id,
		}
	).db_insert()
	_renumber(journey)
	return True


def _renumber(journey):
	"""Keep the grid in time order, whatever order the feed delivered them in."""
	names = frappe.get_all(
		"Seal Journey Milestone",
		filters={"parent": journey, "parenttype": "Seal Journey"},
		order_by="event_time asc, creation asc",
		pluck="name",
	)
	for i, name in enumerate(names, 1):
		frappe.db.set_value("Seal Journey Milestone", name, "idx", i, update_modified=False)


def _note_address(address_id, name, seen_at, raw):
	"""Keep the Uffizio Address staging list current: every address seen in a
	milestone is listed so it can be linked to a Transport Location."""
	values = {
		"last_seen": seen_at,
		"latitude": raw.get("latitude") or 0,
		"longitude": raw.get("longitude") or 0,
	}
	if frappe.db.exists("Uffizio Address", address_id):
		row = frappe.db.get_value("Uffizio Address", address_id, ["event_count", "first_seen", "last_seen"], as_dict=True)
		values["event_count"] = (row.event_count or 0) + 1
		if row.first_seen and row.first_seen <= seen_at:
			values.pop("first_seen", None)
		else:
			values["first_seen"] = seen_at
		if row.last_seen and row.last_seen > seen_at:
			values["last_seen"] = row.last_seen
		frappe.db.set_value("Uffizio Address", address_id, values, update_modified=False)
		return
	frappe.get_doc(
		{
			"doctype": "Uffizio Address",
			"address_id": address_id,
			"address_name": name or address_id,
			"event_count": 1,
			"first_seen": seen_at,
			**values,
		}
	).insert(ignore_permissions=True)


def backfill_milestones_for_address(address_id, transport_location):
	"""Apply an address's Transport Location to the milestones already recorded
	for it (and clear it again if the link is removed)."""
	rows = frappe.get_all(
		"Seal Journey Milestone",
		filters={"uffizio_address_id": address_id},
		fields=["name", "parent", "place_name"],
	)
	for r in rows:
		frappe.db.set_value(
			"Seal Journey Milestone",
			r.name,
			{
				"transport_location": transport_location,
				"journey_stage": _journey_stage(r.parent, r.place_name, transport_location),
			},
			update_modified=False,
		)
