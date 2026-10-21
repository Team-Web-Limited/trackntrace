# Seal warehouses are ERPNext Warehouses whose Branch (custom_division) is ECTS
# Division or Both (a store shared with the FMS Division). Material Transfer / Issue / Receipt keep stock on them as usual;
# seal management adds a few custom fields (Main Seal Store, GPS position and
# radius) and treats them as the places a seal can rest.

import math

import frappe
from frappe import _
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

# Page roles that see every seal holder. A Field Technician (tag operator) with
# none of them sees only the seals in their own custody — where a seal rests is
# dynamic (Seal Device custody), so their "warehouse" is themselves.
_ALL_HOLDERS_ROLES = frozenset({
	"System Manager",
	"Operations Control Room",
	"Management",
	"Managing Director",
	"PCB Team Leader",
	"Account Manager",
})


# The seal journey life-cycle roles, as shown in the Warehouses page's Role
# column for staff holding seals (oversight roles like Management are left out).
_LIFECYCLE_ROLE_LABELS = {
	"Field Technician": "TO",
	"PCB Team Leader": "PCB Team Leader",
	"Operations Control Room": "Control Room",
	"Finance PCB": "Finance PCB",
	"Account Manager": "Account Manager",
}


# Who may set a staff member's base location on the Warehouses page (besides the
# staff member themselves). Stored on a hidden User field, so this replaces the
# System Manager-only User form.
_BASE_LOCATION_EDITORS = frozenset({
	"System Manager",
	"Operations Control Room",
	"Management",
	"Managing Director",
	"PCB Team Leader",
})


def is_technician_only(user=None):
	roles = set(frappe.get_roles(user or frappe.session.user))
	return "Field Technician" in roles and not roles & _ALL_HOLDERS_ROLES


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

	if is_technician_only():
		mine = ("User", frappe.session.user)
		rows = _holder_rows({k: v for k, v in _seals_held_by_custodian().items() if k == mine})
	else:
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
		"can_edit_base_location": bool(set(frappe.get_roles()) & _BASE_LOCATION_EDITORS),
		"session_user": frappe.session.user,
	}


@frappe.whitelist()
def set_staff_base_location(user, base_location=None):
	"""Set a staff member's fixed base (e.g. Mombasa office), shown on the
	Warehouses page next to the live GPS position of the seals they hold."""
	if user != frappe.session.user and not set(frappe.get_roles()) & _BASE_LOCATION_EDITORS:
		frappe.throw(_("Not permitted to set another staff member's base location."), frappe.PermissionError)
	if not frappe.db.exists("User", user):
		frappe.throw(_("User {0} not found").format(user))
	base_location = (base_location or "").strip() or None
	frappe.db.set_value("User", user, "custom_seal_base_location", base_location)
	return base_location


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
			"custom_is_main_seal_store", "custom_location",
		],
		order_by="custom_is_main_seal_store desc, disabled asc, warehouse_name asc",
	)
	names = [w.name for w in warehouses]
	stock = _seals_by_warehouse(names)
	held = dict(
		frappe.get_all(
			"Seal Device",
			filters={
				"current_custody_type": "Warehouse",
				"current_custodian": ["in", names or [""]],
				"in_uffizio": 1,
			},
			fields=["current_custodian", "count(name)"],
			group_by="current_custodian",
			as_list=True,
		)
	)
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
			"location": w.custom_location,
			"address_line": w.address_line_1,
			# Seals Held is custody (what is physically there, as on the Warehouse
			# form); In Stock is ERPNext's Serial No count, shown alongside so the
			# two can be reconciled.
			"seals_held": cint(held.get(w.name)),
			"in_stock": stock.get(w.name, 0),
			"search_text": " ".join(
				str(v or "") for v in (w.name, w.warehouse_name, w.company, w.city, w.custom_location, w.address_line_1)
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
					and ifnull(sd.in_uffizio, 1) = 1
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
		filters={
			"current_custody_type": ["in", _HOLDER_STATUSES],
			"current_custodian": ["is", "set"],
			"in_uffizio": 1,
		},
		fields=["current_custody_type", "current_custodian", "count(name) as seals"],
		group_by="current_custody_type, current_custodian",
		limit_page_length=0,
	)
	return {(r.current_custody_type, r.current_custodian): cint(r.seals) for r in rows}


def _holder_rows(held):
	"""One row per User or Customer holding seals right now, most seals first."""
	users = [c for (t, c) in held if t == "User"]
	customers = [c for (t, c) in held if t == "Customer"]
	user_info = {
		u.name: u
		for u in frappe.get_all(
			"User", filters={"name": ["in", users]}, fields=["name", "full_name", "custom_seal_base_location"]
		)
	} if users else {}
	customer_info = {
		c.name: c
		for c in frappe.get_all(
			"Customer", filters={"name": ["in", customers]}, fields=["name", "customer_name", "territory"]
		)
	} if customers else {}

	user_roles = _lifecycle_roles(users)
	user_locations = _staff_locations(users)

	rows = []
	for (custody_type, custodian), seals in held.items():
		role = location = base_location = None
		if custody_type == "User":
			info = user_info.get(custodian) or frappe._dict()
			label, region, detail = info.full_name or custodian, None, custodian
			role = ", ".join(user_roles.get(custodian, [])) or None
			location = user_locations.get(custodian)
			base_location = info.custom_seal_base_location
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
				"location": location,
				"base_location": base_location,
				"role": role,
				"address_line": detail,
				"seals_held": seals,
				"search_text": " ".join(
					str(v or "") for v in (custodian, label, region, base_location, location, role, custody_type)
				).lower(),
			}
		)
	rows.sort(key=lambda r: (r["holder_type"], -r["seals_held"], r["label"].lower()))
	return rows


def _lifecycle_roles(users):
	"""{user: [life-cycle role labels]} for the given users, in a fixed order."""
	if not users:
		return {}
	held = {}
	for user, role in frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "parent": ["in", users], "role": ["in", list(_LIFECYCLE_ROLE_LABELS)]},
		fields=["parent", "role"],
		as_list=True,
	):
		held.setdefault(user, set()).add(role)
	return {
		user: [label for role, label in _LIFECYCLE_ROLE_LABELS.items() if role in roles]
		for user, roles in held.items()
	}


def _staff_locations(users):
	"""{user: location} — a person holding seals is a moving warehouse, so their
	location is the latest GPS fix among the seals in their custody."""
	if not users:
		return {}
	locations = {}
	for d in frappe.get_all(
		"Seal Device",
		filters={
			"current_custody_type": "User",
			"current_custodian": ["in", users],
			"in_uffizio": 1,
			"last_known_api_location": ["is", "set"],
		},
		fields=["current_custodian", "last_known_api_location"],
		order_by="last_api_sync_time desc",
	):
		locations.setdefault(d.current_custodian, d.last_known_api_location)
	return locations
