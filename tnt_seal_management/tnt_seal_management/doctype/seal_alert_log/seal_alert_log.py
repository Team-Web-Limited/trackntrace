# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, format_datetime, now_datetime


class SealAlertLog(Document):
	pass


_RESOLUTION_STATUSES = ("Escalated", "Resolved")


@frappe.whitelist()
def acknowledge_alert(docname, status=None, remarks=None):
	"""Acknowledge an alert and set its resolution status.

	status: "Escalated" (acknowledged, further action still needed) or
	"Resolved" (handled). Re-submitting is allowed to progress an alert from
	Escalated -> Resolved, but a Resolved alert is locked.
	"""
	status = (status or "").strip().title()
	if status not in _RESOLUTION_STATUSES:
		frappe.throw(
			_("Select a resolution status: Escalated or Resolved."),
			title=_("Status Required"),
		)

	doc = frappe.get_doc("Seal Alert Log", docname)
	doc.check_permission("write")
	if doc.resolution_status == "Resolved":
		frappe.throw(_("This alert has already been resolved."), title=_("Already Resolved"))

	doc.resolution_status = status
	doc.acknowledged = 1
	doc.acknowledged_by = frappe.session.user
	doc.acknowledged_at = now_datetime()
	doc.acknowledgement_remarks = (remarks or "").strip() or None

	# A human "Resolved" closes the alert (telemetry only auto-resolves Battery,
	# so Security/Connectivity rely on this). "Escalated" keeps it open so it
	# stays in the Control Room's Open queue until someone finishes the job.
	if status == "Resolved":
		doc.is_resolved = 1
		if not doc.resolved_at:
			doc.resolved_at = now_datetime()

	doc.save()
	frappe.db.commit()


# Where to find an email address for each kind of custodian a seal can sit
# with. Custody Point and PCB Job Order hold no contact of their own, so a seal
# resting at one has nobody to notify.
def _custodian_email(custody_type, custodian):
	if custody_type == "Customer":
		return _customer_email(custodian)
	if custody_type == "Warehouse":
		return frappe.db.get_value("Warehouse", custodian, "email_id")
	if custody_type == "User":
		return frappe.db.get_value("User", custodian, "email") or custodian
	return None


def _customer_email(customer):
	"""Customer's own email if set, else the email on their primary (or any
	linked) Contact."""
	email = frappe.db.get_value("Customer", customer, "email_id")
	if email:
		return email

	primary_contact = frappe.db.get_value("Customer", customer, "customer_primary_contact")
	if primary_contact:
		email = frappe.db.get_value("Contact", primary_contact, "email_id")
		if email:
			return email

	rows = frappe.db.sql(
		"""
		select c.email_id
		from `tabContact` c
		join `tabDynamic Link` dl on dl.parent = c.name and dl.parenttype = 'Contact'
		where dl.link_doctype = 'Customer' and dl.link_name = %s and ifnull(c.email_id, '') != ''
		order by c.is_primary_contact desc, c.modified desc
		limit 1
		""",
		customer,
	)
	return rows[0][0] if rows else None


def alert_notification_target(seal_device):
	"""Who a critical alert about this seal should go to — whoever is holding it
	right now, per the seal's live custody pointer. Returns an empty dict when
	the seal has no custodian, and an entry with no ``email`` when the custodian
	is known but has no address on file."""
	if not seal_device:
		return {}

	info = frappe.db.get_value(
		"Seal Device",
		seal_device,
		["current_custody_type", "current_custodian", "current_custody_label"],
		as_dict=True,
	)
	if not info or not info.current_custody_type or not info.current_custodian:
		return {}

	return {
		"custody_type": info.current_custody_type,
		"custodian": info.current_custodian,
		"label": info.current_custody_label or info.current_custodian,
		"email": _custodian_email(info.current_custody_type, info.current_custodian),
	}


@frappe.whitelist()
def notify_alert_custodian(docname, remarks=None):
	"""Email a critical alert to whoever is currently holding the seal.

	Sent as a Communication against the alert, so the Control Room keeps an
	audit trail of what was sent and to whom.
	"""
	doc = frappe.get_doc("Seal Alert Log", docname)
	doc.check_permission("write")

	if cstr(doc.level) != "Critical":
		frappe.throw(
			_("Only critical alerts can be sent to the seal's custodian."),
			title=_("Critical Alerts Only"),
		)

	target = alert_notification_target(doc.seal_device)
	if not target:
		frappe.throw(
			_("Seal {0} has no current custodian to notify.").format(doc.seal_device or "—"),
			title=_("No Custodian"),
		)
	if not target.get("email"):
		frappe.throw(
			_("{0} has no email address on file, so this alert cannot be sent.").format(
				target.get("label")
			),
			title=_("No Email Address"),
		)

	location = ""
	if doc.seal_device:
		location = (
			frappe.db.get_value("Seal Device", doc.seal_device, "last_known_api_location")
			or frappe.db.get_value("Seal Device", doc.seal_device, "current_location")
			or ""
		)

	details = [
		(_("Alert"), doc.message),
		(_("Seal"), doc.seal_device),
		(_("Journey"), doc.seal_journey),
		(_("Occurred at"), format_datetime(doc.occurred_at) if doc.occurred_at else None),
		(_("Last known location"), location),
		(_("Remarks"), cstr(remarks).strip() or None),
	]
	rows = "".join(
		f"<tr><th align='left' style='padding:4px 12px 4px 0'>{label}</th><td>{frappe.utils.escape_html(cstr(value))}</td></tr>"
		for label, value in details
		if value
	)
	message = f"""
		<p>{_("A critical alert has been raised on a seal currently in your custody.")}</p>
		<table>{rows}</table>
		<p>{_("Please contact the TNT Control Room immediately.")}</p>
	"""

	frappe.sendmail(
		recipients=[target["email"]],
		subject=_("Critical seal alert: {0}").format(doc.message or doc.name),
		message=message,
		reference_doctype="Seal Alert Log",
		reference_name=doc.name,
	)

	return {"email": target["email"], "label": target["label"]}


