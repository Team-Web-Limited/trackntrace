import json

import frappe


def execute():
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_device")
	frappe.reload_doc("tnt_seal_management", "doctype", "journey_request_seal")
	frappe.reload_doc("tnt_seal_management", "doctype", "seal_journey")

	backfill_seal_devices()
	backfill_journey_request_seals()
	backfill_seal_journeys()
	frappe.db.commit()


def backfill_seal_devices():
	rows = frappe.db.get_all(
		"Seal Device",
		fields=["name", "raw_api_response"],
		filters=[["raw_api_response", "is", "set"]],
	)
	for row in rows:
		branch = _branch_from_raw(row.raw_api_response)
		if branch:
			frappe.db.set_value("Seal Device", row.name, "api_branch", branch[:140], update_modified=False)


def backfill_journey_request_seals():
	rows = frappe.db.sql(
		"""
		select jrs.name, sd.api_branch
		from `tabJourney Request Seal` jrs
		inner join `tabSeal Device` sd on sd.name = jrs.seal_device
		where coalesce(sd.api_branch, '') != ''
		""",
		as_dict=True,
	)
	for row in rows:
		frappe.db.set_value(
			"Journey Request Seal",
			row.name,
			"api_branch",
			(row.api_branch or "")[:140],
			update_modified=False,
		)


def backfill_seal_journeys():
	journeys = frappe.db.get_all("Seal Journey", fields=["name", "assigned_seal", "api_raw_response"])
	for journey in journeys:
		branch = _common_journey_seal_branch(journey.name)
		if not branch:
			branch = _branch_from_raw(journey.api_raw_response)
		if not branch and journey.assigned_seal:
			branch = frappe.db.get_value("Seal Device", journey.assigned_seal, "api_branch")
		frappe.db.set_value("Seal Journey", journey.name, "api_branch", (branch or "")[:140], update_modified=False)


def _common_journey_seal_branch(seal_journey):
	rows = frappe.db.get_all(
		"Journey Request Seal",
		filters={"parent": seal_journey, "parenttype": "Seal Journey"},
		fields=["api_branch"],
	)
	branches = {(r.api_branch or "").strip() for r in rows if (r.api_branch or "").strip()}
	return next(iter(branches)) if rows and len(branches) == 1 and len(branches) == len(rows) else ""


def _branch_from_raw(raw):
	if not raw:
		return ""
	try:
		data = json.loads(raw)
	except Exception:
		return ""
	if not isinstance(data, dict):
		return ""
	branch = data.get("Branch") or data.get("branch") or data.get("BRANCH")
	return str(branch).strip() if branch not in (None, "", "--") else ""
