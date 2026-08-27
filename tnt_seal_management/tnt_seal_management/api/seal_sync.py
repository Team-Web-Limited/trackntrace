# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Seal sync orchestration — per-device, per-journey, and scheduled batch sync.
Also exposes @frappe.whitelist() methods for manual form buttons.
"""

import json
import re

import frappe
from frappe import _
from frappe.utils import cstr, get_datetime, now_datetime

from tnt_seal_management.tnt_seal_management.api.seal_api_client import (
	_save_sync_log,
	generate_access_token,
	get_live_data,
)

_SYNC_LOG_DOCTYPE = "Seal API Sync Log"

# Full-fleet syncs are split into batches of this many IMEIs. The upstream API
# fails a request outright if any single IMEI in it is not owned by the
# configured account, so smaller batches bound the blast radius. Each batch is
# a separate HTTP call and Seal API Settings enforces
# "Minimum Request Gap Seconds" between calls — keep this large enough that a
# full sync still finishes well inside the sync interval.
_FLEET_CHUNK_SIZE = 250

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
				"branch": _pick(rec, ["branch", "Branch", "BRANCH", "fleet_branch", "FleetBranch"]),
				"elock": _pick(rec, ["elock", "Elock", "ELock", "ELOCK", "lock_status", "LockStatus"]),
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
		# IMEI alone is enough — _match_record matches by IMEI first and only
		# falls back to vehicle_no locally if that fails. Sending vehicle_nos
		# as an API-side filter is risky: if current_vehicle holds a plate the
		# Uffizio account doesn't have registered, the whole request is
		# rejected ("<plate> Does Not Belong To Given User") even though the
		# IMEI itself is valid. sync_all_devices (the full-fleet path) never
		# sends vehicle_nos for the same reason.
		raw = get_live_data(
			imei_nos=device.imei_number,
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
			_apply_to_seal_journey_seals(device.current_journey, seal_device_name, matched)
		except Exception as exc:
			frappe.log_error(
				"Seal Journey Sync",
				f"Journey update failed for {device.current_journey}: {exc}",
			)

	if device.current_journey_request:
		try:
			_apply_to_journey_request_seals(device.current_journey_request, seal_device_name, matched)
		except Exception as exc:
			frappe.log_error(
				"Seal Journey Request Sync",
				f"Journey Request update failed for {device.current_journey_request}: {exc}",
			)

	try:
		_reconcile_alert_log(device)
	except Exception as exc:
		frappe.log_error(
			"Seal Alert Log Sync",
			f"Alert log reconcile failed for {seal_device_name}: {exc}",
		)

	return matched


def _reconcile_alert_log(device):
	"""Re-derive alerts for one freshly-synced Seal Device and keep Seal Alert
	Log in step: open a row the first time a condition appears, resolve it the
	first time it clears. Runs at every sync chokepoint (scheduled, manual,
	tagging/arrival GPS pulls) so the log reflects live telemetry without
	hammering the DB on every dashboard read."""
	from tnt_seal_management.tnt_seal_management.api.journey_monitoring import _derive_seal_alerts

	journey_status = None
	seal_journey = device.current_journey or None
	journey_request = None
	if seal_journey:
		journey_status = frappe.db.get_value("Seal Journey", seal_journey, "journey_status")
	elif device.current_journey_request:
		journey_request = device.current_journey_request
		journey_status = frappe.db.get_value("Journey Request", journey_request, "journey_request_status")

	seal = {
		"api_device_status": device.last_api_status,
		"api_last_update_time": device.last_api_sync_time,
		"battery_level": device.battery_level,
	}
	alerts = _derive_seal_alerts(journey_status, seal, device.lock_status)
	current_types = {a["type"] for a in alerts}

	open_rows = frappe.get_all(
		"Seal Alert Log",
		filters={"seal_device": device.name, "alert_source": "System", "is_resolved": 0},
		fields=["name", "alert_type"],
	)
	open_types = {r.alert_type for r in open_rows}

	# Only Battery alerts auto-resolve from telemetry: when a seal's battery
	# recovers, the warning clears itself. Security and Connectivity alerts are
	# deliberately NOT auto-resolved here — once raised they stay open until a
	# Control Room user resolves them through the Resolution workflow, so a
	# tamper or drop-out is never silently closed by a transient reading.
	for row in open_rows:
		if row.alert_type == "Battery" and row.alert_type not in current_types:
			frappe.db.set_value(
				"Seal Alert Log", row.name, {"is_resolved": 1, "resolved_at": now_datetime()}
			)

	for alert in alerts:
		if alert["type"] in open_types:
			continue
		alert_doc = frappe.get_doc({
			"doctype": "Seal Alert Log",
			"alert_source": "System",
			"alert_type": alert["type"],
			"level": alert["level"].capitalize(),
			"message": alert["message"],
			"seal_device": device.name,
			"seal_journey": seal_journey,
			"journey_request": journey_request,
			"occurred_at": now_datetime(),
		}).insert(ignore_permissions=True)

		# Actively notify on a newly-opened critical alert (e.g. seal unlocked
		# in transit). Only fires once per alert because the open/resolve
		# reconcile above won't re-create a row that is already open.
		if str(alert.get("level", "")).lower() == "critical":
			_notify_critical_alert(
				alert["type"], alert["message"], device.name, seal_journey, journey_request,
				alert_name=alert_doc.name,
			)

	frappe.db.commit()


def _reconcile_alert_log_safe(device_name):
	"""Reconcile alerts for a device by name, swallowing errors so one bad
	device never aborts a batch sync. Used by the scheduled/bulk sync paths,
	which update device fields directly rather than going through
	sync_seal_device (the single-device path that already reconciles)."""
	try:
		_reconcile_alert_log(frappe.get_doc("Seal Device", device_name))
	except Exception as exc:
		frappe.log_error(
			"Seal Alert Log Sync",
			f"Alert log reconcile failed for {device_name}: {exc}",
		)


# ---------------------------------------------------------------------------
# Critical-alert notifications
# ---------------------------------------------------------------------------

# Roles whose members should be told about a critical seal alert. Deliberately
# excludes System Manager: on this site that role is held by ~20 developers /
# consultants, and paging them on every seal-tamper would be noise. Critical
# alerts go to the operational audience only.
_ALERT_NOTIFY_ROLES = ("Operations Control Room",)


def _alert_recipients():
	"""Return [(user, email)] for enabled users in the control-room roles,
	excluding Guest/Administrator. email falls back to the user id."""
	users = set(
		frappe.get_all(
			"Has Role",
			filters={"role": ["in", _ALERT_NOTIFY_ROLES], "parenttype": "User"},
			pluck="parent",
		)
	)
	users -= {"Guest", "Administrator"}
	if not users:
		return []
	rows = frappe.get_all(
		"User",
		filters={"name": ["in", list(users)], "enabled": 1},
		fields=["name", "email"],
	)
	return [(r.name, r.email or r.name) for r in rows]


def _notify_critical_alert(
	alert_type, message, seal_device, seal_journey=None, journey_request=None, alert_name=None
):
	"""Push a critical seal alert to the control room: a desk Notification Log
	(bell icon) per user, plus an email via the site's default outgoing account.
	Best-effort — failures are logged, never raised, so they can't break a sync."""
	recipients = _alert_recipients()
	if not recipients:
		return

	subject = _("Critical Seal Alert: {0}").format(alert_type)
	lines = [message, _("Seal Device: {0}").format(seal_device)]
	if seal_journey:
		lines.append(_("Seal Journey: {0}").format(seal_journey))
	if journey_request:
		lines.append(_("Journey Request: {0}").format(journey_request))
	body = "<br>".join(str(l) for l in lines)

	# Route the bell click to the Control Room Alert tab (which has the full
	# resolution workflow UI) rather than the raw Seal Alert Log list view.
	# Include the alert name so the page deep-links straight to that row.
	cr_link = "/app/control-room?tab=alert"
	if alert_name:
		from urllib.parse import quote

		cr_link += "&alert=" + quote(str(alert_name))

	for user, _email in recipients:
		try:
			frappe.get_doc({
				"doctype": "Notification Log",
				"subject": subject,
				"email_content": body,
				"for_user": user,
				"type": "Alert",
				"document_type": "Seal Device",
				"document_name": seal_device,
				"link": cr_link,
			}).insert(ignore_permissions=True)
		except Exception as exc:
			frappe.log_error(
				"Seal Alert Notify",
				f"Critical alert desk notification failed for {user}: {exc}",
			)

	emails = [email for _user, email in recipients if email and "@" in email]
	if emails:
		try:
			frappe.sendmail(recipients=emails, subject=subject, message=body, now=False)
		except Exception as exc:
			frappe.log_error("Seal Alert Notify", f"Critical alert email failed: {exc}")


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
	Frequency is controlled by Sync Frequency Minutes in Seal API Settings.

	Timing is tracked in its own field, last_active_journey_sync_time. It must
	not use last_successful_sync_time: every successful API call updates that,
	including the full-fleet job's, so a full-fleet sync on a shorter interval
	would keep this job permanently inside its own gate and it would never run.
	"""
	settings = frappe.db.get_value(
		"Seal API Settings",
		"Seal API Settings",
		["sync_frequency_minutes", "last_active_journey_sync_time"],
		as_dict=True,
	) or {}
	freq = int(settings.get("sync_frequency_minutes") or 15)
	last_sync = settings.get("last_active_journey_sync_time")
	if last_sync:
		elapsed_minutes = (now_datetime() - get_datetime(last_sync)).total_seconds() / 60
		if elapsed_minutes < freq:
			return

	# Stamp the timer before doing any work, so the interval is honoured even
	# when this cycle has nothing to sync or fails part-way. Stamping only on
	# the success path lets the job re-run on every scheduler tick instead of
	# every `freq` minutes.
	frappe.db.set_value(
		"Seal API Settings",
		"Seal API Settings",
		"last_active_journey_sync_time",
		now_datetime(),
	)
	frappe.db.commit()

	active = frappe.db.get_all(
		"Seal Journey",
		filters=[["journey_status", "in", ["In Transit", "Ready for Journey"]]],
		fields=["name", "assigned_seal", "vehicle_plate_number"],
	)

	active_jr_seals = frappe.db.sql(
		"""
		select jrs.seal_device, jrs.parent as journey_request, sd.imei_number
		from `tabJourney Request Seal` jrs
		inner join `tabJourney Request` jr on jr.name = jrs.parent
		inner join `tabSeal Device` sd on sd.name = jrs.seal_device
		where jrs.parenttype = 'Journey Request'
			and jr.journey_request_status = 'Journey Ready'
			and sd.imei_number is not null and sd.imei_number != ''
		""",
		as_dict=True,
	)

	active_sj_seals = frappe.db.sql(
		"""
		select sjs.seal_device, sjs.parent as seal_journey, sd.imei_number
		from `tabJourney Request Seal` sjs
		inner join `tabSeal Journey` sj on sj.name = sjs.parent
		inner join `tabSeal Device` sd on sd.name = sjs.seal_device
		where sjs.parenttype = 'Seal Journey'
			and sj.journey_status in ('In Transit', 'Ready for Journey')
			and sd.imei_number is not null and sd.imei_number != ''
		""",
		as_dict=True,
	)

	if not active and not active_jr_seals and not active_sj_seals:
		return

	# Build IMEI → [journey names], IMEI → [journey request names],
	# IMEI → [(seal journey, device)] and IMEI → device name maps
	imei_journeys = {}
	imei_journey_requests = {}
	imei_seal_journey_seals = {}
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

	for row in active_jr_seals:
		imei = str(row.imei_number)
		imei_journey_requests.setdefault(imei, []).append(row.journey_request)
		imei_device.setdefault(imei, row.seal_device)

	for row in active_sj_seals:
		imei = str(row.imei_number)
		imei_seal_journey_seals.setdefault(imei, []).append((row.seal_journey, row.seal_device))
		imei_device.setdefault(imei, row.seal_device)

	if not imei_device:
		return

	all_imeis = ",".join(imei_device.keys())

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
							"Seal Scheduled Sync",
							f"Scheduled sync: journey {jname} update failed: {exc}",
						)
				for jr_name in imei_journey_requests.get(imei, []):
					try:
						_apply_to_journey_request_seals(jr_name, device_name, rec)
						updated += 1
					except Exception as exc:
						frappe.log_error(
							"Seal Scheduled Sync",
							f"Scheduled sync: journey request {jr_name} update failed: {exc}",
						)
				for sj_name, sj_device in imei_seal_journey_seals.get(imei, []):
					try:
						_apply_to_seal_journey_seals(sj_name, sj_device, rec)
						updated += 1
					except Exception as exc:
						frappe.log_error(
							"Seal Scheduled Sync",
							f"Scheduled sync: seal journey {sj_name} update failed: {exc}",
						)
				_reconcile_alert_log_safe(device_name)
			except Exception as exc:
				frappe.log_error(
					"Seal Scheduled Sync",
					f"Scheduled sync: device {device_name} (IMEI {imei}) failed: {exc}",
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
		frappe.log_error("Seal Scheduled Sync", f"Scheduled seal sync failed: {exc}")

	_save_sync_log(log)


# ---------------------------------------------------------------------------
# Full-fleet sync (all devices with an IMEI)
# ---------------------------------------------------------------------------

_UNOWNED_IMEI_RE = re.compile(
	r"([\d,\s]+?)\s*Does\s+Not\s+Belongs?\s+To\s+Given\s+User", re.IGNORECASE
)


def _extract_unowned_imeis(error_message):
	"""
	Pull the offending IMEIs out of an API rejection such as
	``API error: 123,456 Does Not Belongs To Given User``.
	Returns [] when the message is some other kind of failure.
	"""
	match = _UNOWNED_IMEI_RE.search(str(error_message or ""))
	if not match:
		return []
	return [part.strip() for part in match.group(1).split(",") if part.strip()]


def _fetch_live_data_chunked(imeis, sync_type, chunk_size=_FLEET_CHUNK_SIZE):
	"""
	Fetch live data for many IMEIs without letting one bad device sink the rest.

	The API rejects a whole request when any IMEI in it is not owned by the
	configured account, naming the offenders in the error message. When that
	happens the batch is retried once with those IMEIs removed. Any other batch
	failure is recorded and the remaining batches still run.

	Returns ``(records, unowned, errors)``.
	"""
	records = []
	unowned = []
	errors = []

	for start in range(0, len(imeis), chunk_size):
		chunk = imeis[start:start + chunk_size]
		batch_no = start // chunk_size + 1

		# Two attempts: the second one drops IMEIs the API named as unowned.
		for attempt in (1, 2):
			if not chunk:
				break
			try:
				raw = get_live_data(imei_nos=",".join(chunk), sync_type=sync_type)
				records.extend(normalize_live_data_response(raw))
				break
			except Exception as exc:
				rejected = [i for i in _extract_unowned_imeis(exc) if i in chunk]
				if attempt == 1 and rejected:
					unowned.extend(rejected)
					chunk = [i for i in chunk if i not in set(rejected)]
					continue
				errors.append(f"batch {batch_no}: {exc}")
				frappe.log_error(
					"Seal Bulk Sync",
					f"Bulk sync batch {batch_no} ({len(chunk)} IMEIs) failed: {exc}",
				)
				break

	return records, unowned, errors


def sync_all_devices(sync_type="Manual Device Sync"):
	"""
	Pull live data for every Seal Device that has an IMEI number and update
	their fields. Also updates linked Seal Journey API fields where present.
	Failures on individual devices, or on a whole batch, do not abort the rest.
	"""
	devices = frappe.db.get_all(
		"Seal Device",
		filters=[["imei_number", "!=", ""]],
		fields=["name", "imei_number", "current_vehicle", "current_journey", "current_journey_request"],
	)
	devices = [d for d in devices if d.get("imei_number")]

	if not devices:
		return {"synced": 0, "failed": 0, "journeys_updated": 0}

	imei_device = {str(d["imei_number"]): d for d in devices}
	all_imeis = ",".join(imei_device.keys())

	log = {
		"doctype": _SYNC_LOG_DOCTYPE,
		"sync_type": sync_type,
		"sync_started_at": now_datetime(),
		"imei_number": all_imeis[:140],
		"devices_synced": 0,
		"journeys_updated": 0,
	}

	synced = 0
	failed = 0
	updated = 0

	try:
		records, unowned, batch_errors = _fetch_live_data_chunked(
			list(imei_device.keys()), sync_type
		)

		for rec in records:
			imei = str(rec.get("imei") or "")
			if not imei or imei not in imei_device:
				continue
			device = imei_device[imei]
			try:
				_apply_to_device(device["name"], rec)
				synced += 1
				if device.get("current_journey"):
					try:
						_apply_to_journey(device["current_journey"], rec)
						_apply_to_seal_journey_seals(device["current_journey"], device["name"], rec)
						updated += 1
					except Exception as exc:
						frappe.log_error(
							"Seal Bulk Sync",
							f"Bulk sync: journey {device['current_journey']} update failed: {exc}",
						)
				if device.get("current_journey_request"):
					try:
						_apply_to_journey_request_seals(device["current_journey_request"], device["name"], rec)
						updated += 1
					except Exception as exc:
						frappe.log_error(
							"Seal Bulk Sync",
							f"Bulk sync: journey request {device['current_journey_request']} update failed: {exc}",
						)
				_reconcile_alert_log_safe(device["name"])
			except Exception as exc:
				frappe.log_error(
					"Seal Bulk Sync",
					f"Bulk sync: device {device['name']} (IMEI {imei}) failed: {exc}",
				)

		frappe.db.commit()

		failed = len(devices) - synced

		problems = []
		if unowned:
			problems.append(
				f"{len(unowned)} IMEI(s) not owned by the API account: {','.join(unowned)}"
			)
		problems.extend(batch_errors)

		if not synced:
			status = "Failed"
		elif problems:
			status = "Partial"
		else:
			status = "Success"

		log.update({
			"sync_status": status,
			"sync_completed_at": now_datetime(),
			"devices_synced": synced,
			"journeys_updated": updated,
			"error_message": "; ".join(problems)[:500] if problems else None,
			"response_body": json.dumps(records)[:3000],
		})

	except Exception as exc:
		failed = len(devices)
		log.update({
			"sync_status": "Failed",
			"error_message": str(exc),
			"sync_completed_at": now_datetime(),
		})
		frappe.log_error("Seal Bulk Sync", f"Bulk fleet sync failed: {exc}")

	_save_sync_log(log)
	return {"synced": synced, "failed": failed, "journeys_updated": updated}


def scheduled_sync_all_devices():
	"""
	Scheduler entry point: full-fleet sync of every Seal Device with an IMEI.
	Only runs when "Full Fleet Sync Enabled" is checked in Seal API Settings,
	and only after "Full Fleet Sync Frequency Minutes" has elapsed since the
	last run. Tracks its own timer (last_full_fleet_sync_time) independently
	of the active-journeys scheduled sync, so the two jobs don't reset each
	other's intervals.
	"""
	settings = frappe.db.get_value(
		"Seal API Settings",
		"Seal API Settings",
		["full_fleet_sync_enabled", "full_fleet_sync_frequency_minutes", "last_full_fleet_sync_time"],
		as_dict=True,
	) or {}

	if not settings.get("full_fleet_sync_enabled"):
		return

	freq = int(settings.get("full_fleet_sync_frequency_minutes") or 10)
	last_sync = settings.get("last_full_fleet_sync_time")
	if last_sync:
		elapsed_minutes = (now_datetime() - get_datetime(last_sync)).total_seconds() / 60
		if elapsed_minutes < freq:
			return

	# Stamp the timer before syncing, not after. If sync_all_devices raises, a
	# timer that is only written on the success path never advances and the job
	# retries the whole fleet on every scheduler tick instead of every `freq`
	# minutes.
	frappe.db.set_value(
		"Seal API Settings",
		"Seal API Settings",
		"last_full_fleet_sync_time",
		now_datetime(),
	)
	frappe.db.commit()

	result = sync_all_devices(sync_type="Scheduled Full Fleet Sync")

	updates = {}
	if not result.get("synced"):
		updates["last_failed_sync_time"] = now_datetime()
		updates["last_error_message"] = (
			f"Scheduled full fleet sync: 0 devices synced, {result.get('failed', 0)} failed."
		)[:500]

	if updates:
		frappe.db.set_value("Seal API Settings", "Seal API Settings", updates)
		frappe.db.commit()


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


# ---------------------------------------------------------------------------
# Uffizio's own alert feed (getAlertData — Trakzee Premium, separate from the
# locally-derived alerts in journey_monitoring.py). Manual-trigger only for
# now: unverified against the live Seal API Settings account, so it is not
# wired into hooks.py scheduler_events alongside the other syncs. Once a
# manual run confirms real alert rows come back, add it to the cron block
# next to scheduled_sync_active_journeys.
# ---------------------------------------------------------------------------

def sync_alert_data(from_dt=None, to_dt=None, imei_nos=None, sync_type="Alert Data Sync"):
	"""Pull Uffizio's getAlertData feed and persist new alerts to Seal Alert
	Log with alert_source="Uffizio", deduplicated by source_alert_id so
	re-running the sync never creates duplicate rows."""
	from tnt_seal_management.tnt_seal_management.api.seal_api_client import get_alert_data

	raw = get_alert_data(imei_nos=imei_nos, from_dt=from_dt, to_dt=to_dt, sync_type=sync_type)
	records = _normalize_alert_data_response(raw)

	imeis = {str(r["imei"]) for r in records if r.get("imei")}
	device_by_imei = {}
	if imeis:
		rows = frappe.get_all(
			"Seal Device",
			filters={"imei_number": ["in", list(imeis)]},
			fields=["name", "imei_number", "current_journey", "current_journey_request"],
		)
		device_by_imei = {str(r.imei_number): r for r in rows}

	created = 0
	skipped = 0
	for rec in records:
		alert_id = rec.get("alert_id")
		if alert_id and frappe.db.exists(
			"Seal Alert Log", {"source_alert_id": str(alert_id), "alert_source": "Uffizio"}
		):
			skipped += 1
			continue

		device = device_by_imei.get(str(rec.get("imei"))) if rec.get("imei") else None
		frappe.get_doc({
			"doctype": "Seal Alert Log",
			"alert_source": "Uffizio",
			"alert_type": rec.get("alert_type") or "Unknown",
			"level": "Warning",
			"message": rec.get("alert_info") or rec.get("alert_type") or _("Uffizio alert"),
			"seal_device": device.name if device else None,
			"seal_journey": device.current_journey if device else None,
			"journey_request": device.current_journey_request if device else None,
			"occurred_at": rec.get("alert_generation") or now_datetime(),
			"source_alert_id": str(alert_id) if alert_id else None,
			"raw_data": json.dumps(rec.get("_raw") or rec)[:5000],
		}).insert(ignore_permissions=True)
		created += 1

	frappe.db.commit()
	return {"created": created, "skipped": skipped, "total": len(records)}


def _normalize_alert_data_response(response_json):
	"""Normalise Uffizio's getAlertData response shape — see
	https://developers.uffizio.com/tracking-api/55 — into a uniform list."""
	if not response_json:
		return []
	records = response_json.get("data") if isinstance(response_json, dict) else response_json
	if not isinstance(records, list):
		return []

	normalised = []
	for rec in records:
		if not isinstance(rec, dict):
			continue
		normalised.append({
			"imei": _pick(rec, ["imei", "Imeino", "imei_no", "IMEI"]),
			"alert_id": _pick(rec, ["alert_id", "Alert_Id", "AlertId"]),
			"alert_type": _pick(rec, ["alert_type", "Alert_Type", "AlertType"]),
			"alert_info": _pick(rec, ["alert_info", "Alert_Info", "description", "Description"]),
			"alert_generation": _pick(rec, ["alert_generation", "Alert_Generation", "AlertGeneration"]),
			"alert_location": _pick(rec, ["alert_location", "Alert_Location"]),
			"_raw": rec,
		})
	return normalised


