# Copyright (c) 2026, teamweb and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	apply_pre_tagging_snapshot,
	resolve_pre_tagging_snapshot,
)


# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]



class IntegrationTestSealJourney(IntegrationTestCase):
	"""
	Integration tests for SealJourney.
	Use this class for testing interactions between multiple components.
	"""

	def test_pre_tagging_snapshot_mirrors_rows_and_pending_status(self):
		request = frappe.new_doc("Journey Request")
		request.append("pre_tagging_checklist", {"checklist_item": "First", "completed": 1})
		request.append("pre_tagging_checklist", {"checklist_item": "Second", "completed": 0})

		snapshot = resolve_pre_tagging_snapshot(request)
		journey = frappe.new_doc("Seal Journey")
		journey.append("pre_tagging_checklist", {"checklist_item": "Legacy", "completed": 0})
		rows_changed, status_changed = apply_pre_tagging_snapshot(journey, snapshot)

		self.assertTrue(rows_changed)
		self.assertFalse(status_changed)
		self.assertEqual(journey.pre_tagging_status, "Pending")
		self.assertEqual(
			[(row.checklist_item, row.completed) for row in journey.pre_tagging_checklist],
			[("First", 1), ("Second", 0)],
		)

	def test_pre_tagging_snapshot_completes_and_is_idempotent(self):
		request = frappe.new_doc("Journey Request")
		request.append("pre_tagging_checklist", {"checklist_item": "First", "completed": 1})
		request.append("pre_tagging_checklist", {"checklist_item": "Second", "completed": 1})

		snapshot = resolve_pre_tagging_snapshot(request)
		journey = frappe.new_doc("Seal Journey")
		rows_changed, status_changed = apply_pre_tagging_snapshot(journey, snapshot)

		self.assertTrue(rows_changed)
		self.assertTrue(status_changed)
		self.assertEqual(journey.pre_tagging_status, "Completed")
		self.assertEqual(apply_pre_tagging_snapshot(journey, snapshot), (False, False))