@frappe.whitelist()
def get_alert_queue(
	search=None, level=None, alert_type=None, status="open",
	from_date=None, to_date=None, page=1, page_length=30,
):
	"""Return Seal Alert Log rows for the Control Room Alert tab.

	status: "open" (unresolved, default) | "resolved" | "all"
	Honours Seal Alert Log permissions via frappe.get_list, so Operations
	Control Room sees the full queue (read permission, no owner restriction).
	"""
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	filters = []
	if status == "open":
		filters.append(["is_resolved", "=", 0])
	elif status == "resolved":
		filters.append(["is_resolved", "=", 1])

	if level and level != "all":
		filters.append(["level", "=", level])
	if alert_type and alert_type != "all":
		filters.append(["alert_type", "=", alert_type])
	if from_date:
		filters.append(["occurred_at", ">=", f"{from_date} 00:00:00"])
	if to_date:
		filters.append(["occurred_at", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		like = f"%{search}%"
		or_filters = [
			["name", "like", like],
			["seal_device", "like", like],
			["seal_journey", "like", like],
			["journey_request", "like", like],
			["message", "like", like],
		]

	fields = [
		"name", "alert_source", "alert_type", "level", "message",
		"seal_device", "seal_journey", "journey_request",
		"occurred_at", "is_resolved", "resolved_at",
		"resolution_status",
		"acknowledged", "acknowledged_by", "acknowledged_at", "acknowledgement_remarks",
	]

	rows = frappe.get_list(
		"Seal Alert Log",
		fields=fields,
		filters=filters,
		or_filters=or_filters or None,
		order_by="occurred_at desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	# Attach the seal's last-known location to each row (the alert log doesn't
	# store it; it lives on the Seal Device).
	device_names = list({r["seal_device"] for r in rows if r.get("seal_device")})
	loc_map = {}
	if device_names:
		for d in frappe.get_all(
			"Seal Device",
			filters={"name": ["in", device_names]},
			fields=["name", "last_known_api_location", "current_location"],
		):
			loc_map[d.name] = d.last_known_api_location or d.current_location or ""
	for r in rows:
		r["seal_location"] = loc_map.get(r.get("seal_device"), "")

	# Critical alerts can be emailed to whoever is holding the seal, so the
	# Control Room needs to know who that is before opening the dialog.
	target_cache = {}
	for r in rows:
		if r.get("level") != "Critical" or not r.get("seal_device"):
			continue
		device = r["seal_device"]
		if device not in target_cache:
			target_cache[device] = alert_notification_target(device)
		r["notify_target"] = target_cache[device]

	total = len(
		frappe.get_list(
			"Seal Alert Log", fields=["name"], filters=filters,
			or_filters=or_filters or None, limit_page_length=0,
		)
	)
	filter_options = {
		"levels": [row[0] for row in frappe.db.sql(
			"""
			select distinct level
			from `tabSeal Alert Log`
			where ifnull(level, '') != ''
			order by level asc
			""",
			as_list=True,
		)],
		"types": [row[0] for row in frappe.db.sql(
			"""
			select distinct alert_type
			from `tabSeal Alert Log`
			where ifnull(alert_type, '') != ''
			order by alert_type asc
			""",
			as_list=True,
		)],
	}

	summary = {
		"open": frappe.db.count("Seal Alert Log", filters={"is_resolved": 0}),
		"critical_open": frappe.db.count("Seal Alert Log", filters={"is_resolved": 0, "level": "Critical"}),
		"unacknowledged_open": frappe.db.count(
			"Seal Alert Log", filters={"is_resolved": 0, "acknowledged": 0}
		),
	}

	return {
		"rows": rows,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
		"filter_options": filter_options,
		"message_groups": open_alert_message_groups(),
	}


# Alert messages carry a per-device detail — "Low battery (5%)", "No update for
# 40486 min" — so grouping on the raw text would give one bucket per reading.
# Cutting at the first digit collapses them onto the stem an operator reads as
# the problem: "Low battery", "No update", "Device offline".
_GROUP_TRAILING_WORDS = {"for", "at", "of", "in", "to", "after", "since", "is", "was"}
_LEVEL_RANK = {"Critical": 3, "Warning": 2, "Info": 1}


def alert_message_group(message):
	"""Collapse an alert message to the label its group is shown under."""
	text = cstr(message).strip()
	if not text:
		return _("Other")

	head = re.split(r"\d", text, maxsplit=1)[0]
	words = head.strip(" -—:,.;(").split()
	while words and words[-1].lower() in _GROUP_TRAILING_WORDS:
		words.pop()
	return " ".join(words) or text


def open_alert_message_groups():
	"""Counts of open alerts per message group, worst level first, for the
	Control Room's information pills. Each group's ``label`` is also what the
	alert search matches on, so a pill can filter the queue to its own alerts."""
	rows = frappe.db.sql(
		"""
		select message, level, count(*) as count
		from `tabSeal Alert Log`
		where is_resolved = 0
		group by message, level
		""",
		as_dict=True,
	)

	groups = {}
	for row in rows:
		label = alert_message_group(row.message)
		group = groups.setdefault(label, {"label": label, "count": 0, "level": None})
		group["count"] += row.count
		if _LEVEL_RANK.get(row.level, 0) > _LEVEL_RANK.get(group["level"], 0):
			group["level"] = row.level

	return sorted(groups.values(), key=lambda g: (-_LEVEL_RANK.get(g["level"], 0), -g["count"]))