@frappe.whitelist()
def manual_sync_alert_data(from_dt=None, to_dt=None):
	_require_sync_permission()
	try:
		result = sync_alert_data(from_dt=from_dt, to_dt=to_dt)
		return {"status": "success", **result}
	except Exception as exc:
		frappe.log_error("Seal Alert Data Sync", f"Manual alert data sync failed: {exc}")
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def test_connection():
	_require_admin_permission()
	try:
		msg = test_api_connection()
		return {"status": "success", "message": msg}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Status normalisation — map raw device-API vocabulary to internal buckets
# ---------------------------------------------------------------------------

# The tracking API reports states like RUNNING/STOP/IDLE/INACTIVE/OFFLINE.
# The dashboard groups every device into exactly one visible "bucket":
#   - "active"  => the device is online / communicating (moving, stopped or idle)
#   - "offline" => the device is not transmitting (inactive, offline or unknown)
# "motion" is a finer label used for the "Moving Now" metric and badge colour.
# Any unrecognised or blank status maps to offline/unknown so that no synced
# device ever disappears from the summary counts (active + offline == total).
_API_STATUS_MAP = {
	"RUNNING": {"bucket": "active", "motion": "moving"},
	"MOVING": {"bucket": "active", "motion": "moving"},
	"ON": {"bucket": "active", "motion": "moving"},
	"ACTIVE": {"bucket": "active", "motion": "moving"},
	"STOP": {"bucket": "active", "motion": "stopped"},
	"STOPPED": {"bucket": "active", "motion": "stopped"},
	"IDLE": {"bucket": "active", "motion": "idle"},
	"INACTIVE": {"bucket": "offline", "motion": "inactive"},
	"OFFLINE": {"bucket": "offline", "motion": "inactive"},
}

