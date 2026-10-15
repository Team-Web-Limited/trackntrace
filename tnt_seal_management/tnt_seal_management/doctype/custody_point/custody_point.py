# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import math

import frappe
from frappe.utils import cint
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


# Warehouses page filters. The first four filter Custody Points; "User" and
# "Customer" list whoever currently holds seals outside a warehouse.
_CUSTODY_POINT_STATUSES = {
	"Active": {"active": 1},
	"Inactive": {"active": 0},
	"Main": {"is_main_warehouse": 1},
}
_HOLDER_STATUSES = ("User", "Customer")


@frappe.whitelist()
def get_warehouse_list(search=None, status="All", page=1, page_length=25):
	"""Everyone currently holding seals, for the Warehouses page: Custody Points
	(always listed, with their seal count) plus the Users and Customers that
	seals are in the custody of right now. The holders come straight from each
	Seal Device's current custody, so they appear and drop off as seals move.
	``status`` is All / Active / Inactive / Main / User / Customer; ``summary``
	counts every status regardless of the search. Honours permissions via
	get_list."""
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length) or 25, 1), 100)
	search = (search or "").strip().lower()

	held = _seals_held_by_custodian()
	points = [
		_custody_point_row(p, held.get(("Custody Point", p.name), 0))
		for p in frappe.get_list(
			"Custody Point",
			fields=[
				"name", "custody_point_name", "region", "is_main_warehouse", "active",
				"address_line", "latitude", "longitude", "geofence_radius_meters",
			],
			order_by="is_main_warehouse desc, active desc, custody_point_name asc",
			limit_page_length=0,
		)
	]
	holders = _holder_rows(held)

	def in_status(row, key):
		if key == "All":
			return True
		if key in _HOLDER_STATUSES:
			return row["holder_type"] == key
		if row["holder_type"] != "Custody Point":
			return False
		return all(cint(row.get(field)) == value for field, value in _CUSTODY_POINT_STATUSES[key].items())

	rows = points + holders
	summary = {key: sum(1 for r in rows if in_status(r, key)) for key in ("All", *_CUSTODY_POINT_STATUSES, *_HOLDER_STATUSES)}

	if status not in summary:
		status = "All"
	matched = [r for r in rows if in_status(r, status) and (not search or search in r["search_text"])]
	start = (page - 1) * page_length
	return {
		"warehouses": [{k: v for k, v in r.items() if k != "search_text"} for r in matched[start : start + page_length]],
		"total": len(matched),
		"summary": summary,
		"can_create": frappe.has_permission("Custody Point", "create"),
	}


def _seals_held_by_custodian():
	"""{(custody_type, custodian): seal count} from every Seal Device's current custody."""
	rows = frappe.get_list(
		"Seal Device",
		filters={"current_custody_type": ["is", "set"], "current_custodian": ["is", "set"]},
		fields=["current_custody_type", "current_custodian", "count(name) as seals"],
		group_by="current_custody_type, current_custodian",
		limit_page_length=0,
	)
	return {(r.current_custody_type, r.current_custodian): cint(r.seals) for r in rows}


def _custody_point_row(point, seals):
	row = dict(point)
	row.update(
		holder_type="Custody Point",
		seals_held=seals,
		search_text=" ".join(
			str(point.get(f) or "") for f in ("name", "custody_point_name", "region", "address_line")
		).lower(),
	)
	return row


def _holder_rows(held):
	"""One row per User or Customer holding seals right now, most seals first."""
	users = [c for (t, c) in held if t == "User"]
	customers = [c for (t, c) in held if t == "Customer"]
	user_names = dict(
		frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True)
	) if users else {}
	customer_info = {
		c.name: c
		for c in frappe.get_all(
			"Customer", filters={"name": ["in", customers]}, fields=["name", "customer_name", "territory"]
		)
	} if customers else {}

	rows = []
	for (custody_type, custodian), seals in held.items():
		if custody_type == "User":
			label, region, detail = user_names.get(custodian) or custodian, None, custodian
		elif custody_type == "Customer":
			info = customer_info.get(custodian) or frappe._dict()
			# The root territory says nothing about where the customer is.
			region = info.territory if info.territory != "All Territories" else None
			label, detail = info.customer_name or custodian, None
		else:
			continue
		rows.append(
			{
				"name": custodian,
				"custody_point_name": label,
				"holder_type": custody_type,
				"region": region,
				"address_line": detail,
				"seals_held": seals,
				"search_text": " ".join(str(v or "") for v in (custodian, label, region, custody_type)).lower(),
			}
		)
	rows.sort(key=lambda r: (r["holder_type"], -r["seals_held"], r["custody_point_name"].lower()))
	return rows
