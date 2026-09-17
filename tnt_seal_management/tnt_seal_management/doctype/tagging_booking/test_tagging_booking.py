# Copyright (c) 2026, teamweb and Contributors
# See license.txt

import frappe
from frappe.core.doctype.user.test_user import test_user
from frappe.tests import IntegrationTestCase
from frappe.tests.test_model_utils import set_user
from frappe.utils import add_to_date

from unittest.mock import patch

from tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings import _get_eligible_account_managers
from tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking import (
	assign_to_me,
	amend_booking,
	approve_booking,
	reject_booking,
	submit_to_finance,
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

	def test_account_manager_cannot_amend_booking(self):
		booking = self._make_booking(status="Pending Finance PCB Approval")

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				amend_booking(booking.name, reason="Amending by mistake")

	def test_amend_booking_reverts_to_draft_and_clears_finance_fields(self):
		booking = self._make_booking(status="Pending Finance PCB Approval")

		with test_user(roles=["Finance PCB"], commit=True) as user:
			with set_user(user.name):
				amend_booking(booking.name, reason="Needs correction")

		booking.reload()
		self.assertEqual(booking.booking_status, "Draft")
		self.assertIsNone(booking.finance_pcb_approver)
		self.assertIsNone(booking.finance_pcb_approval_date_time)
		self.assertEqual(booking.finance_pcb_remarks, "Needs correction")

	def test_amend_booking_rejects_wrong_status(self):
		booking = self._make_booking(status="Draft")

		with test_user(roles=["Finance PCB"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				amend_booking(booking.name, reason="Should not work")

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

	def test_account_manager_can_claim_unassigned_customer_portal_booking(self):
		booking = self._make_booking(
			status="Pending Account Manager Review",
			booking_source="Customer Portal",
			account_manager=None,
		)

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name):
				assign_to_me(booking.name)

		self.assertEqual(frappe.db.get_value("Tagging Booking", booking.name, "account_manager"), user.name)

	def test_customer_portal_booking_must_be_claimed_before_submit_to_finance(self):
		booking = self._make_booking(
			status="Pending Account Manager Review",
			booking_source="Customer Portal",
			account_manager=None,
		)

		with test_user(roles=["Account Manager"], commit=True) as user:
			with set_user(user.name), self.assertRaises(frappe.ValidationError):
				submit_to_finance(booking.name)

	def test_get_eligible_account_managers_returns_empty_without_users(self):
		with patch("tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings.frappe.get_all") as mocked_get_all:
			mocked_get_all.side_effect = [[], []]
			self.assertEqual(_get_eligible_account_managers(), [])

	def test_get_eligible_account_managers_returns_enabled_system_users(self):
		with patch("tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings.frappe.get_all") as mocked_get_all:
			mocked_get_all.side_effect = [["am@example.com"], [{"name": "am@example.com"}]]
			result = _get_eligible_account_managers()
			self.assertEqual(result[0]["name"], "am@example.com")

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

	def _make_booking(self, status="Draft", booking_source="Account Manager", account_manager=None):
		return frappe.get_doc(
			{
				"doctype": "Tagging Booking",
				"client_name": self._get_customer_name(),
				"location": "QA Yard",
				"booking_date_time": add_to_date(None, days=1),
				"contact_person_name": "Jane Doe",
				"contact_person_phone": "+254700000000",
				"booking_status": status,
				"booking_source": booking_source,
				"account_manager": account_manager,
			}
		).insert(ignore_permissions=True)

	def _get_customer_name(self):
		customer = frappe.db.get_value("Customer", {}, "name")
		if customer:
			return customer

		self.fail("Expected at least one Customer in the test site.")