_UNKNOWN_STATUS = {"bucket": "offline", "motion": "unknown"}


def normalize_api_status(raw):
	"""Map a raw device-API status string to an internal {bucket, motion} dict."""
	key = (raw or "").strip().upper()
	if not key:
		return _UNKNOWN_STATUS
	return _API_STATUS_MAP.get(key, _UNKNOWN_STATUS)


# The Uffizio E-Lock devices report their seal state via the "elock" field
# as CLOSE/OPEN. We surface this on the dashboard as Locked/Unlocked.
_ELOCK_STATUS_MAP = {
	"CLOSE": "Locked",
	"CLOSED": "Locked",
	"LOCK": "Locked",
	"LOCKED": "Locked",
	"OPEN": "Unlocked",
	"UNLOCK": "Unlocked",
	"UNLOCKED": "Unlocked",
}


def normalize_elock_status(raw):
	"""Map a raw "elock" API value (CLOSE/OPEN) to Locked/Unlocked, or "" if unknown."""
	key = (raw or "").strip().upper()
	return _ELOCK_STATUS_MAP.get(key, "")


@frappe.whitelist()
def get_device_dashboard_data():
	"""Return all Seal Devices with their last-synced API fields for the dashboard."""
	_require_dashboard_permission()

	devices = frappe.db.get_all(
		"Seal Device",
		fields=[
			"name", "device_id", "imei_number",
			"current_status", "condition", "current_vehicle", "current_journey",
			"current_technician",
			"current_location", "last_known_api_location", "api_branch",
			"latitude", "longitude", "speed", "battery_level",
			"last_api_status", "lock_status", "transmission_status",
			"last_successful_sync_time", "last_failed_sync_time",
			"api_error_message", "remarks",
		],
		order_by="last_successful_sync_time desc",
	)

	# Build summary counts.
	# Every device is normalised into exactly one of two buckets (active/offline)
	# so active + offline == total and nothing falls through the cracks.
	total = len(devices)
	statuses = [normalize_api_status(d.get("last_api_status")) for d in devices]
	active = sum(1 for s in statuses if s["bucket"] == "active")
	offline = sum(1 for s in statuses if s["bucket"] == "offline")

	# "In Transit" stays a business-state metric: device linked to a Seal Journey.
	in_transit = sum(1 for d in devices if d.get("current_journey"))

	# "Moving Now" is the live physical-motion metric. We trust the device's
	# self-reported status, not the speed field: per the Uffizio tracking API,
	# INACTIVE means "no data received for ~60 min" — its speed is a stale
	# last-known reading, not live movement. Only RUNNING is genuine motion.
	moving_now = sum(1 for s in statuses if s["motion"] == "moving")

	available = sum(1 for d in devices if d.get("current_status") == "Available")
	assigned = sum(1 for d in devices if d.get("current_status") in ("Assigned", "In Journey"))
	issues = sum(
		1
		for d in devices
		if d.get("current_status") in ("Damaged", "Lost", "Inactive")
		or d.get("condition") in ("Damaged", "Lost")
	)

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
			"moving_now": moving_now,
			"offline": offline,
			"available": available,
			"assigned": assigned,
			"issues": issues,
		},
	}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Seal Device Dashboard's currently filtered table (built
	client-side, same approach as Completed Journeys' export) to a PDF."""
	from frappe.utils.pdf import get_pdf

	_require_dashboard_permission()

	html = html.replace("{{TNT_LOGO}}", _get_tnt_logo_img_tag())

	options = {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "15mm",
		"margin-right": "15mm",
		"margin-bottom": "15mm",
		"margin-left": "15mm",
	}

	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = get_pdf(html, options=options)
	frappe.local.response.type = "pdf"


