# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, format_datetime, now_datetime, today

from tnt_seal_management.tnt_seal_management.api.seal_sync import _get_tnt_logo_img_tag


class SealAlertLog(Document):
	pass


_RESOLUTION_STATUSES = ("Escalated", "Resolved")


@frappe.whitelist()
def acknowledge_alert(
	docname, status=None, remarks=None, send_email=0, recipients=None, cc=None, subject=None, message=None
):
	"""Acknowledge an alert and set its resolution status.

	status: "Escalated" (acknowledged, further action still needed) or
	"Resolved" (handled). Re-submitting is allowed to progress an alert from
	Escalated -> Resolved, but a Resolved alert is locked.

	When escalating, the Control Room can email the alert straight from the
	Action dialog (``send_email`` with ``recipients``/``cc``/``subject``/
	``message``). It goes out as a Communication on the alert, so it shows in the
	alert's timeline and the Email Queue. The email is validated before anything
	is saved, so a bad address never leaves the alert half-escalated.
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

	email = None
	if status == "Escalated" and cint(send_email):
		email = _validated_escalation_email(recipients, cc, subject, message)

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

	if email:
		note = _("Escalation email sent to {0}").format(", ".join(email["recipients"] + email["cc"]))
		doc.acknowledgement_remarks = "\n".join(filter(None, [doc.acknowledgement_remarks, note]))

	doc.save()

	result = {"resolution_status": doc.resolution_status}
	if email:
		from frappe.core.doctype.communication.email import make

		comm = make(
			doctype="Seal Alert Log",
			name=doc.name,
			subject=email["subject"],
			content=email["message"],
			recipients=", ".join(email["recipients"]),
			cc=", ".join(email["cc"]) or None,
			communication_medium="Email",
			send_email=True,
		)
		result["email"] = {"communication": comm.get("name"), "recipients": email["recipients"], "cc": email["cc"]}

	frappe.db.commit()
	return result


def _split_emails(value):
	return [e.strip() for e in re.split(r"[,;\s]+", cstr(value)) if e.strip()]


def _validated_escalation_email(recipients, cc, subject, message):
	to = _split_emails(recipients)
	copy = _split_emails(cc)
	if not to:
		frappe.throw(_("Enter at least one recipient for the escalation email."), title=_("Recipient Required"))
	bad = [e for e in to + copy if not frappe.utils.validate_email_address(e)]
	if bad:
		frappe.throw(
			_("Not a valid email address: {0}").format(", ".join(bad)), title=_("Invalid Email Address")
		)
	if not cstr(subject).strip():
		frappe.throw(_("Enter a subject for the escalation email."), title=_("Subject Required"))
	if not frappe.utils.strip_html(cstr(message)).strip():
		frappe.throw(_("Enter a message for the escalation email."), title=_("Message Required"))
	return {"recipients": to, "cc": copy, "subject": cstr(subject).strip(), "message": cstr(message)}


@frappe.whitelist()
def get_escalation_email(docname):
	"""Draft escalation email for the Action dialog: addressed to whoever holds
	the seal right now (when they have an email on file) and filled with the
	alert's details. The Control Room edits it before sending."""
	doc = frappe.get_doc("Seal Alert Log", docname)
	doc.check_permission("read")

	row = {"seal_device": doc.seal_device, "seal_journey": doc.seal_journey}
	_attach_alert_locations([row])
	target = alert_notification_target(doc.seal_device, doc.seal_journey)

	details = [
		(_("Alert"), doc.message),
		(_("Level"), doc.level),
		(_("Type"), doc.alert_type),
		(_("Client"), row.get("client_name")),
		(_("Vehicle"), row.get("vehicle")),
		(_("Seal"), doc.seal_device),
		(_("Journey"), doc.seal_journey),
		(_("Last known location"), row.get("seal_location")),
		(_("Occurred at"), format_datetime(doc.occurred_at) if doc.occurred_at else None),
	]
	table = "".join(
		f"<tr><th align='left' style='padding:4px 12px 4px 0'>{label}</th><td>{frappe.utils.escape_html(cstr(value))}</td></tr>"
		for label, value in details
		if value
	)
	message = (
		f"<p>{_('Dear Sir/Madam,')}</p>"
		f"<p>{_('The TNT Control Room has escalated the following seal alert and needs your urgent attention.')}</p>"
		f"<table>{table}</table>"
		f"<p>{_('Please contact the TNT Control Room as soon as possible.')}</p>"
	)
	plate = f" ({row.get('vehicle')})" if row.get("vehicle") else ""
	return {
		"recipients": target.get("email") or "",
		"recipient_label": target.get("label") or "",
		"subject": _("Escalated seal alert: {0} on seal {1}{2}").format(
			doc.alert_type or doc.level or _("Alert"), doc.seal_device or "—", plate
		),
		"message": message,
	}


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


