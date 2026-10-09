import frappe
from frappe.utils import now_datetime

_LEVEL_RANK = {"Info": 0, "Warning": 1, "Critical": 2}


_ACTIVE_JOURNEY_STATUSES = ("Ready for Journey", "In Transit")


def get_alert_mappings():
	"""{uffizio alert_id: [rows]} from Alert Type Mapping, rows with the longest
	match_text first so the most specific one wins in resolve_mapping."""
	rows = frappe.get_all(
		"Alert Type Mapping",
		fields=["alert_id", "match_text", "category", "level", "ignore", "journey_only", "as_milestone"],
	)
	out = {}
	for r in rows:
		r.match_text = (r.match_text or "").strip().lower()
		out.setdefault(str(r.alert_id), []).append(r)
	for lst in out.values():
		lst.sort(key=lambda r: len(r.match_text), reverse=True)
	return out


def resolve_mapping(mappings, alert_id, alert_info, journey_status=None):
	"""The mapping row for this alert, or None if unmapped. A ``journey_only`` row
	only applies while the seal's journey is Ready for Journey / In Transit;
	otherwise the alert is skipped (returned as an ignored pseudo-row)."""
	text = (alert_info or "").lower()
	for row in mappings.get(str(alert_id), []):
		if row.match_text and row.match_text not in text:
			continue
		if row.journey_only and journey_status not in _ACTIVE_JOURNEY_STATUSES:
			return frappe._dict(ignore=1)
		return row
	return None


def is_duplicate_source(source_alert_id, alert_source):
	"""True if this exact provider alert is already stored, either as an
	incident's first alert or as a later occurrence merged into one."""
	if not source_alert_id:
		return False
	if frappe.db.exists(
		"Seal Alert Log", {"source_alert_id": source_alert_id, "alert_source": alert_source}
	):
		return True
	return bool(
		frappe.db.exists(
			"Seal Alert Occurrence",
			{
				"source_alert_id": source_alert_id,
				"alert_source": alert_source,
				"parenttype": "Seal Alert Log",
			},
		)
	)


def record_alert(
	alert_source,
	category,
	level,
	message,
	seal_device,
	seal_journey=None,
	journey_request=None,
	occurred_at=None,
	source_alert_id=None,
	source_alert_type=None,
	uffizio_alert_id=None,
	raw_data=None,
):
	"""Store an alert, folding it into the seal's open incident for the same
	category when there is one (whatever its source), otherwise opening a new one.

	Returns {"doc", "created", "escalated"}; ``escalated`` means a merge raised the
	incident's level, which callers treat like a new alert for notification."""
	occurred_at = occurred_at or now_datetime()
	level = (level or "Warning").capitalize()
	occurrence = {
		"source_alert_id": source_alert_id,
		"alert_source": alert_source,
		"occurred_at": occurred_at,
		"message": message,
	}

	open_name = frappe.db.get_value(
		"Seal Alert Log",
		{"seal_device": seal_device, "alert_type": category, "is_resolved": 0},
		"name",
		order_by="occurred_at desc",
	)
	if open_name:
		doc = frappe.get_doc("Seal Alert Log", open_name)
		doc.append("occurrences", occurrence)
		doc.occurrence_count = (doc.occurrence_count or 1) + 1
		if not doc.last_occurred_at or occurred_at > doc.last_occurred_at:
			doc.last_occurred_at = occurred_at
		escalated = _LEVEL_RANK.get(level, 1) > _LEVEL_RANK.get(doc.level, 1)
		if escalated:
			doc.level = level
			doc.message = message
		doc.save(ignore_permissions=True)
		return {"doc": doc, "created": False, "escalated": escalated}

	doc = frappe.get_doc(
		{
			"doctype": "Seal Alert Log",
			"alert_source": alert_source,
			"alert_type": category,
			"level": level,
			"message": message,
			"seal_device": seal_device,
			"seal_journey": seal_journey,
			"journey_request": journey_request,
			"occurred_at": occurred_at,
			"last_occurred_at": occurred_at,
			"occurrence_count": 1,
			"source_alert_id": source_alert_id,
			"source_alert_type": source_alert_type,
			"uffizio_alert_id": uffizio_alert_id,
			"raw_data": raw_data,
			"occurrences": [occurrence],
		}
	).insert(ignore_permissions=True)
	return {"doc": doc, "created": True, "escalated": False}
