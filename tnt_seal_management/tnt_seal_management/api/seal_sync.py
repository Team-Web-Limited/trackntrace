# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Seal sync orchestration — per-device, per-journey, and scheduled batch sync.
Also exposes @frappe.whitelist() methods for manual form buttons.
"""

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from tnt_seal_management.tnt_seal_management.api.seal_api_client import (
	_save_sync_log,
	generate_access_token,
	get_live_data,
)

_SYNC_LOG_DOCTYPE = "Seal API Sync Log"

# ---------------------------------------------------------------------------
# Response normalisation
# ---------------------------------------------------------------------------

def normalize_live_data_response(response_json):
	"""
	Convert any known API response shape into a uniform list of device dicts.
	Each item contains normalised keys alongside the original record as ``_raw``.
	"""
	if not response_json:
		return []

	records = []

	if isinstance(response_json, list):
		records = response_json
	elif isinstance(response_json, dict):
		# Try common top-level list wrappers
		for key in ("vehicles", "data", "LiveData", "VehicleData", "records", "items", "result"):
			val = response_json.get(key)
			if isinstance(val, list):
				records = val
				break
			if isinstance(val, dict):
				records = [val]
				break

		# Uffizio getLiveData style: {"root": {"VehicleData": [...]}}
		if not records:
			root = response_json.get("root")
			if isinstance(root, dict):
				for key in ("VehicleData", "vehicles", "data", "detaildata"):
					val = root.get(key)
					if isinstance(val, list):
						records = val
						break

		# Single-record response
		if not records and any(
			k in response_json
			for k in ("imei", "Imeino", "imei_no", "IMEI", "vehicle_no", "Vehicle_No", "plate_no")
		):
			records = [response_json]

	normalised = []
	for rec in records:
		if not isinstance(rec, dict):
			continue
		normalised.append(
			{
				"imei": _pick(rec, ["imei", "imei_no", "imeiNo", "Imeino", "Imei", "IMEI", "deviceImeiNo"]),
				"vehicle_no": _pick(rec, ["vehicle_no", "vehicleNo", "VehicleNo", "Vehicle_No", "plate_no", "plateNumber", "object", "Object", "vehicle_name"]),
				"status": _pick(rec, ["status", "Status", "vehicle_status", "VehicleStatus"]),
				"latitude": _float(_pick(rec, ["latitude", "Latitude", "lat", "Lat", "lattitude"])),
				"longitude": _float(_pick(rec, ["longitude", "Longitude", "lng", "Lng", "lon", "Long"])),
				"location": _pick(rec, ["location", "Location", "address", "Address", "CurrentLocation", "currentLocation", "POI"]),
				"speed": _float(_pick(rec, ["speed", "Speed"])),
				"battery": _pick(rec, ["battery", "Battery", "battery_level", "battery_percentage"]),
				"transmission_status": _pick(rec, ["transmission_status", "TransmissionStatus", "GPS", "gps"]),
				"last_update_time": _pick(rec, ["last_update_time", "LastUpdateTime", "datetime", "Datetime", "DateTime", "date_time", "GPSActualTime", "gps_date_time", "serverTimeStamp"]),
				"_raw": rec,
			}
		)
	return normalised


# ---------------------------------------------------------------------------
# Single-device sync
# ---------------------------------------------------------------------------

def sync_seal_device(seal_device_name, sync_type="Manual Device Sync"):
	"""
	Pull live data for one Seal Device by IMEI and update its fields.
	Also updates the linked Seal Journey API fields if one is active.
	Returns the normalised matched record.
	"""
	device = frappe.get_doc("Seal Device", seal_device_name)

	if not device.imei_number:
		frappe.throw(
			_("Seal Device {0} has no IMEI Number. Set it before syncing.").format(seal_device_name),
			title=_("Missing IMEI"),
		)

	try:
		raw = get_live_data(
			imei_nos=device.imei_number,
			vehicle_nos=device.current_vehicle or None,
			sync_type=sync_type,
		)
	except Exception as exc:
		frappe.db.set_value(
			"Seal Device",
			seal_device_name,
			{"last_failed_sync_time": now_datetime(), "api_error_message": str(exc)[:500]},
		)
		frappe.db.commit()
		raise

	records = normalize_live_data_response(raw)
	matched = _match_record(records, device.imei_number, device.current_vehicle)

	if not matched:
		msg = f"No matching record in API response for IMEI {device.imei_number}"
		frappe.db.set_value(
			"Seal Device",
			seal_device_name,
			{"last_failed_sync_time": now_datetime(), "api_error_message": msg},
		)
		frappe.db.commit()
		frappe.throw(_(msg), title=_("No Data"))

	_apply_to_device(seal_device_name, matched)

	if device.current_journey:
		try:
			_apply_to_journey(device.current_journey, matched)
		except Exception as exc:
			frappe.log_error(
				f"Journey update failed for {device.current_journey}: {exc}",
				"Seal Journey Sync",
			)

	return matched


# ---------------------------------------------------------------------------
# Journey sync (delegates to device sync)
# ---------------------------------------------------------------------------

def sync_seal_journey(seal_journey_name):
	"""
	Sync the Seal Device attached to a journey, then mirror fields to the journey.
	"""
	journey = frappe.get_doc("Seal Journey", seal_journey_name)

	if not journey.assigned_seal:
		frappe.throw(
			_("Seal Journey {0} has no Assigned Seal. Cannot sync.").format(seal_journey_name),
			title=_("No Seal Assigned"),
		)

	imei = frappe.db.get_value("Seal Device", journey.assigned_seal, "imei_number")
	if not imei:
		frappe.throw(
			_("Seal Device {0} has no IMEI Number. Cannot sync journey {1}.").format(
				journey.assigned_seal, seal_journey_name
			),
			title=_("Missing IMEI"),
		)

	try:
		matched = sync_seal_device(journey.assigned_seal, sync_type="Manual Journey Sync")
		_apply_to_journey(seal_journey_name, matched)
		return matched
	except Exception as exc:
		frappe.db.set_value("Seal Journey", seal_journey_name, {"api_sync_error": str(exc)[:500]})
		frappe.db.commit()
		raise


# ---------------------------------------------------------------------------
# Scheduled batch sync
# ---------------------------------------------------------------------------

def scheduled_sync_active_journeys():
	"""
	Scheduler entry point: sync all Seal Devices linked to active/in-transit journeys.
	Failures on individual devices do not abort the batch.
	"""
	active = frappe.db.get_all(
		"Seal Journey",
		filters=[["journey_status", "in", ["In Transit", "Ready for Journey"]]],
		fields=["name", "assigned_seal", "vehicle_plate_number"],
	)

	if not active:
		return

	# Build IMEI → [journey names] and IMEI → device name maps
	imei_journeys = {}
	imei_device = {}

	for j in active:
		if not j.assigned_seal:
			continue
		imei = frappe.db.get_value("Seal Device", j.assigned_seal, "imei_number")
		if not imei:
			continue
		imei = str(imei)
		imei_journeys.setdefault(imei, []).append(j.name)
		imei_device[imei] = j.assigned_seal

	if not imei_journeys:
		return

	all_imeis = ",".join(imei_journeys.keys())

	log = {
		"doctype": _SYNC_LOG_DOCTYPE,
		"sync_type": "Scheduled Sync",
		"sync_started_at": now_datetime(),
		"imei_number": all_imeis[:140],
		"devices_synced": 0,
		"journeys_updated": 0,
	}

	try:
		raw = get_live_data(imei_nos=all_imeis, sync_type="Scheduled Sync")
		records = normalize_live_data_response(raw)

		synced = 0
		updated = 0

		for rec in records:
			imei = str(rec.get("imei") or "")
			if not imei or imei not in imei_device:
				continue
			device_name = imei_device[imei]
			try:
				_apply_to_device(device_name, rec)
				synced += 1
				for jname in imei_journeys.get(imei, []):
					try:
						_apply_to_journey(jname, rec)
						updated += 1
					except Exception as exc:
						frappe.log_error(
							f"Scheduled sync: journey {jname} update failed: {exc}",
							"Seal Scheduled Sync",
						)
			except Exception as exc:
				frappe.log_error(
					f"Scheduled sync: device {device_name} (IMEI {imei}) failed: {exc}",
					"Seal Scheduled Sync",
				)

		frappe.db.commit()

		log.update(
			{
				"sync_status": "Success" if synced > 0 else "Partial",
				"sync_completed_at": now_datetime(),
				"devices_synced": synced,
				"journeys_updated": updated,
				"response_body": json.dumps(raw)[:3000],
			}
		)

		frappe.db.set_value(
			"Seal API Settings",
			"Seal API Settings",
			{"last_successful_sync_time": now_datetime(), "last_sync_date_time": now_datetime()},
		)
		frappe.db.commit()

	except Exception as exc:
		log.update(
			{
				"sync_status": "Failed",
				"error_message": str(exc),
				"sync_completed_at": now_datetime(),
			}
		)
		frappe.db.set_value(
			"Seal API Settings",
			"Seal API Settings",
			{"last_failed_sync_time": now_datetime(), "last_error_message": str(exc)[:500]},
		)
		frappe.db.commit()
		frappe.log_error(f"Scheduled seal sync failed: {exc}", "Seal Scheduled Sync")

	_save_sync_log(log)


# ---------------------------------------------------------------------------
# Test connection
# ---------------------------------------------------------------------------

def test_api_connection():
	"""Generate a fresh token as a connectivity test. Returns a status string."""
	generate_access_token(force=True)
	return "Token generated successfully. API connection is working."


# ---------------------------------------------------------------------------
# Whitelisted methods (called from JS form buttons)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def manual_sync_seal_device(seal_device_name):
	_require_sync_permission()
	try:
		matched = sync_seal_device(seal_device_name)
		return {
			"status": "success",
			"message": _("Seal device data synced successfully."),
			"data": {
				"status": matched.get("status"),
				"location": matched.get("location"),
				"latitude": matched.get("latitude"),
				"longitude": matched.get("longitude"),
				"speed": matched.get("speed"),
				"battery": matched.get("battery"),
			},
		}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def manual_sync_seal_journey(seal_journey_name):
	_require_sync_permission()
	try:
		sync_seal_journey(seal_journey_name)
		return {"status": "success", "message": _("Seal journey location updated successfully.")}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def test_connection():
	_require_admin_permission()
	try:
		msg = test_api_connection()
		return {"status": "success", "message": msg}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def get_device_dashboard_data():
	"""Return all Seal Devices with their last-synced API fields for the dashboard."""
	_require_sync_permission()

	devices = frappe.db.get_all(
		"Seal Device",
		fields=[
			"name", "device_id", "imei_number", "device_type",
			"current_status", "current_vehicle", "current_journey",
			"current_location", "last_known_api_location",
			"latitude", "longitude", "speed", "battery_level",
			"last_api_status", "transmission_status",
			"last_successful_sync_time", "last_failed_sync_time",
			"api_error_message",
		],
		order_by="last_successful_sync_time desc",
	)

	# Build summary counts
	total = len(devices)
	active = sum(1 for d in devices if (d.get("last_api_status") or "").upper() in ("ACTIVE", "MOVING", "ON"))
	in_transit = sum(1 for d in devices if d.get("current_journey"))
	offline = sum(1 for d in devices if (d.get("last_api_status") or "").upper() in ("INACTIVE", "OFFLINE", ""))

	# Attach journey status to each device
	if devices:
		journey_statuses = {}
		journey_names = [d["current_journey"] for d in devices if d.get("current_journey")]
		if journey_names:
			rows = frappe.db.get_all(
				"Seal Journey",
				filters={"name": ["in", journey_names]},
				fields=["name", "journey_status", "vehicle_plate_number", "destination"],
			)
			journey_statuses = {r["name"]: r for r in rows}

		for d in devices:
			j = journey_statuses.get(d.get("current_journey") or "")
			d["journey_status"] = j["journey_status"] if j else None
			d["journey_vehicle"] = j["vehicle_plate_number"] if j else None
			d["journey_destination"] = j["destination"] if j else None

	return {
		"devices": [dict(d) for d in devices],
		"summary": {
			"total": total,
			"active": active,
			"in_transit": in_transit,
			"offline": offline,
		},
	}


@frappe.whitelist()
def trigger_sync_all():
	"""Manually trigger the scheduled batch sync from the dashboard."""
	_require_sync_permission()
	try:
		scheduled_sync_active_journeys()
		return {"status": "success", "message": _("Sync triggered for all active journeys.")}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

_SYNC_ROLES = {"System Manager", "Seal System Administrator", "Operations Control Room"}
_ADMIN_ROLES = {"System Manager", "Seal System Administrator"}


def _require_sync_permission():
	user_roles = set(frappe.get_roles(frappe.session.user))
	if not user_roles & _SYNC_ROLES:
		frappe.throw(
			_("You do not have permission to sync seal data."),
			frappe.PermissionError,
		)


def _require_admin_permission():
	user_roles = set(frappe.get_roles(frappe.session.user))
	if not user_roles & _ADMIN_ROLES:
		frappe.throw(
			_("Only System Manager or Seal System Administrator can test the API connection."),
			frappe.PermissionError,
		)


# ---------------------------------------------------------------------------
# Field-update helpers
# ---------------------------------------------------------------------------

def _apply_to_device(device_name, rec):
	"""Write normalised API record fields to a Seal Device."""
	upd = {
		"last_api_sync_time": now_datetime(),
		"last_successful_sync_time": now_datetime(),
		"api_error_message": "",
		"raw_api_response": json.dumps(rec.get("_raw", {}))[:5000],
	}
	if rec.get("status"):
		upd["last_api_status"] = str(rec["status"])[:140]
	if rec.get("location"):
		upd["last_known_api_location"] = str(rec["location"])[:140]
		upd["current_location"] = str(rec["location"])[:140]
	if rec.get("latitude") is not None:
		upd["latitude"] = rec["latitude"]
	if rec.get("longitude") is not None:
		upd["longitude"] = rec["longitude"]
	if rec.get("speed") is not None:
		upd["speed"] = rec["speed"]
	if rec.get("battery") is not None:
		upd["battery_level"] = str(rec["battery"])[:140]
	if rec.get("transmission_status"):
		upd["transmission_status"] = str(rec["transmission_status"])[:140]

	frappe.db.set_value("Seal Device", device_name, upd)
	frappe.db.commit()


def _apply_to_journey(journey_name, rec):
	"""Write normalised API record fields to a Seal Journey."""
	upd = {
		"api_last_update_time": now_datetime(),
		"api_sync_error": "",
	}
	if rec.get("status"):
		upd["api_device_status"] = str(rec["status"])[:140]
	if rec.get("location"):
		upd["api_device_location"] = str(rec["location"])[:140]
	if rec.get("latitude") is not None:
		upd["api_latitude"] = str(rec["latitude"])
	if rec.get("longitude") is not None:
		upd["api_longitude"] = str(rec["longitude"])
	if rec.get("speed") is not None:
		upd["api_speed"] = rec["speed"]
	if rec.get("battery") is not None:
		upd["api_battery_level"] = str(rec["battery"])[:140]
	if rec.get("_raw"):
		upd["api_raw_response"] = json.dumps(rec["_raw"])[:5000]

	frappe.db.set_value("Seal Journey", journey_name, upd)
	frappe.db.commit()


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def _pick(rec, keys):
	"""Return the first non-empty value found among the given keys."""
	for k in keys:
		v = rec.get(k)
		if v is not None and v != "" and v != "--":
			return v
	return None


def _float(val):
	if val is None:
		return None
	try:
		return float(val)
	except (ValueError, TypeError):
		return None


def _match_record(records, imei, vehicle_no=None):
	"""Find the best-matching record for a device by IMEI, then vehicle number."""
	if not records:
		return None
	imei_str = str(imei)
	for rec in records:
		if str(rec.get("imei") or "") == imei_str:
			return rec
	if vehicle_no:
		vn = str(vehicle_no).strip().lower()
		for rec in records:
			if str(rec.get("vehicle_no") or "").strip().lower() == vn:
				return rec
	# Single record fallback
	if len(records) == 1:
		return records[0]
	return None
