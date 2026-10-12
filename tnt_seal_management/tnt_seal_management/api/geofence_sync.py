import json
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

_SHAPES = {1: "Circle", 2: "Rectangle", 3: "Polygon", 4: "Route"}
_NONE = ("", "--", None)


def _clean(value):
	value = cstr(value).strip()
	return None if value in _NONE else value


def _norm(name):
	return re.sub(r"[^a-z0-9]", "", cstr(name).lower())


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
	"""Pull Uffizio's geofence list into Uffizio Geofence (upsert by geofence id),
	then auto-link any unlinked Transport Location whose name matches exactly one
	geofence. Safe to re-run."""
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

	linked = auto_link_transport_locations()
	frappe.db.commit()
	return {"created": created, "updated": updated, "total": len(records), "auto_linked": linked}


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


def _candidate_keys(location_name):
	"""'Eldoret, Kenya' also answers to 'Eldoret'."""
	keys = {_norm(location_name)}
	keys.add(_norm(cstr(location_name).split(",")[0]))
	return {k for k in keys if k}


def _geofences_by_name():
	by_name = {}
	for g in frappe.get_all(
		"Uffizio Geofence", fields=["name", "geofence_name", "is_ours", "shape"]
	):
		if g.shape == "Route":
			continue
		by_name.setdefault(_norm(g.geofence_name), []).append(g)
	return by_name


def _pick_unique(candidates):
	"""One geofence if the choice is unambiguous: a single candidate, else a single
	one on our own account. Otherwise leave it for a human."""
	if len(candidates) == 1:
		return candidates[0]
	ours = [c for c in candidates if c.is_ours]
	return ours[0] if len(ours) == 1 else None


def auto_link_transport_locations():
	by_name = _geofences_by_name()
	linked = 0
	for loc in frappe.get_all(
		"Transport Location", filters={"uffizio_geofence": ["is", "not set"]}, fields=["name"]
	):
		for key in _candidate_keys(loc.name):
			pick = _pick_unique(by_name.get(key, []))
			if pick:
				frappe.db.set_value(
					"Transport Location",
					loc.name,
					{"uffizio_geofence": pick.name},
					update_modified=False,
				)
				_fill_coordinates(loc.name, pick.name)
				linked += 1
				break
	refresh_geofence_backlinks()
	return linked


def _fill_coordinates(location, geofence):
	lat, lng = frappe.db.get_value("Uffizio Geofence", geofence, ["latitude", "longitude"])
	frappe.db.set_value(
		"Transport Location", location, {"latitude": lat, "longitude": lng}, update_modified=False
	)


def refresh_geofence_backlinks(geofences=None):
	"""Keep Uffizio Geofence.transport_locations in step with the links."""
	rows = frappe.get_all(
		"Transport Location",
		filters={"uffizio_geofence": ["in", geofences]} if geofences else {"uffizio_geofence": ["is", "set"]},
		fields=["name", "uffizio_geofence"],
	)
	grouped = {}
	for r in rows:
		grouped.setdefault(r.uffizio_geofence, []).append(r.name)
	targets = set(geofences or []) | set(grouped)
	if not geofences:
		targets |= set(
			frappe.get_all("Uffizio Geofence", filters={"transport_locations": ["is", "set"]}, pluck="name")
		)
	for g in targets:
		frappe.db.set_value(
			"Uffizio Geofence", g, "transport_locations", ", ".join(sorted(grouped.get(g, []))) or None,
			update_modified=False,
		)


