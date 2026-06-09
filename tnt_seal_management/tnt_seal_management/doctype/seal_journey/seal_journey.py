# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint
from frappe.utils.data import cstr
from frappe.desk.search import validate_and_sanitize_search_inputs


class SealJourney(Document):
	pass


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def team_lead_technician_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("Team Lead Technician", txt, searchfield, start, page_len)


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