def _team_lead_email(seal_device, seal_journey=None):
	"""(email, full name) of the PCB Team Leader responsible for this seal: the
	alert's own journey, else the seal's current journey, else the latest journey
	it was on. None when no team lead can be found or they have no address."""
	candidates = [seal_journey]
	candidates.append(frappe.db.get_value("Seal Device", seal_device, "current_journey"))
	candidates.append(
		frappe.db.get_value(
			"Seal Journey",
			{"assigned_seal": seal_device, "assigned_team_lead": ["is", "set"]},
			"name",
			order_by="creation desc",
		)
	)
	for journey in candidates:
		lead = journey and frappe.db.get_value("Seal Journey", journey, "assigned_team_lead")
		if not lead:
			continue
		user = frappe.db.get_value("User", lead, ["email", "full_name", "enabled"], as_dict=True)
		if user and user.enabled and (user.email or lead):
			return (user.email or lead), _("Team Leader {0}").format(user.full_name or lead)

	# No journey to read a team lead from (e.g. a seal that has only ever sat in
	# stock): fall back to everyone holding the PCB Team Leader role. The
	# Control Room reviews and edits the draft before it is sent.
	from tnt_seal_management.tnt_seal_management.api.notifications import get_users_with_role

	emails = sorted({email for _user, email in get_users_with_role("PCB Team Leader") if "@" in (email or "")})
	if emails:
		return ", ".join(emails), _("PCB Team Leaders")
	return None


def alert_notification_target(seal_device, seal_journey=None):
	"""Who a critical alert about this seal should go to — whoever is holding it
	right now, per the seal's live custody pointer. Returns an empty dict when
	the seal has no custodian, and an entry with no ``email`` when the custodian
	is known but has no address on file.

	A seal resting at a Custody Point has nobody to email there (Custody Points
	hold no contact), so the alert goes to the seal's PCB Team Leader instead."""
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

	label = info.current_custody_label or info.current_custodian
	email = _custodian_email(info.current_custody_type, info.current_custodian)
	if not email and info.current_custody_type == "Custody Point":
		lead = _team_lead_email(seal_device, seal_journey)
		if lead:
			email = lead[0]
			label = _("{0} (emailing {1})").format(label, lead[1])
	return {
		"custody_type": info.current_custody_type,
		"custodian": info.current_custodian,
		"label": label,
		"email": email,
	}


def in_transit_seal_devices():
	"""Seal Devices currently travelling: the assigned seal, or any seal in the
	seals table, of a Seal Journey that is In Transit. The Control Room's Alert
	tab only shows alerts for these units — alerts on seals sitting in stock,
	awaiting return or on finished journeys are left out."""
	return [
		row[0]
		for row in frappe.db.sql(
			"""
			select j.assigned_seal
			from `tabSeal Journey` j
			where j.journey_status = 'In Transit' and ifnull(j.assigned_seal, '') != ''
			union
			select s.seal_device
			from `tabJourney Request Seal` s
			inner join `tabSeal Journey` j on j.name = s.parent
			where s.parenttype = 'Seal Journey'
				and j.journey_status = 'In Transit'
				and ifnull(s.seal_device, '') != ''
			"""
		)
	]


def _build_alert_filters(search=None, level=None, alert_type=None, status="open", from_date=None, to_date=None):
	# Only units in transit — an empty list must still filter everything out.
	filters = [["seal_device", "in", in_transit_seal_devices() or [""]]]
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

	return filters, or_filters