# (label, key, column width) — same columns the PDF report shows. The Seal
# Device Dashboard filters entirely client-side (one unfiltered fetch, then JS
# narrows it down), so unlike the other list pages there's no server-side
# filter to replay here: the client sends the already-filtered, already-
# formatted rows as JSON, the same way export_pdf receives already-built HTML.
_DEVICE_EXPORT_COLUMNS = (
	("Seal", "name", 20),
	("Status", "status", 20),
	("Warehouse", "warehouse", 24),
	("Journey", "journey", 20),
	("Vehicle", "vehicle", 18),
	("Location", "location", 30),
	("Battery", "battery", 12),
	("Last Sync", "last_sync", 20),
)


@frappe.whitelist()
def export_excel(rows, filename):
	"""Render the Seal Device Dashboard's currently filtered rows (built
	client-side, same rows as export_pdf) to an .xlsx workbook."""
	from frappe.utils.xlsxutils import make_xlsx

	_require_dashboard_permission()

	rows = frappe.parse_json(rows)
	if not rows:
		frappe.throw(_("No seal devices match the current filters."))

	data = [[_(label) for label, key, width in _DEVICE_EXPORT_COLUMNS]]
	for row in rows:
		data.append([cstr(row.get(key)) for label, key, width in _DEVICE_EXPORT_COLUMNS])

	xlsx_file = make_xlsx(
		data,
		"Seal Devices",
		column_widths=[width for label, key, width in _DEVICE_EXPORT_COLUMNS],
	)

	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


