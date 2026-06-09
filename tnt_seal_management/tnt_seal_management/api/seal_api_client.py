# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Uffizio Tracking API client for the Seal Journey Management System.

Token flow:
  1. POST  <base_url>/webservice?token=generateAccessToken
     Body:  {"username": ..., "password": ...}
     Returns: {"token": "<session_token>"}

  2. POST  <base_url>/webservice?token=getTokenBaseLiveData&ProjectId=<id>
     Header: auth-code: <session_token>
     Body:  {"company_names": ..., "vehicle_nos": ..., "imei_nos": ..., "format": "json"}
"""

import json
import time

import frappe
import requests
from frappe import _
from frappe.utils import get_datetime, now_datetime
from frappe.utils.password import get_decrypted_password, set_encrypted_password

_SETTINGS_DOCTYPE = "Seal API Settings"
_SETTINGS_NAME = "Seal API Settings"
_SYNC_LOG_DOCTYPE = "Seal API Sync Log"


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

def get_api_settings():
	"""
	Load Seal API Settings and validate that required fields are present.
	Returns (settings_doc, plaintext_password).
	Raises frappe.ValidationError if the API is disabled or config is incomplete.
	"""
	settings = frappe.get_single(_SETTINGS_DOCTYPE)

	if not settings.enabled:
		frappe.throw(
			_("Seal API is not enabled. Enable it in Seal API Settings before syncing."),
			title=_("API Disabled"),
		)

	missing = []
	if not settings.api_base_url:
		missing.append("API Base URL")
	if not settings.username:
		missing.append("Username")
	if not settings.project_id:
		missing.append("Project ID")
	if not settings.company_name:
		missing.append("Company Name")

	password = get_decrypted_password(
		_SETTINGS_DOCTYPE, _SETTINGS_NAME, "password", raise_exception=False
	)

	# Password is optional when a pre-issued token (current_auth_code) is stored directly.
	if not password:
		cached = get_decrypted_password(
			_SETTINGS_DOCTYPE, _SETTINGS_NAME, "current_auth_code", raise_exception=False
		)
		if not cached:
			missing.append("Password (or pre-issued Access Token in current_auth_code)")

	if missing:
		frappe.throw(
			_("Seal API Settings incomplete. Missing: {0}").format(", ".join(missing)),
			title=_("Configuration Error"),
		)

	return settings, password


# ---------------------------------------------------------------------------
# Rate-limit protection
# ---------------------------------------------------------------------------

def respect_rate_limit(settings=None):
	"""
	Enforce minimum_request_gap_seconds between consecutive API calls.
	Updates last_request_time after waiting.
	"""
	if settings is None:
		settings = frappe.get_single(_SETTINGS_DOCTYPE)

	min_gap = int(settings.minimum_request_gap_seconds or 10)
	last_req = settings.last_request_time

	if last_req:
		elapsed = (get_datetime(now_datetime()) - get_datetime(last_req)).total_seconds()
		if elapsed < min_gap:
			wait = min_gap - elapsed
			if wait > 0:
				time.sleep(wait)

	frappe.db.set_value(_SETTINGS_DOCTYPE, _SETTINGS_NAME, "last_request_time", now_datetime())
	frappe.db.commit()


# ---------------------------------------------------------------------------
# Token management
# ---------------------------------------------------------------------------

def generate_access_token(force=False):
	"""
	POST to generateAccessToken endpoint.
	Stores the returned token (encrypted) and timestamp in Seal API Settings.
	Creates a Seal API Sync Log entry.
	Returns the plain-text token.
	"""
	settings, password = get_api_settings()

	base_url = settings.api_base_url.rstrip("/")
	url = f"{base_url}/webservice?token=generateAccessToken"

	log = {
		"doctype": _SYNC_LOG_DOCTYPE,
		"sync_type": "Token Generation",
		"sync_started_at": now_datetime(),
		"request_url": url,
		# Never log the real password
		"request_body": json.dumps({"username": settings.username, "password": "***REDACTED***"}),
	}

	try:
		resp = requests.post(
			url,
			json={"username": settings.username, "password": password},
			headers={"Content-Type": "application/json"},
			timeout=30,
		)

		log["http_status_code"] = resp.status_code
		log["sync_completed_at"] = now_datetime()

		if resp.status_code != 200:
			raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")

		data = resp.json()
		# Redact token from log — store only a hint that it was received
		log["response_body"] = '{"token": "***RECEIVED***"}'

		token = _extract_token(data)
		if not token:
			err = (
				data.get("message")
				or data.get("Message")
				or data.get("error")
				or "Token not found in response"
			)
			raise RuntimeError(f"Token generation failed: {err}")

		# Persist encrypted token + timestamp
		# set_encrypted_password(doctype, name, pwd, fieldname) — pwd before fieldname
		set_encrypted_password(_SETTINGS_DOCTYPE, _SETTINGS_NAME, token, "current_auth_code")
		frappe.db.set_value(
			_SETTINGS_DOCTYPE,
			_SETTINGS_NAME,
			"token_generated_at",
			now_datetime(),
		)
		frappe.db.commit()

		log["sync_status"] = "Success"
		log["remarks"] = "Token generated and cached"

	except Exception as exc:
		log["sync_status"] = "Failed"
		log["error_message"] = str(exc)
		log["sync_completed_at"] = now_datetime()

		frappe.db.set_value(
			_SETTINGS_DOCTYPE,
			_SETTINGS_NAME,
			{
				"last_failed_sync_time": now_datetime(),
				"last_error_message": str(exc)[:500],
			},
		)
		frappe.db.commit()
		_save_sync_log(log)
		raise

	_save_sync_log(log)
	return token


def get_cached_token():
	"""
	Return the cached session token, regenerating it if missing or expired.
	Note: Password fields return empty from get_single(), so we check
	token_generated_at for age and use get_decrypted_password() for the value.
	"""
	settings = frappe.get_single(_SETTINGS_DOCTYPE)
	ttl = int(settings.token_ttl_minutes or 55)

	if settings.token_generated_at:
		age_minutes = (
			get_datetime(now_datetime()) - get_datetime(settings.token_generated_at)
		).total_seconds() / 60
		if age_minutes < ttl:
			token = get_decrypted_password(
				_SETTINGS_DOCTYPE, _SETTINGS_NAME, "current_auth_code", raise_exception=False
			)
			if token:
				return token

	return generate_access_token(force=True)


# ---------------------------------------------------------------------------
# Live data call
# ---------------------------------------------------------------------------

def get_live_data(vehicle_nos=None, imei_nos=None, force_token_refresh=False):
	"""
	POST to getTokenBaseLiveData endpoint.
	Handles token expiry by retrying once with a fresh token.
	Returns the parsed JSON response.
	Creates a Seal API Sync Log entry.
	"""
	settings, _ = get_api_settings()

	token = generate_access_token(force=True) if force_token_refresh else get_cached_token()

	respect_rate_limit(settings)

	base_url = settings.api_base_url.rstrip("/")
	project_id = settings.project_id
	url = f"{base_url}/webservice?token=getTokenBaseLiveData&ProjectId={project_id}"

	payload = {
		"company_names": settings.company_name,
		"format": "json",
	}

	if vehicle_nos:
		payload["vehicle_nos"] = (
			vehicle_nos if isinstance(vehicle_nos, str) else ",".join(str(v) for v in vehicle_nos)
		)
	if imei_nos:
		payload["imei_nos"] = (
			imei_nos if isinstance(imei_nos, str) else ",".join(str(i) for i in imei_nos)
		)

	log = {
		"doctype": _SYNC_LOG_DOCTYPE,
		"sync_type": "Manual Device Sync",
		"sync_started_at": now_datetime(),
		"request_url": url,
		# auth-code header is redacted
		"request_body": json.dumps({**payload, "_auth_header": "***REDACTED***"}),
	}

	headers = {
		"auth-code": token,
		"Content-Type": "application/json",
	}

	try:
		resp = requests.post(url, json=payload, headers=headers, timeout=30)

		log["http_status_code"] = resp.status_code
		log["sync_completed_at"] = now_datetime()

		# Token expired — retry once
		if resp.status_code in (401, 403) and not force_token_refresh:
			_save_sync_log({**log, "sync_status": "Failed", "error_message": f"HTTP {resp.status_code} — retrying with fresh token"})
			return get_live_data(vehicle_nos=vehicle_nos, imei_nos=imei_nos, force_token_refresh=True)

		if resp.status_code != 200:
			raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")

		data = resp.json()
		log["response_body"] = json.dumps(data)[:5000]

		# API-level error inside a 200 response
		api_error = _extract_api_error(data)
		if api_error:
			if "token" in api_error.lower() and not force_token_refresh:
				_save_sync_log({**log, "sync_status": "Failed", "error_message": api_error + " — retrying"})
				return get_live_data(vehicle_nos=vehicle_nos, imei_nos=imei_nos, force_token_refresh=True)
			raise RuntimeError(f"API error: {api_error}")

		log["sync_status"] = "Success"

		frappe.db.set_value(
			_SETTINGS_DOCTYPE,
			_SETTINGS_NAME,
			{"last_successful_sync_time": now_datetime(), "last_sync_date_time": now_datetime()},
		)
		frappe.db.commit()

	except Exception as exc:
		log["sync_status"] = "Failed"
		log["error_message"] = str(exc)
		log["sync_completed_at"] = now_datetime()

		frappe.db.set_value(
			_SETTINGS_DOCTYPE,
			_SETTINGS_NAME,
			{"last_failed_sync_time": now_datetime(), "last_error_message": str(exc)[:500]},
		)
		frappe.db.commit()
		_save_sync_log(log)
		raise

	_save_sync_log(log)
	return data


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _extract_token(data):
	"""Try multiple shapes for the token field."""
	if isinstance(data, str) and len(data) > 10:
		return data
	if isinstance(data, dict):
		return (
			data.get("token")
			or data.get("access_token")
			or (data.get("data") or {}).get("token")
			or (data.get("data") or {}).get("access_token")
		)
	return None


def _extract_api_error(data):
	"""Return API-level error string, or None if success."""
	if not isinstance(data, dict):
		return None
	err = data.get("error") or data.get("Error")
	if err:
		return str(err)
	root = data.get("root")
	if isinstance(root, dict):
		return root.get("error") or root.get("Error")
	return None


def _save_sync_log(data):
	"""Persist a Seal API Sync Log record, swallowing any write errors."""
	try:
		doc = frappe.get_doc(data)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception as exc:
		frappe.log_error(f"Seal API Sync Log write failed: {exc}", "Seal API Log Error")
