import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

_SHAPES = {1: "Circle", 2: "Rectangle", 3: "Polygon", 4: "Route"}
_NONE = ("", "--", None)


def _clean(value):
	value = cstr(value).strip()
	return None if value in _NONE else value


def _centroid(shape, coords):
	"""Mean of the boundary vertices ([lat, lng] pairs); the point itself for a
	circle. A closed polygon repeats its first vertex, which is dropped so it
	isn't counted twice. Routes carry no usable area."""
	pts = [c for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
	if not pts or shape == "Route":
		return None, None
	if len(pts) > 1 and pts[0] == pts[-1]:
		pts = pts[:-1]
	return (
		sum(float(p[0]) for p in pts) / len(pts),
		sum(float(p[1]) for p in pts) / len(pts),
	)


def sync_geofences():
	"""Pull Uffizio's geofence list into Uffizio Geofence (upsert by geofence id).
	Safe to re-run."""
	from tnt_seal_management.tnt_seal_management.api.seal_api_client import get_geofence_list

	raw = get_geofence_list()
	records = (raw.get("data") if isinstance(raw, dict) else raw) or []

	created = updated = 0
	now = now_datetime()
	for rec in records:
		gid = cstr(rec.get("Geofence Id")).strip()
		if not gid:
			continue
		shape = _SHAPES.get(rec.get("Geofence shape Type"))
		coords = rec.get("Co-ordinates") or []
		lat, lng = _centroid(shape, coords)
		company = _clean(rec.get("Company Name"))
		values = {
			"geofence_name": cstr(rec.get("Geofence name")).strip() or gid,
			"geofence_group": _clean(rec.get("Geofence Group")),
			"geofence_type": _clean(rec.get("Geofence Type")),
			"category": _clean(rec.get("Category")),
			"shape": shape,
			"company_name": company,
			"is_ours": 1 if company else 0,
			# Numeric columns are NOT NULL, so "no value" (routes have no centroid,
			# only circles have a radius) is stored as 0.
			"latitude": lat or 0,
			"longitude": lng or 0,
			"radius": rec.get("Radius") or 0,
			"tolerance": rec.get("Tolerance") or 0,
			"point_count": len(coords),
			"coordinates": json.dumps(coords),
			"last_synced": now,
		}
		if frappe.db.exists("Uffizio Geofence", gid):
			frappe.db.set_value("Uffizio Geofence", gid, values, update_modified=False)
			updated += 1
		else:
			frappe.get_doc({"doctype": "Uffizio Geofence", "geofence_id": gid, **values}).insert(
				ignore_permissions=True
			)
			created += 1

	frappe.db.commit()
	return {"created": created, "updated": updated, "total": len(records)}


def scheduled_sync_geofences():
	"""Daily cron entry point; no-op while the Seal API is disabled."""
	if not frappe.db.get_single_value("Seal API Settings", "enabled"):
		return
	try:
		sync_geofences()
	except Exception as exc:
		frappe.log_error("Geofence Sync", f"Scheduled geofence sync failed: {exc}")


_GEOFENCE_ADMIN_ROLES = {"System Manager", "Operations Control Room"}


def _ensure_geofence_admin():
	if not _GEOFENCE_ADMIN_ROLES.intersection(frappe.get_roles()):
		frappe.throw(
			_("Only the Control Room or a System Manager can manage geofences."), frappe.PermissionError
		)


@frappe.whitelist()
def manual_sync_geofences():
	_ensure_geofence_admin()
	try:
		return {"status": "success", **sync_geofences()}
	except Exception as exc:
		frappe.log_error("Geofence Sync", f"Manual geofence sync failed: {exc}")
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def get_geofence_page(search=None, scope="ours", page=1, page_length=25):
	"""Rows and counts for the Uffizio Geofences page. ``scope`` is ours (the ECTS
	account's own), shared (other accounts') or all."""
	frappe.has_permission("Uffizio Geofence", "read", throw=True)
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	base = []
	if scope == "ours":
		base.append(["is_ours", "=", 1])
	elif scope == "shared":
		base.append(["is_ours", "=", 0])
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [
			[field, "like", like]
			for field in ("geofence_name", "geofence_id", "geofence_group", "category")
		]

	rows = frappe.get_list(
		"Uffizio Geofence",
		filters=base,
		or_filters=or_filters,
		fields=[
			"name", "geofence_name", "geofence_group", "category", "shape", "is_ours", "company_name",
			"latitude", "longitude", "radius", "point_count", "last_synced",
		],
		order_by="geofence_name asc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	return {
		"geofences": rows,
		"total": len(
			frappe.get_list(
				"Uffizio Geofence", filters=base, or_filters=or_filters, pluck="name", limit_page_length=0
			)
		),
		"scope_counts": {
			"ours": frappe.db.count("Uffizio Geofence", {"is_ours": 1}),
			"shared": frappe.db.count("Uffizio Geofence", {"is_ours": 0}),
		},
		"last_synced": frappe.db.get_value("Uffizio Geofence", {}, "max(last_synced)"),
		"can_manage": bool(_GEOFENCE_ADMIN_ROLES.intersection(frappe.get_roles())),
	}
