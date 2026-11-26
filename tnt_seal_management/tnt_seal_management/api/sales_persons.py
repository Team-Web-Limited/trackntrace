# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""Which users can be a booking's Salesperson, and the Sales Person record each
one is credited as on a generated Sales Order.

A Tagging Booking stores the salesperson as a User; ERPNext's Sales Team needs a
Sales Person. A user resolves to an enabled, individual (non-group) Sales Person:

1. the one linked to the user's Employee (Sales Person.employee), else
2. the one whose name is exactly the user's full name.

Nothing else is guessed: a near-miss name (User "Mary Kathambi" vs Sales Person
"Mary Mutwiri") is not a match until someone links the Sales Person to the
employee."""

import frappe


def _enabled_sales_persons():
	return frappe.get_all(
		"Sales Person",
		filters={"enabled": 1, "is_group": 0},
		fields=["name", "employee"],
	)


def sales_person_for_user(user):
	"""The enabled Sales Person a user is credited as, or None."""
	if not user:
		return None
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if employee:
		match = frappe.db.get_value("Sales Person", {"employee": employee, "enabled": 1, "is_group": 0}, "name")
		if match:
			return match
	full_name = frappe.db.get_value("User", user, "full_name")
	if full_name and frappe.db.exists("Sales Person", {"name": full_name, "enabled": 1, "is_group": 0}):
		return full_name
	return None


def salesperson_users():
	"""{user: sales_person} for every enabled user who resolves to an enabled
	Sales Person, using the same rules as sales_person_for_user."""
	persons = _enabled_sales_persons()
	by_employee = {p.employee: p.name for p in persons if p.employee}
	by_name = {p.name for p in persons}

	users = frappe.get_all(
		"User",
		filters={"enabled": 1},
		fields=["name", "full_name"],
	)
	employee_of = {
		e.user_id: e.name
		for e in frappe.get_all("Employee", filters={"user_id": ["is", "set"]}, fields=["name", "user_id"])
	}

	result = {}
	for u in users:
		person = by_employee.get(employee_of.get(u.name))
		if not person and u.full_name in by_name:
			person = u.full_name
		if person:
			result[u.name] = person
	return result


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def search_salesperson_users(doctype, txt, searchfield, start, page_len, filters):
	"""Link-field query for Tagging Booking.salesperson: only users who resolve to
	an enabled Sales Person. Rows are [user, full name, Sales Person]."""
	txt = (txt or "").lower()
	rows = []
	full_names = {
		u.name: u.full_name or u.name
		for u in frappe.get_all("User", filters={"enabled": 1}, fields=["name", "full_name"])
	}
	for user, person in salesperson_users().items():
		label = full_names.get(user, user)
		if txt and txt not in user.lower() and txt not in label.lower() and txt not in person.lower():
			continue
		rows.append([user, label, person])
	rows.sort(key=lambda r: r[1].lower())
	start, page_len = int(start or 0), int(page_len or 20)
	return rows[start : start + page_len]
