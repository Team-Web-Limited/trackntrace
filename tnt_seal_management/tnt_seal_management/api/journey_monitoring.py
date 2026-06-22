# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Journey monitoring — control-room view over Seal Journey records.

Exposes a single whitelisted method that returns journeys filterable by
status (all / active / completed), date-wise, with the current location,
seal lock status, and a set of *derived* alerts computed from the live API
fields already synced onto each Seal Journey (no extra tracking endpoint).
"""

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime

from tnt_seal_management.tnt_seal_management.billing import get_applicable_billing_rule
from tnt_seal_management.tnt_seal_management.api.seal_sync import (
	_require_dashboard_permission,
	normalize_api_status,
	normalize_elock_status,
)

# ---------------------------------------------------------------------------
# Alert thresholds — tune here. (Could later move to Seal API Settings.)
# ---------------------------------------------------------------------------
STALE_MINUTES = 30  # no API update for this many minutes => stale
LOW_BATTERY_PCT = 20  # battery below this (%) => low-battery warning
OVERSPEED_KMH = 80  # speed above this (km/h) => overspeed info

# Journey statuses that count as "active / incomplete" (everything except the
# two terminal states). Used for the active view and summary counts.
_TERMINAL_STATUSES = ("Completed", "Cancelled")

_FIELDS = [
	"name", "customer", "vehicle_plate_number", "container_number",
	"origin", "destination", "journey_status",
	"journey_start_date_time", "arrival_date_time", "completion_date_time",
	"assigned_seal", "current_seal_status",
	"api_device_status", "api_device_location",
	"api_latitude", "api_longitude", "api_speed", "api_battery_level",
	"api_last_update_time", "api_sync_error", "creation", "days_taken"
]


@frappe.whitelist()
def get_journey_monitoring_data(
	view="all", search=None, from_date=None, to_date=None, page=1, page_length=30
):
	"""Return Seal Journeys for the monitoring page.

	view: "all" | "active" (incomplete) | "completed"
	Returns {journeys, total, page, page_length, summary}.
	"""
	_require_dashboard_permission()

	page = max(1, int(page or 1))
	page_length = max(1, min(int(page_length or 30), 100))

	filters = _build_filters(view, from_date, to_date)
	or_filters = _build_or_filters(search)

	if view == "alerts":
		# Alerts are derived dynamically, so we must fetch all matching active rows
		# and filter in Python, then manually paginate.
		active_filters = _build_filters("active", from_date, to_date)
		all_active = frappe.db.get_all(
			"Seal Journey",
			filters=active_filters,
			or_filters=or_filters or None,
			fields=_FIELDS,
			order_by="creation desc",
		)
		_attach_seals(all_active)
		journeys_with_alerts = [j for j in all_active if j.get("alert_level")]
		
		total = len(journeys_with_alerts)
		start = (page - 1) * page_length
		journeys = journeys_with_alerts[start : start + page_length]
		_attach_longer_in_journey(journeys)
	else:
		total = frappe.db.count("Seal Journey", filters=_count_filters(filters, or_filters))

		journeys = frappe.db.get_all(
			"Seal Journey",
			filters=filters,
			or_filters=or_filters or None,
			fields=_FIELDS,
			order_by="creation desc",
			limit_start=(page - 1) * page_length,
			limit_page_length=page_length,
		)
		_attach_seals(journeys)
		_attach_longer_in_journey(journeys)

	return {
		"journeys": [dict(j) for j in journeys],
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": _summary(from_date, to_date),
	}


# ---------------------------------------------------------------------------
# Per-seal expansion
# ---------------------------------------------------------------------------

def _attach_seals(journeys):
	"""Attach a per-seal list (with lock status and alerts) to each journey.

	Journeys carry their seals in the ``journey_seals`` child (reusing the
	Journey Request Seal doctype). Journeys created before the multi-seal
	change fall back to a single synthetic seal from ``assigned_seal`` + the
	journey-level API fields.
	"""
	if not journeys:
		return

	names = [j["name"] for j in journeys]
	rows = frappe.db.get_all(
		"Journey Request Seal",
		filters={"parent": ["in", names], "parenttype": "Seal Journey"},
		fields=[
			"parent", "seal_device", "seal_number", "lock_status",
			"api_device_status", "api_location", "battery_level", "api_last_update_time",
		],
		order_by="parent asc, idx asc",
	)
	seals_by_journey = {}
	for r in rows:
		seals_by_journey.setdefault(r["parent"], []).append(r)

	device_locks = _device_lock_map(rows, journeys)

	for j in journeys:
		seal_rows = seals_by_journey.get(j["name"], [])
		if not seal_rows and j.get("assigned_seal"):
			# Back-compat: synthesise one seal from the journey-level fields.
			seal_rows = [{
				"seal_device": j.get("assigned_seal"),
				"seal_number": j.get("assigned_seal"),
				"lock_status": j.get("current_seal_status"),
				"api_device_status": j.get("api_device_status"),
				"api_location": j.get("api_device_location"),
				"battery_level": j.get("api_battery_level"),
				"api_last_update_time": j.get("api_last_update_time"),
			}]

		seals = []
		for r in seal_rows:
			lock = device_locks.get(r.get("seal_device") or "") or normalize_elock_status(
				r.get("lock_status")
			) or (r.get("lock_status") or "")
			alerts = _derive_seal_alerts(j.get("journey_status"), r, lock)
			seals.append({
				"seal_device": r.get("seal_device"),
				"seal_number": r.get("seal_number") or r.get("seal_device"),
				"lock_status": lock or "",
				"battery_level": r.get("battery_level"),
				"api_device_status": r.get("api_device_status"),
				"api_location": r.get("api_location"),
				"alerts": alerts,
				"alert_level": _roll_up_level(alerts),
			})

		j["seals"] = seals
		all_alerts = [a for s in seals for a in s["alerts"]]
		j["alert_level"] = _roll_up_level(all_alerts)


def _attach_longer_in_journey(journeys):
	"""Calculate longer_in_journey extra days based on customer billing rate."""
	if not journeys:
		return

	for j in journeys:
		j["longer_in_journey"] = 0

	customer_names = list({j["customer"] for j in journeys if j.get("customer")})
	if not customer_names:
		return

	# Resolve each customer's applicable rule through the assignment hierarchy
	# (customer -> customer group -> global default), then read its grace period.
	allowed_days_by_customer = {}
	rule_days_cache = {}
	for customer in customer_names:
		rule_name = get_applicable_billing_rule(customer)
		if not rule_name:
			allowed_days_by_customer[customer] = 0
			continue
		if rule_name not in rule_days_cache:
			rule_days_cache[rule_name] = flt(
				frappe.db.get_value("Seal Billing Rate", rule_name, "first_period_days")
			)
		allowed_days_by_customer[customer] = rule_days_cache[rule_name]

	now = now_datetime()
	for j in journeys:
		allowed_days = allowed_days_by_customer.get(j["customer"], 0)

		j["longer_in_journey"] = 0

		if allowed_days > 0:
			total_days = 0
			if j.get("days_taken"):
				total_days = flt(j["days_taken"])
			elif j.get("journey_start_date_time") and j.get("journey_status") not in (
				"Cancelled", "Draft", "Pre-Tagging", "Tagging Request Booked",
				"Tagging In Progress", "Tagged", "Post-Tagging", "Ready for Journey",
				"Pending Finance PCB Approval", "Finance PCB Approved",
				"Finance PCB Rejected", "Team Lead Assigned", "Technician Assigned"
			):
				start_dt = get_datetime(j["journey_start_date_time"])
				total_days = (now - start_dt).total_seconds() / 86400.0

			if total_days > allowed_days:
				j["longer_in_journey"] = total_days - allowed_days


def _device_lock_map(rows, journeys):
	seal_names = {r.get("seal_device") for r in rows if r.get("seal_device")}
	seal_names |= {j.get("assigned_seal") for j in journeys if j.get("assigned_seal")}
	seal_names.discard(None)
	if not seal_names:
		return {}
	device_rows = frappe.db.get_all(
		"Seal Device",
		filters={"name": ["in", list(seal_names)]},
		fields=["name", "lock_status"],
	)
	return {d["name"]: d.get("lock_status") for d in device_rows}


def _derive_seal_alerts(journey_status, seal, lock):
	"""Compute alerts for a single seal from its synced child-row fields."""
	alerts = []
	is_active = journey_status not in _TERMINAL_STATUSES
	in_transit = journey_status == "In Transit"

	if in_transit and lock == "Unlocked":
		alerts.append({"level": "critical", "message": _("Seal unlocked in transit")})

	if is_active and normalize_api_status(seal.get("api_device_status"))["bucket"] == "offline":
		alerts.append({"level": "warning", "message": _("Device offline")})

	if is_active:
		last = seal.get("api_last_update_time")
		if last:
			mins = (now_datetime() - get_datetime(last)).total_seconds() / 60.0
			if mins > STALE_MINUTES:
				alerts.append({
					"level": "warning",
					"message": _("No update for {0} min").format(int(mins)),
				})

	battery = _parse_number(seal.get("battery_level"))
	if battery is not None and battery < LOW_BATTERY_PCT:
		alerts.append({"level": "warning", "message": _("Low battery ({0}%)").format(int(battery))})

	return alerts


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def _build_filters(view, from_date, to_date):
	filters = []
	if view == "active":
		filters.append(["journey_status", "not in", _TERMINAL_STATUSES])
	elif view == "completed":
		filters.append(["journey_status", "=", "Completed"])
	elif view == "in_transit":
		filters.append(["journey_status", "=", "In Transit"])

	if from_date:
		filters.append(["creation", ">=", f"{from_date} 00:00:00"])
	if to_date:
		filters.append(["creation", "<=", f"{to_date} 23:59:59"])
	return filters


def _build_or_filters(search):
	if not search:
		return []
	like = f"%{search}%"
	return [
		["name", "like", like],
		["customer", "like", like],
		["vehicle_plate_number", "like", like],
		["container_number", "like", like],
		["assigned_seal", "like", like],
		["api_device_location", "like", like],
	]


def _count_filters(filters, or_filters):
	# frappe.db.count does not accept or_filters; when a search is active we
	# cannot cheaply express the OR, so fall back to counting the AND filters
	# only. The list query itself still honours the search for the page rows.
	return filters or {}


_LEVEL_RANK = {"critical": 3, "warning": 2, "info": 1}


def _roll_up_level(alerts):
	if not alerts:
		return ""
	return max(alerts, key=lambda a: _LEVEL_RANK.get(a["level"], 0))["level"]


def _parse_number(value):
	"""Pull a leading number out of values like '85', '85%', '85 km/h'; None if absent."""
	if value is None or value == "":
		return None
	try:
		return flt(str(value).strip().split()[0].rstrip("%"))
	except (ValueError, IndexError):
		return None


# ---------------------------------------------------------------------------
# Summary (whole dataset, not just current page)
# ---------------------------------------------------------------------------

def _summary(from_date, to_date):
	base = _build_filters("all", from_date, to_date)

	def count(extra=None):
		return frappe.db.count("Seal Journey", filters=(base + extra) if extra else (base or {}))

	all_count = count()
	completed = count([["journey_status", "=", "Completed"]])
	active = count([["journey_status", "not in", _TERMINAL_STATUSES]])
	in_transit = count([["journey_status", "=", "In Transit"]])

	# Alert count: how many active journeys currently carry at least one seal alert.
	active_rows = frappe.db.get_all(
		"Seal Journey",
		filters=(base + [["journey_status", "not in", _TERMINAL_STATUSES]]),
		fields=_FIELDS,
	)
	_attach_seals(active_rows)
	alerts = sum(
		1 for r in active_rows if any(s["alerts"] for s in r.get("seals", []))
	)

	return {
		"all": all_count,
		"active": active,
		"in_transit": in_transit,
		"completed": completed,
		"alerts": alerts,
	}
