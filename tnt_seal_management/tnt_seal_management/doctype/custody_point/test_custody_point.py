# Copyright (c) 2026, teamweb and Contributors
# See license.txt

from frappe.tests import IntegrationTestCase

from tnt_seal_management.tnt_seal_management.doctype.custody_point.custody_point import (
	haversine_meters,
)

EXTRA_TEST_RECORD_DEPENDENCIES = []
IGNORE_TEST_RECORD_DEPENDENCIES = []


class IntegrationTestCustodyPoint(IntegrationTestCase):
	"""
	Integration tests for CustodyPoint.
	"""

	def test_haversine_zero_distance(self):
		self.assertAlmostEqual(haversine_meters(-1.3228, 36.8966, -1.3228, 36.8966), 0, places=3)

	def test_haversine_known_distance(self):
		# Roughly 1 degree of latitude is ~111km
		distance = haversine_meters(0, 0, 1, 0)
		self.assertAlmostEqual(distance, 111195, delta=200)
