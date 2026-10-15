# Seal warehouses are ERPNext Warehouses whose Branch (custom_division) is ECTS
# Division or Both (a store shared with the FMS Division). Material Transfer / Issue / Receipt keep stock on them as usual;
# seal management adds a few custom fields (Main Seal Store, GPS position and
# radius) and treats them as the places a seal can rest.

import math

import frappe
from frappe.utils import cint, flt

ECTS_DIVISION = "ECTS Division"
BOTH_DIVISIONS = "Both"
SEAL_DIVISIONS = (ECTS_DIVISION, BOTH_DIVISIONS)
DEFAULT_RADIUS_METERS = 300
EARTH_RADIUS_METERS = 6371000

# Link filters for picking a seal warehouse (Return Warehouse, custody handover).
SEAL_WAREHOUSE_FILTERS = {"custom_division": ["in", SEAL_DIVISIONS], "is_group": 0, "disabled": 0}


def is_seal_warehouse(warehouse):
	"""True when ``warehouse`` is an active seal warehouse (Branch ECTS Division or Both)."""
	return bool(warehouse) and bool(
		frappe.db.exists("Warehouse", {"name": warehouse, **SEAL_WAREHOUSE_FILTERS})
	)


def main_seal_store():
	"""Name of the warehouse flagged Main Seal Store, if any."""
	return frappe.db.get_value("Warehouse", {**SEAL_WAREHOUSE_FILTERS, "custom_is_main_seal_store": 1}, "name")


@frappe.whitelist()
def get_seal_warehouse_options():
	"""Active seal warehouses for pickers, main store first. A plain list, so the
	handover dialog works for roles (e.g. Operations Control Room) that have no
	permission on the ERPNext Warehouse doctype."""
	return frappe.get_all(
		"Warehouse",
		filters=SEAL_WAREHOUSE_FILTERS,
		fields=["name", "warehouse_name"],
		order_by="custom_is_main_seal_store desc, warehouse_name asc",
	)


def haversine_meters(lat1, lon1, lat2, lon2):
	"""Great-circle distance between two lat/lon points, in meters."""
	phi1, phi2 = math.radians(lat1), math.radians(lat2)
	d_phi = math.radians(lat2 - lat1)
	d_lambda = math.radians(lon2 - lon1)
	a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
	return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(a))


def find_nearest_seal_warehouse(latitude, longitude):
	"""The nearest seal warehouse whose GPS radius contains the given point, or
	None. Used to attribute an idle seal's Uffizio GPS fix to the store it is
	sitting in. Warehouses without a position set are skipped."""
	latitude, longitude = flt(latitude), flt(longitude)
	warehouses = frappe.get_all(
		"Warehouse",
		filters=SEAL_WAREHOUSE_FILTERS,
		fields=["name", "custom_seal_latitude", "custom_seal_longitude", "custom_seal_geofence_radius"],
	)
	best, best_distance = None, None
	for w in warehouses:
		if not w.custom_seal_latitude and not w.custom_seal_longitude:
			continue
		distance = haversine_meters(latitude, longitude, w.custom_seal_latitude, w.custom_seal_longitude)
		if distance <= (w.custom_seal_geofence_radius or DEFAULT_RADIUS_METERS):
			if best_distance is None or distance < best_distance:
				best, best_distance = w, distance
	if not best:
		return None
	return {"warehouse": best.name, "distance_meters": round(best_distance, 1)}


# The Warehouses page is a shortcut to where seals are: the ERPNext warehouses
# of the ECTS division (where Material Transfer / Issue / Receipt book them),
# plus whoever holds seals right now outside a warehouse.
_WAREHOUSE_STATUSES = {"Active": 0, "Inactive": 1}  # value of Warehouse.disabled
_HOLDER_STATUSES = ("User", "Customer")