# Matches the seal-tracking-dashboard Page's own role list — distinct from
# _DASHBOARD_ROLES (which gates the Seal Device Dashboard) because this page
# additionally grants Managing Director but not PCB Team Leader.
_TRACKING_DASHBOARD_ROLES = {"System Manager", "Operations Control Room", "Management", "Managing Director"}


@frappe.whitelist()
def export_tracking_pdf(html, filename):
	"""Render the Seal Tracking Dashboard's currently filtered table (built
	client-side, same approach as the Seal Device Dashboard's export) to a PDF."""
	from frappe.utils.pdf import get_pdf

	if not set(frappe.get_roles(frappe.session.user)) & _TRACKING_DASHBOARD_ROLES:
		frappe.throw(
			_("You do not have permission to export the seal tracking dashboard."),
			frappe.PermissionError,
		)

	html = html.replace("{{TNT_LOGO}}", _get_tnt_logo_img_tag())

	options = {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "15mm",
		"margin-right": "15mm",
		"margin-bottom": "15mm",
		"margin-left": "15mm",
	}

	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = get_pdf(html, options=options)
	frappe.local.response.type = "pdf"


def _get_tnt_logo_img_tag():
	"""Track and Trace logo, inlined as a base64 data URI so the (unpatched,
	pre-Qt-WebKit) wkhtmltopdf on this box renders it without an HTTP round
	trip back to the site. The AVIF the customer portal uses isn't supported
	by that old renderer, so this reads the PNG copy of the same logo instead
	(tnt_seal_management/public/images/trackntrace.png, converted once from
	the .avif)."""
	import base64
	import os

	path = frappe.get_app_path("tnt_seal_management", "public", "images", "trackntrace.png")
	if not os.path.exists(path):
		return ""

	with open(path, "rb") as f:
		encoded = base64.b64encode(f.read()).decode("ascii")

	return f'<img src="data:image/png;base64,{encoded}" class="tnt-pdf-logo" alt="Track and Trace">'