@frappe.whitelist()
def get_geofence_suggestions(transport_location):
	"""Best-guess geofences for a Transport Location, for the 'Suggest' button:
	same normalised name first, then names that contain it (or it contain them)."""
	frappe.has_permission("Transport Location", "read", transport_location, throw=True)
	keys = _candidate_keys(transport_location)
	scored = []
	for g in frappe.get_all(
		"Uffizio Geofence",
		fields=["name", "geofence_name", "geofence_group", "shape", "is_ours", "latitude", "longitude"],
	):
		if g.shape == "Route":
			continue
		gk = _norm(g.geofence_name)
		if not gk:
			continue
		if gk in keys:
			score = 3
		elif any(k in gk or (len(gk) >= 4 and gk in k) for k in keys):
			score = 1
		else:
			continue
		scored.append((score + (0.5 if g.is_ours else 0), g))
	scored.sort(key=lambda x: (-x[0], x[1].geofence_name))
	return [g for _s, g in scored[:15]]


@frappe.whitelist()
def create_transport_locations(geofences, location_role, country, location_type):
	"""Bulk 'Create Transport Locations' from the Uffizio Geofence list: one
	Transport Location per selected geofence, named after it and linked to it, so
	it can be picked as a Journey Request origin/destination/checkpoint. A
	location that already exists under that name is linked instead when it has no
	geofence yet; routes and geofences already linked are skipped."""
	_ensure_geofence_admin()
	geofences = frappe.parse_json(geofences) if isinstance(geofences, str) else geofences
	created, linked, skipped = [], [], []
	for gid in geofences or []:
		g = frappe.db.get_value(
			"Uffizio Geofence", gid, ["name", "geofence_name", "shape", "transport_locations"], as_dict=True
		)
		name = cstr(g.geofence_name).strip() if g else ""
		if not g or not name or g.shape == "Route" or g.transport_locations:
			skipped.append(name or gid)
			continue
		existing = frappe.db.get_value("Transport Location", name, "uffizio_geofence")
		if frappe.db.exists("Transport Location", name):
			if existing:
				skipped.append(name)
				continue
			loc = frappe.get_doc("Transport Location", name)
			loc.uffizio_geofence = g.name
			loc.save()
			linked.append(name)
		else:
			frappe.get_doc(
				{
					"doctype": "Transport Location",
					"location_name": name,
					"location_role": location_role,
					"country": country,
					"location_type": location_type,
					"is_active": 1,
					"uffizio_geofence": g.name,
				}
			).insert()
			created.append(name)
	return {"created": created, "linked": linked, "skipped": skipped}


@frappe.whitelist()
def get_geofence_page(search=None, scope="ours", link="all", page=1, page_length=25):
	"""Rows and counts for the Uffizio Geofences page. ``scope`` is ours (the ECTS
	account's own), shared (other accounts') or all; ``link`` is all, linked or
	unlinked (to a Transport Location). Counts in ``summary`` ignore ``link`` so
	the filter chips keep showing what each choice would give."""
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
			for field in ("geofence_name", "geofence_id", "geofence_group", "category", "transport_locations")
		]

	link_filters = {
		"all": [],
		"linked": [["transport_locations", "is", "set"]],
		"unlinked": [["transport_locations", "is", "not set"]],
	}

	def count(link_key):
		return len(
			frappe.get_list(
				"Uffizio Geofence",
				filters=base + link_filters[link_key],
				or_filters=or_filters,
				pluck="name",
				limit_page_length=0,
			)
		)

	link = link if link in link_filters else "all"
	filters = base + link_filters[link]

	rows = frappe.get_list(
		"Uffizio Geofence",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name", "geofence_name", "geofence_group", "category", "shape", "is_ours", "company_name",
			"latitude", "longitude", "radius", "point_count", "transport_locations", "last_synced",
		],
		order_by="geofence_name asc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	return {
		"geofences": rows,
		"total": count(link),
		"summary": {key: count(key) for key in link_filters},
		"scope_counts": {
			"ours": frappe.db.count("Uffizio Geofence", {"is_ours": 1}),
			"shared": frappe.db.count("Uffizio Geofence", {"is_ours": 0}),
		},
		"last_synced": frappe.db.get_value("Uffizio Geofence", {}, "max(last_synced)"),
		"can_manage": bool(_GEOFENCE_ADMIN_ROLES.intersection(frappe.get_roles())),
	}
