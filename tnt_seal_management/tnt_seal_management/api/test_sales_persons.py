# Copyright (c) 2026, teamweb and Contributors
# See license.txt

import frappe
try:
	from frappe.tests import IntegrationTestCase
except ImportError:  # Frappe v15
	from frappe.tests.utils import FrappeTestCase as IntegrationTestCase

from tnt_seal_management.tnt_seal_management.api.completed_journeys import _append_sales_team
from tnt_seal_management.tnt_seal_management.api.sales_persons import (
	sales_person_for_user,
	salesperson_users,
	search_salesperson_users,
)

IGNORE_TEST_RECORD_DEPENDENCIES = ["User", "Employee", "Sales Person", "Company"]


class TestSalesPersons(IntegrationTestCase):
	def _user(self, email, first, last=None):
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				{"doctype": "User", "email": email, "first_name": first, "last_name": last, "send_welcome_email": 0}
			).insert(ignore_permissions=True)
		return email

	def _sales_person(self, name, employee=None, enabled=1):
		if frappe.db.exists("Sales Person", name):
			frappe.db.set_value("Sales Person", name, {"employee": employee, "enabled": enabled})
			return name
		return frappe.get_doc(
			{"doctype": "Sales Person", "sales_person_name": name, "employee": employee, "enabled": enabled,
				"is_group": 0}
		).insert(ignore_permissions=True).name

	def _employee(self, user, first):
		company = frappe.db.get_value("Company", {}, "name")
		return frappe.get_doc(
			{"doctype": "Employee", "first_name": first, "user_id": user, "company": company, "gender": "Female",
				"date_of_birth": "1990-01-01", "date_of_joining": "2020-01-01", "status": "Active"}
		).insert(ignore_permissions=True).name

	def test_exact_full_name_matches(self):
		user = self._user("qa-sp-exact@example.com", "QA", "Exactname")
		self._sales_person("QA Exactname")
		self.assertEqual(sales_person_for_user(user), "QA Exactname")
		self.assertEqual(salesperson_users().get(user), "QA Exactname")

	def test_near_miss_name_does_not_match(self):
		user = self._user("qa-sp-near@example.com", "QA", "Kathambi")
		self._sales_person("QA Mutwiri")
		self.assertIsNone(sales_person_for_user(user))
		self.assertNotIn(user, salesperson_users())

	def test_employee_link_matches_despite_different_name(self):
		user = self._user("qa-sp-emp@example.com", "QA", "Otherform")
		employee = self._employee(user, "QA Linked")
		self._sales_person("QA Linkedform", employee=employee)
		self.assertEqual(sales_person_for_user(user), "QA Linkedform")
		self.assertEqual(salesperson_users().get(user), "QA Linkedform")

	def test_disabled_sales_person_does_not_match(self):
		user = self._user("qa-sp-off@example.com", "QA", "Disabledone")
		self._sales_person("QA Disabledone", enabled=0)
		self.assertIsNone(sales_person_for_user(user))
		self.assertNotIn(user, salesperson_users())

	def test_search_only_returns_resolving_users(self):
		ok = self._user("qa-sp-search@example.com", "QA", "Searchable")
		self._sales_person("QA Searchable")
		bad = self._user("qa-sp-nosearch@example.com", "QA", "Searchless")
		found = [r[0] for r in search_salesperson_users("User", "qa", "name", 0, 500, {})]
		self.assertIn(ok, found)
		self.assertNotIn(bad, found)

	def test_booking_rejects_salesperson_without_sales_person(self):
		from tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking import TaggingBooking

		bad = self._user("qa-sp-booking@example.com", "QA", "Bookingless")
		booking = frappe.new_doc("Tagging Booking")
		booking.salesperson = bad
		with self.assertRaises(frappe.ValidationError):
			TaggingBooking._validate_salesperson(booking)
		booking.salesperson = None
		TaggingBooking._validate_salesperson(booking)  # optional: empty is fine

	def test_sales_team_split_sums_to_100(self):
		users = []
		for i, last in enumerate(("Splitone", "Splittwo", "Splitthree")):
			users.append(self._user(f"qa-sp-split{i}@example.com", "QA", last))
			self._sales_person(f"QA {last}")
		so = frappe.new_doc("Sales Order")
		_append_sales_team(so, [{"salesperson": u} for u in users])
		pcts = [r.allocated_percentage for r in so.sales_team]
		self.assertEqual(len(pcts), 3)
		self.assertAlmostEqual(sum(pcts), 100.0, places=6)