@frappe.whitelist()
def trigger_sync_all():
	"""Manually trigger the scheduled batch sync (active journeys only) from the dashboard."""
	_require_sync_permission()
	try:
		scheduled_sync_active_journeys()
		return {"status": "success", "message": _("Sync triggered for all active journeys.")}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


@frappe.whitelist()
def trigger_sync_all_devices():
	"""Manually trigger a full fleet sync (every device with an IMEI) from the dashboard."""
	_require_sync_permission()
	try:
		result = sync_all_devices()
		return {
			"status": "success",
			"message": _("{0} device(s) synced, {1} failed.").format(result["synced"], result["failed"]),
		}
	except Exception as exc:
		return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

_SYNC_ROLES = {"System Manager", "Operations Control Room"}
_ADMIN_ROLES = {"System Manager"}
_DASHBOARD_ROLES = _SYNC_ROLES | {"Management", "PCB Team Leader", "Account Manager"}


def _require_dashboard_permission():
	user_roles = set(frappe.get_roles(frappe.session.user))
	if not user_roles & _DASHBOARD_ROLES:
		frappe.throw(
			_("You do not have permission to view seal dashboard data."),
			frappe.PermissionError,
		)


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
			_("Only System Manager can test the API connection."),
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
	if rec.get("branch"):
		upd["api_branch"] = str(rec["branch"])[:140]
	lock_status = normalize_elock_status(rec.get("elock"))
	if lock_status:
		upd["lock_status"] = lock_status

	frappe.db.set_value("Seal Device", device_name, upd)
	frappe.db.commit()

	_auto_detect_warehouse_custody(device_name, rec)