def _attach_alert_locations(rows):
	device_names = list({r["seal_device"] for r in rows if r.get("seal_device")})
	loc_map = {}
	coord_map = {}
	if device_names:
		from tnt_seal_management.tnt_seal_management.api.journey_monitoring import _coords

		for d in frappe.get_all(
			"Seal Device",
			filters={"name": ["in", device_names]},
			fields=["name", "last_known_api_location", "current_location", "latitude", "longitude"],
		):
			loc_map[d.name] = d.last_known_api_location or d.current_location or ""
			coord_map[d.name] = _coords(d.latitude, d.longitude)
	for r in rows:
		r["seal_location"] = loc_map.get(r.get("seal_device"), "")
		r["latitude"], r["longitude"] = coord_map.get(r.get("seal_device"), (None, None))
	_attach_alert_journey_details(rows)


def _attach_alert_journey_details(rows):
	"""Client Name and Vehicle for each alert, from the In Transit Seal Journey its
	seal is currently on (the only alerts the Control Room shows); falls back to
	the journey the alert itself was raised against."""
	devices = list({r["seal_device"] for r in rows if r.get("seal_device")})
	by_device = {}
	if devices:
		for row in frappe.db.sql(
			"""
			select seal, customer, vehicle_plate_number from (
				select j.assigned_seal as seal, j.customer, j.vehicle_plate_number, j.modified
				from `tabSeal Journey` j
				where j.journey_status = 'In Transit' and j.assigned_seal in %(devices)s
				union all
				select s.seal_device, j.customer, j.vehicle_plate_number, j.modified
				from `tabJourney Request Seal` s
				inner join `tabSeal Journey` j on j.name = s.parent
				where s.parenttype = 'Seal Journey'
					and j.journey_status = 'In Transit'
					and s.seal_device in %(devices)s
			) t
			order by modified asc
			""",
			{"devices": tuple(devices)},
			as_dict=True,
		):
			by_device[row.seal] = row

	journeys = list({r["seal_journey"] for r in rows if r.get("seal_journey")})
	by_journey = {}
	if journeys:
		for row in frappe.get_all(
			"Seal Journey",
			filters={"name": ["in", journeys]},
			fields=["name", "customer", "vehicle_plate_number"],
		):
			by_journey[row.name] = row

	for r in rows:
		src = by_device.get(r.get("seal_device")) or by_journey.get(r.get("seal_journey")) or {}
		r["client_name"] = src.get("customer") or ""
		r["vehicle"] = src.get("vehicle_plate_number") or ""


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

	filters, or_filters = _build_alert_filters(search, level, alert_type, status, from_date, to_date)

	fields = [
		"name", "alert_source", "alert_type", "level", "message",
		"seal_device", "seal_journey", "journey_request",
		"occurred_at", "is_resolved", "resolved_at",
		"occurrence_count", "last_occurred_at", "source_alert_type",
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
	_attach_alert_locations(rows)

	# Critical alerts can be emailed to whoever is holding the seal, so the
	# Control Room needs to know who that is before opening the dialog.
	target_cache = {}
	for r in rows:
		if r.get("level") != "Critical" or not r.get("seal_device"):
			continue
		device = r["seal_device"]
		if device not in target_cache:
			target_cache[device] = alert_notification_target(device, r.get("seal_journey"))
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

	in_transit = ["in", in_transit_seal_devices() or [""]]
	summary = {
		"open": frappe.db.count("Seal Alert Log", filters={"is_resolved": 0, "seal_device": in_transit}),
		"critical_open": frappe.db.count(
			"Seal Alert Log", filters={"is_resolved": 0, "level": "Critical", "seal_device": in_transit}
		),
		"unacknowledged_open": frappe.db.count(
			"Seal Alert Log", filters={"is_resolved": 0, "acknowledged": 0, "seal_device": in_transit}
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
		"type_groups": open_alert_type_groups(),
	}


@frappe.whitelist()
def get_all_alerts_for_export(search=None, level=None, alert_type=None, status="open", from_date=None, to_date=None):
	"""Same filters as get_alert_queue but unpaginated, for the PDF export.
	Honours Seal Alert Log permissions via frappe.get_list, same as get_alert_queue."""
	filters, or_filters = _build_alert_filters(search, level, alert_type, status, from_date, to_date)

	fields = [
		"name", "alert_type", "level", "message",
		"seal_device", "seal_journey", "occurred_at", "is_resolved", "resolution_status",
	]

	rows = frappe.get_list(
		"Seal Alert Log",
		fields=fields,
		filters=filters,
		or_filters=or_filters or None,
		order_by="occurred_at desc",
		limit_page_length=0,
	)
	_attach_alert_locations(rows)
	return rows


_EXPORT_ROLES = {"System Manager", "Operations Control Room", "Management", "Managing Director"}


@frappe.whitelist()
def export_pdf(html, filename):
	"""Render the Control Room Alert tab's currently filtered table (built
	client-side, same approach as the Seal Device Dashboard's export) to a PDF."""
	from frappe.utils.pdf import get_pdf

	_check_export_permission()

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


# (label, fieldname, column width) — same columns the PDF report shows.
_EXPORT_COLUMNS = (
	("Level", "level", 14),
	("Type", "alert_type", 22),
	("Message", "message", 40),
	("Client Name", "client_name", 28),
	("Vehicle", "vehicle", 16),
	("Seal", "seal_device", 20),
	("Location", "seal_location", 26),
	("Occurred At", "occurred_at", 20),
	("Resolution", "_resolution", 16),
)


@frappe.whitelist()
def export_excel(search=None, level=None, alert_type=None, status="open", from_date=None, to_date=None, filename=None):
	"""Render the Control Room Alert tab's currently filtered rows to an .xlsx
	workbook — the spreadsheet counterpart of export_pdf."""
	from frappe.utils.xlsxutils import make_xlsx

	_check_export_permission()

	alerts = get_all_alerts_for_export(search, level, alert_type, status, from_date, to_date)
	if not alerts:
		frappe.throw(_("No alerts match the current filters."))

	data = [[_(label) for label, fieldname, width in _EXPORT_COLUMNS]]
	for alert in alerts:
		resolution = "Resolved" if alert.get("is_resolved") else (
			"Escalated" if alert.get("resolution_status") == "Escalated" else "Open"
		)
		row = []
		for label, fieldname, width in _EXPORT_COLUMNS:
			value = resolution if fieldname == "_resolution" else alert.get(fieldname)
			if fieldname == "occurred_at" and value:
				value = frappe.utils.get_datetime(value).strftime("%Y-%m-%d %H:%M:%S")
			row.append(cstr(value) if value not in (None, "") else "")
		data.append(row)

	xlsx_file = make_xlsx(
		data,
		"Seal Alerts",
		column_widths=[width for label, fieldname, width in _EXPORT_COLUMNS],
	)

	filename = filename or f"Seal Alert Report - {today()}"
	frappe.local.response.filename = f"{filename}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"


def _check_export_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _EXPORT_ROLES:
		frappe.throw(
			_("You do not have permission to export seal alerts."),
			frappe.PermissionError,
		)


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


def open_alert_type_groups():
	"""Counts of open alerts per alert type (the Alert tab's Type filter), worst
	level first, for the Control Room's pills. Units in transit only."""
	devices = in_transit_seal_devices()
	if not devices:
		return []
	rows = frappe.db.sql(
		"""
		select alert_type, level, count(*) as count
		from `tabSeal Alert Log`
		where is_resolved = 0 and ifnull(alert_type, '') != '' and seal_device in %(devices)s
		group by alert_type, level
		""",
		{"devices": tuple(devices)},
		as_dict=True,
	)

	groups = {}
	for row in rows:
		group = groups.setdefault(row.alert_type, {"label": row.alert_type, "count": 0, "level": None})
		group["count"] += row.count
		if _LEVEL_RANK.get(row.level, 0) > _LEVEL_RANK.get(group["level"], 0):
			group["level"] = row.level

	return sorted(groups.values(), key=lambda g: (-_LEVEL_RANK.get(g["level"], 0), -g["count"]))


def open_alert_message_groups():
	"""Counts of open alerts per message group, worst level first, for the
	Control Room's information pills. Each group's ``label`` is also what the
	alert search matches on, so a pill can filter the queue to its own alerts.
	Units in transit only, matching the Alert tab."""
	devices = in_transit_seal_devices()
	if not devices:
		return []
	rows = frappe.db.sql(
		"""
		select message, level, count(*) as count
		from `tabSeal Alert Log`
		where is_resolved = 0 and seal_device in %(devices)s
		group by message, level
		""",
		{"devices": tuple(devices)},
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
