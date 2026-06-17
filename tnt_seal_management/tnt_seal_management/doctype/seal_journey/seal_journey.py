# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint
from frappe.utils.data import cstr
from frappe.desk.search import validate_and_sanitize_search_inputs

DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS = [
	"Confirm seal device is physically available",
	"Inspect seal body for visible damage",
	"Verify battery level is sufficient",
	"Confirm assigned vehicle details are correct",
	"Capture pre-tagging photo evidence",
]


class SealJourney(Document):
	def before_insert(self):
		self.ensure_pre_tagging_checklist()

	def ensure_pre_tagging_checklist(self):
		if self.pre_tagging_checklist:
			return

		for item in get_pre_tagging_checklist_items():
			self.append("pre_tagging_checklist", {"checklist_item": item, "completed": 0})


def set_journey_status(seal_journey, status, extra=None):
	"""Update the status (and optional extra fields) of a Seal Journey, if one is
	linked. Safe no-op when ``seal_journey`` is empty. Used to keep the Seal
	Journey mirror in step with the booking → job order → journey request flow."""
	if not seal_journey:
		return
	if not frappe.db.exists("Seal Journey", seal_journey):
		return
	values = {"journey_status": status}
	if extra:
		values.update(extra)
	frappe.db.set_value("Seal Journey", seal_journey, values)


def get_pre_tagging_checklist_items():
	settings = frappe.get_single("Seal API Settings")
	items = [
		row.checklist_item.strip()
		for row in settings.pre_tagging_checklist_template
		if row.checklist_item and row.checklist_item.strip()
	]
	return items or DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS


@frappe.whitelist()
def get_pre_tagging_checklist_template():
	return get_pre_tagging_checklist_items()


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def pcb_team_leader_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("PCB Team Leader", txt, searchfield, start, page_len)


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def field_technician_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("Field Technician", txt, searchfield, start, page_len)


def _user_role_query(role, txt, searchfield, start, page_len):
	return frappe.db.sql(
		f"""
		select
			u.name,
			concat_ws(' ', u.first_name, u.last_name) as full_name
		from `tabUser` u
		inner join `tabHas Role` hr on hr.parent = u.name
		where hr.role = %(role)s
			and u.enabled = 1
			and u.docstatus < 2
			and u.user_type = 'System User'
			and (
				u.{searchfield} like %(txt)s
				or concat_ws(' ', u.first_name, u.last_name) like %(txt)s
			)
		order by
			case when u.name like %(txt)s then 0 else 1 end,
			case when concat_ws(' ', u.first_name, u.last_name) like %(txt)s then 0 else 1 end,
			u.full_name asc,
			u.name asc
		limit %(start)s, %(page_len)s
		""",
		{
			"role": role,
			"txt": f"%{cstr(txt)}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
	)