# Seal statuses where the seal is "resting" and not actively held by a
# technician/customer on a live journey. Only in these states do we let a GPS
# geofence match auto-assign the seal to a physical warehouse (custody stages
# 1 and 7). Mid-journey, the custodian is driven by workflow events instead.
_RESTING_STATUSES = {"Available", "Quality Check", "Untagged"}


def _auto_detect_warehouse_custody(device_name, rec):
	"""If an idle seal's GPS reading lands inside a known warehouse geofence,
	set its current custody to that warehouse. No-ops when the seal is mid-journey."""
	lat, lng = rec.get("latitude"), rec.get("longitude")
	if lat is None or lng is None or (lat == 0 and lng == 0):
		return

	info = frappe.db.get_value(
		"Seal Device",
		device_name,
		["current_status", "current_journey", "current_custody_type", "current_custodian"],
		as_dict=True,
	)
	if not info:
		return
	if info.current_journey or info.current_status not in _RESTING_STATUSES:
		return

	from tnt_seal_management.tnt_seal_management.doctype.custody_point.custody_point import (
		find_nearest_custody_point,
	)
	from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
		set_seal_custody,
	)

	match = find_nearest_custody_point(lat, lng)
	if not match:
		return

	warehouse = match["custody_point"]
	if info.current_custody_type == "Custody Point" and info.current_custodian == warehouse:
		return  # already attributed to this warehouse

	set_seal_custody(
		device_name,
		"Custody Point",
		warehouse,
		remarks=f"Auto-detected at {warehouse} ({match['distance_meters']} m from GPS).",
	)


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
	if rec.get("branch"):
		upd["api_branch"] = str(rec["branch"])[:140]
	if rec.get("_raw"):
		upd["api_raw_response"] = json.dumps(rec["_raw"])[:5000]

	frappe.db.set_value("Seal Journey", journey_name, upd)
	frappe.db.commit()


def _apply_to_journey_request_seal(row_name, rec):
	"""Write normalised API record fields to a single Journey Request Seal row."""
	upd = {"api_last_update_time": now_datetime()}
	if rec.get("status"):
		upd["api_device_status"] = str(rec["status"])[:140]
	if rec.get("location"):
		upd["api_location"] = str(rec["location"])[:140]
	if rec.get("battery") is not None:
		upd["battery_level"] = str(rec["battery"])[:140]
	if rec.get("branch"):
		upd["api_branch"] = str(rec["branch"])[:140]
	lock_status = normalize_elock_status(rec.get("elock"))
	if lock_status:
		upd["lock_status"] = lock_status

	frappe.db.set_value("Journey Request Seal", row_name, upd)
	frappe.db.commit()