@frappe.whitelist()
def get_warehouse_list(search=None, status="All", page=1, page_length=25):
	"""Rows for the Warehouses page: every ERPNext Warehouse whose Branch
	(custom_division) is ECTS Division or Both, with the number of seals its stock
	ledger holds (Serial No.warehouse), plus the Users and Customers that seals
	are in the custody of right now — straight from each Seal Device, so they
	appear and drop off as seals move. ``status`` is All, or one or more of
	Active / Inactive / User / Customer (a list, or its JSON) — rows matching any
	of them; ``summary`` counts every status regardless of the search.

	Warehouses are read without per-user permissions: the page itself is
	role-gated, and several of its roles (Control Room, Management) can't read
	the Warehouse doctype."""
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length) or 25, 1), 100)
	search = (search or "").strip().lower()

	rows = _division_warehouse_rows() + _holder_rows(_seals_held_by_custodian())

	def in_status(row, key):
		if key == "All":
			return True
		if key in _HOLDER_STATUSES:
			return row["holder_type"] == key
		return row["holder_type"] == "Warehouse" and cint(row["disabled"]) == _WAREHOUSE_STATUSES[key]

	summary = {key: sum(1 for r in rows if in_status(r, key)) for key in ("All", *_WAREHOUSE_STATUSES, *_HOLDER_STATUSES)}
	selected = _parse_statuses(status, summary)
	matched = [
		r
		for r in rows
		if (not selected or any(in_status(r, key) for key in selected))
		and (not search or search in r["search_text"])
	]
	start = (page - 1) * page_length
	return {
		"warehouses": [{k: v for k, v in r.items() if k != "search_text"} for r in matched[start : start + page_length]],
		"total": len(matched),
		"summary": summary,
		"can_create": frappe.has_permission("Warehouse", "create"),
		"can_read_warehouse": frappe.has_permission("Warehouse", "read"),
	}


def _parse_statuses(status, known):
	"""The selected filters as a list; empty means All."""
	if isinstance(status, str):
		status = frappe.parse_json(status) if status.strip().startswith("[") else [status]
	return [s for s in (status or []) if s in known and s != "All"]


def _division_warehouse_rows():
	"""Seal warehouses (ECTS Division or Both), active first, each with its seal count."""
	warehouses = frappe.get_all(
		"Warehouse",
		filters={"custom_division": ["in", SEAL_DIVISIONS], "is_group": 0},
		fields=[
			"name", "warehouse_name", "company", "parent_warehouse", "disabled", "city", "address_line_1",
			"custom_is_main_seal_store",
		],
		order_by="custom_is_main_seal_store desc, disabled asc, warehouse_name asc",
	)
	seals = _seals_by_warehouse([w.name for w in warehouses])
	return [
		{
			"name": w.name,
			"label": w.warehouse_name or w.name,
			"holder_type": "Warehouse",
			"company": w.company,
			"parent_warehouse": w.parent_warehouse,
			"disabled": cint(w.disabled),
			"is_main_seal_store": cint(w.custom_is_main_seal_store),
			"region": w.city,
			"address_line": w.address_line_1,
			"seals_held": seals.get(w.name, 0),
			"search_text": " ".join(
				str(v or "") for v in (w.name, w.warehouse_name, w.company, w.city, w.address_line_1)
			).lower(),
		}
		for w in warehouses
	]


def _seals_by_warehouse(warehouses):
	"""{warehouse: seal count} from the stock ledger: Serial Nos that are seals,
	matched on the Seal Device's name, serial number or IMEI."""
	if not warehouses:
		return {}
	rows = frappe.db.sql(
		"""
		select sn.warehouse, count(distinct sn.name)
		from `tabSerial No` sn
		where sn.warehouse in %(warehouses)s
			and exists (
				select 1 from `tabSeal Device` sd
				where sn.name in (sd.name, sd.serial_number, sd.imei_number)
			)
		group by sn.warehouse
		""",
		{"warehouses": tuple(warehouses)},
	)
	return {warehouse: cint(count) for warehouse, count in rows}


def _seals_held_by_custodian():
	"""{(custody_type, custodian): seal count} for seals held by a User or Customer."""
	rows = frappe.get_all(
		"Seal Device",
		filters={"current_custody_type": ["in", _HOLDER_STATUSES], "current_custodian": ["is", "set"]},
		fields=["current_custody_type", "current_custodian", "count(name) as seals"],
		group_by="current_custody_type, current_custodian",
		limit_page_length=0,
	)
	return {(r.current_custody_type, r.current_custodian): cint(r.seals) for r in rows}


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
				"label": label,
				"holder_type": custody_type,
				"region": region,
				"address_line": detail,
				"seals_held": seals,
				"search_text": " ".join(str(v or "") for v in (custodian, label, region, custody_type)).lower(),
			}
		)
	rows.sort(key=lambda r: (r["holder_type"], -r["seals_held"], r["label"].lower()))
	return rows
