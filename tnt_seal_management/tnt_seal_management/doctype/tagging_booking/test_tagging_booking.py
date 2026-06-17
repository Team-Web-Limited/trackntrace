# Copyright (c) 2026, teamweb and Contributors
# See license.txt

import frappe
from frappe.core.doctype.user.test_user import test_user
from frappe.tests import IntegrationTestCase
from frappe.tests.test_model_utils import set_user
from frappe.utils import add_to_date

from tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking import (
	approve_booking,
	reject_booking,
)


EXTRA_TEST_RECORD_DEPENDENCIES = []
IGNORE_TEST_RECORD_DEPENDENCIES = ["Customer", "PCB Job Order", "User"]


class IntegrationTestTaggingBooking(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self._ensure_role("Account Manager")
		self._ensure_role("Finance PCB")

	def test_account_manager_cannot_approve_booking(self):
		booking = self._make_booking(status="Pending Finance PCB Approval")

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				approve_booking(booking.name, remarks="Approved by mistake")

	def test_account_manager_cannot_reject_booking(self):
		booking = self._make_booking(status="Pending Finance PCB Approval")

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				reject_booking(booking.name, remarks="Rejected by mistake")

	def test_account_manager_cannot_change_finance_approval_fields_directly(self):
		booking = self._make_booking(status="Pending Finance PCB Approval")

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				booking = frappe.get_doc("Tagging Booking", booking.name)
				booking.booking_status = "Finance PCB Approved"
				booking.finance_pcb_approver = user.name
				booking.finance_pcb_approval_date_time = add_to_date(None, minutes=5)
				booking.finance_pcb_remarks = "Trying to force approval"
				booking.save(ignore_permissions=True)

	def _ensure_role(self, role_name):
		if frappe.db.exists("Role", role_name):
			return

		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": role_name,
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)

	def _make_booking(self, status="Draft"):
		return frappe.get_doc(
			{
				"doctype": "Tagging Booking",
				"client_name": self._get_customer_name(),
				"location": "QA Yard",
				"booking_date_time": add_to_date(None, days=1),
				"contact_person_name": "Jane Doe",
				"contact_person_phone": "+254700000000",
				"booking_status": status,
			}
		).insert(ignore_permissions=True)

	def _get_customer_name(self):
		customer = frappe.db.get_value("Customer", {}, "name")
		if customer:
			return customer

		self.fail("Expected at least one Customer in the test site.")
