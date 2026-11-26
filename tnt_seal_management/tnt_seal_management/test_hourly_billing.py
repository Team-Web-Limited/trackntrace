# Copyright (c) 2026, teamweb and Contributors
# See license.txt

import frappe

try:
	from frappe.tests import IntegrationTestCase
except ImportError:  # Frappe v15
	from frappe.tests.utils import FrappeTestCase as IntegrationTestCase

from tnt_seal_management.tnt_seal_management.billing import compute_billing_amount
from tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate import (
	days_spanned_by_hours,
)

IGNORE_TEST_RECORD_DEPENDENCIES = ["Customer", "Item", "User"]


def hourly_rule(**overrides):
	rule = frappe._dict(
		name="QA Hourly",
		billing_type="Leasing",
		rate_type="Non-Flat Rate",
		billing_period_type="Hourly",
		currency="KES",
		first_period_days=1,
		first_period_hours=6,
		first_period_amount=1000,
		extra_day_rate=0,
		extra_hour_rate=150,
	)
	rule.update(overrides)
	return rule


class TestHourlyBilling(IntegrationTestCase):
	def test_days_spanned_by_hours(self):
		self.assertEqual(days_spanned_by_hours(6), 1)
		self.assertEqual(days_spanned_by_hours(24), 1)
		self.assertEqual(days_spanned_by_hours(25), 2)
		self.assertEqual(days_spanned_by_hours(0), 0)

	def test_within_first_period_is_first_period_amount(self):
		r = compute_billing_amount(hourly_rule(), 1, elapsed_hours=5.5)
		self.assertEqual(r["extra_hours"], 0)
		self.assertEqual(r["total_amount"], 1000)
		self.assertEqual(r["first_period_hours"], 6)

	def test_exactly_first_period_has_no_extra(self):
		r = compute_billing_amount(hourly_rule(), 1, elapsed_hours=6)
		self.assertEqual(r["extra_hours"], 0)
		self.assertEqual(r["total_amount"], 1000)

	def test_each_started_hour_past_first_period_is_charged(self):
		# 9 h 10 min = 3 h 10 min past 6 h -> 4 started hours
		r = compute_billing_amount(hourly_rule(), 1, elapsed_hours=9 + 10 / 60)
		self.assertEqual(r["extra_hours"], 4)
		self.assertEqual(r["extra_day_amount"], 600)
		self.assertEqual(r["total_amount"], 1600)

	def test_per_seal(self):
		r = compute_billing_amount(hourly_rule(), 1, seal_count=2, elapsed_hours=8)
		self.assertEqual(r["per_seal_amount"], 1300)
		self.assertEqual(r["total_amount"], 2600)

	def test_multi_day_journey_counts_hours_not_days(self):
		# 2 days 3 hours = 51 h -> 45 extra hours; no day rate or renewal applies
		r = compute_billing_amount(hourly_rule(extra_day_rate=999), 3, elapsed_hours=51)
		self.assertEqual(r["extra_hours"], 45)
		self.assertEqual(r["total_amount"], 1000 + 45 * 150)

	def test_subscription_hourly_is_not_renewed_by_period(self):
		r = compute_billing_amount(
			hourly_rule(billing_type="Subscription"), 3, elapsed_hours=51
		)
		self.assertEqual(r["total_amount"], 1000 + 45 * 150)

	def test_zero_hour_rate_still_ignores_day_math(self):
		r = compute_billing_amount(hourly_rule(extra_hour_rate=0, extra_day_rate=500), 3, elapsed_hours=51)
		self.assertEqual(r["total_amount"], 1000)

	def test_unknown_duration_falls_back_to_whole_days(self):
		r = compute_billing_amount(hourly_rule(), 2)  # 48 h
		self.assertEqual(r["extra_hours"], 42)

	def test_non_hourly_rules_unchanged(self):
		r = compute_billing_amount(
			hourly_rule(billing_period_type="Custom", first_period_days=2, extra_day_rate=100, extra_hour_rate=0),
			4,
			elapsed_hours=80,
		)
		self.assertEqual(r["extra_hours"], 0)
		self.assertEqual(r["first_period_hours"], 0)
		self.assertEqual(r["total_amount"], 1000 + 2 * 100)

	def test_rule_requires_hours_and_simple(self):
		doc = frappe.get_doc({
			"doctype": "Seal Billing Rate",
			"billing_rule_name": "QA Hourly BR",
			"billing_type": "Subscription",
			"rate_type": "Non-Flat Rate",
			"computation_method": "Simple",
			"billing_period_type": "Hourly",
			"first_period_hours": 0,
			"first_period_amount": 1000,
			"currency": "KES",
		})
		with self.assertRaises(frappe.ValidationError):
			doc.validate()
		doc.first_period_hours = 30
		doc.validate()
		self.assertEqual(doc.first_period_days, 2)
		doc.computation_method = "Compound"
		with self.assertRaises(frappe.ValidationError):
			doc.validate()

	def test_switching_away_from_hourly_clears_hours(self):
		doc = frappe.get_doc({
			"doctype": "Seal Billing Rate",
			"billing_rule_name": "QA Monthly BR",
			"billing_type": "Subscription",
			"rate_type": "Non-Flat Rate",
			"computation_method": "Simple",
			"billing_period_type": "Monthly",
			"first_period_hours": 6,
			"first_period_amount": 1000,
			"currency": "KES",
		})
		doc.validate()
		self.assertEqual(doc.first_period_hours, 0)
		self.assertEqual(doc.first_period_days, 30)
