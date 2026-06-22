# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import math

import frappe
from frappe.model.document import Document

EARTH_RADIUS_METERS = 6371000


class CustodyPoint(Document):
	pass


def haversine_meters(lat1, lon1, lat2, lon2):
	"""Great-circle distance between two lat/lon points, in meters."""
	phi1, phi2 = math.radians(lat1), math.radians(lat2)
	d_phi = math.radians(lat2 - lat1)
	d_lambda = math.radians(lon2 - lon1)
	a = (
		math.sin(d_phi / 2) ** 2
		+ math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
	)
	return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(a))


@frappe.whitelist()
def find_nearest_custody_point(latitude, longitude):
	"""
	Return the nearest active Custody Point (physical warehouse) to the given
	coordinates, if it falls within that point's geofence radius.
	Used to reconcile a Seal Device's last-known Uffizio GPS reading against
	known warehouse/yard locations.
	"""
	latitude, longitude = float(latitude), float(longitude)

	points = frappe.db.get_all(
		"Custody Point",
		filters={"active": 1},
		fields=["name", "latitude", "longitude", "geofence_radius_meters"],
	)

	best = None
	best_distance = None
	for point in points:
		if point.latitude is None or point.longitude is None:
			continue
		distance = haversine_meters(latitude, longitude, point.latitude, point.longitude)
		if distance <= (point.geofence_radius_meters or 300):
			if best_distance is None or distance < best_distance:
				best, best_distance = point, distance

	if not best:
		return None

	return {
		"custody_point": best.name,
		"distance_meters": round(best_distance, 1),
	}
