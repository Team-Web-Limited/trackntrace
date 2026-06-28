# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, now_datetime


class SealAlertLog(Document):
	pass


_RESOLUTION_STATUSES = ("Underway", "Resolved")


@frappe.whitelist()
def acknowledge_alert(docname, status=None, remarks=None):
	"""Acknowledge an alert and set its resolution status.

	status: "Underway" (acknowledged, further action still needed) or
	"Resolved" (handled). Re-submitting is allowed to progress an alert from
	Underway -> Resolved, but a Resolved alert is locked.
	"""
	status = (status or "").strip().title()
	if status not in _RESOLUTION_STATUSES:
		frappe.throw(
			_("Select a resolution status: Underway or Resolved."),
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
	# so Security/Connectivity rely on this). "Underway" keeps it open so it
	# stays in the Control Room's Open queue until someone finishes the job.
	if status == "Resolved":
		doc.is_resolved = 1
		if not doc.resolved_at:
			doc.resolved_at = now_datetime()

	doc.save()
	frappe.db.commit()


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
	}