def _apply_to_journey_request_seals(journey_request_name, seal_device_name, rec):
	"""Apply a normalised API record to every row of this seal within a Journey Request."""
	rows = frappe.db.get_all(
		"Journey Request Seal",
		filters={
			"parent": journey_request_name,
			"parenttype": "Journey Request",
			"seal_device": seal_device_name,
		},
		pluck="name",
	)
	for row_name in rows:
		_apply_to_journey_request_seal(row_name, rec)


def _apply_to_seal_journey_seals(seal_journey_name, seal_device_name, rec):
	"""Apply a normalised API record to every row of this seal within a Seal Journey.

	The Seal Journey's ``journey_seals`` child reuses the Journey Request Seal
	doctype, distinguished by parenttype.
	"""
	rows = frappe.db.get_all(
		"Journey Request Seal",
		filters={
			"parent": seal_journey_name,
			"parenttype": "Seal Journey",
			"seal_device": seal_device_name,
		},
		pluck="name",
	)
	for row_name in rows:
		_apply_to_journey_request_seal(row_name, rec)
	_update_seal_journey_api_branch_summary(seal_journey_name)


def _update_seal_journey_api_branch_summary(seal_journey_name):
	"""Set the journey branch only when every seal row has the same API branch."""
	rows = frappe.db.get_all(
		"Journey Request Seal",
		filters={"parent": seal_journey_name, "parenttype": "Seal Journey"},
		fields=["api_branch"],
	)
	branches = {(r.api_branch or "").strip() for r in rows if (r.api_branch or "").strip()}
	branch = next(iter(branches)) if rows and len(branches) == 1 and len(branches) == len(rows) else ""
	frappe.db.set_value("Seal Journey", seal_journey_name, "api_branch", branch)


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


@frappe.whitelist()
def import_devices_from_api():
	"""
	Pull live data from the Seal Server and create Seal Device records for any
	IMEI that does not already exist in the database.
	Returns a summary dict: created, skipped, errors.
	"""
	_require_admin_permission()

	raw = get_live_data(sync_type="Manual Device Sync")
	records = normalize_live_data_response(raw)

	# Build set of existing IMEIs for fast lookup
	existing = {
		r["imei_number"]
		for r in frappe.db.get_all("Seal Device", fields=["imei_number"])
		if r.get("imei_number")
	}

	created, skipped, errors = [], [], []

	for rec in records:
		imei = str(rec.get("imei") or "").strip()
		if not imei:
			continue

		if imei in existing:
			skipped.append(imei)
			continue

		plate = _clean_plate(rec.get("vehicle_no") or "", imei)

		try:
			doc = frappe.get_doc({
				"doctype": "Seal Device",
				"seal_number": imei,
				"device_id": imei,
				"imei_number": imei,
				"seal_type": "E-Lock",
				"current_status": "Available",
				"condition": "Good",
				"current_vehicle": plate or None,
				"current_location": str(rec.get("location") or "")[:140] or None,
				"last_known_api_location": str(rec.get("location") or "")[:140] or None,
				"last_api_status": str(rec.get("status") or "")[:140] or None,
				"api_branch": str(rec.get("branch") or "")[:140] or None,
				"lock_status": normalize_elock_status(rec.get("elock")) or None,
				"latitude": rec.get("latitude"),
				"longitude": rec.get("longitude"),
				"speed": rec.get("speed"),
				"battery_level": str(rec.get("battery") or "")[:140] or None,
				"last_successful_sync_time": now_datetime(),
				"raw_api_response": json.dumps(rec.get("_raw", {}))[:5000],
			})
			doc.insert(ignore_permissions=True)
			existing.add(imei)
			created.append(imei)
		except Exception as exc:
			errors.append({"imei": imei, "error": str(exc)[:200]})

	frappe.db.commit()

	return {
		"created": len(created),
		"skipped": len(skipped),
		"errors": len(errors),
		"error_details": errors[:20],
		"created_imeis": created[:50],
	}


def _clean_plate(vehicle_no, imei):
	"""
	Strip the IMEI suffix that Uffizio appends to vehicle plate numbers.
	Handles all separator variants the API produces:
	  'KBZ 803T/ZD 1789-7591116502'   →  'KBZ 803T/ZD 1789'
	  'KBW 964C - 790104002221'        →  'KBW 964C'
	  'UA 568DZ-74225280002'           →  'UA 568DZ'   (leading digit before IMEI)
	  'UBB 663Y-14225280007'           →  'UBB 663Y'
	  '7591114066'                     →  ''  (no vehicle)
	  '-7591114007'                    →  ''  (no vehicle)
	"""
	import re as _re
	if not vehicle_no:
		return ""
	vn = vehicle_no.strip()
	if vn == imei or vn.lstrip(" -") == imei:
		return ""
	# Regex: separator chars (space/dash/slash) optionally followed by one
	# extra digit (some Uffizio instances prepend a digit to the IMEI in the
	# vehicle_no string), then the IMEI itself, at end of string.
	pattern = _re.compile(r"\s*[-_/]+\s*\d?" + _re.escape(imei) + r"$")
	plate = pattern.sub("", vn).rstrip(" -_/")
	if plate and plate != vn:
		return plate
	# Fallback: plain endswith strip
	if vn.endswith(imei):
		return vn[: -len(imei)].rstrip(" -_/") or ""
	return vn


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
