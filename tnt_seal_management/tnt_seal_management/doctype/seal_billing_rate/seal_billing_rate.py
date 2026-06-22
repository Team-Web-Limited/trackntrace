# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, date_diff, flt, getdate

# Default number of days a fixed contract period covers.
PERIOD_TYPE_DAYS = {
	"Weekly": 7,
	"Monthly": 30,
	"Quarterly": 90,
	"Semi-Annually": 180,
	"Annually": 365,
}


class SealBillingRate(Document):
	def validate(self):
		self.set_period_days_from_range()
		self.validate_pricing()
		self.validate_validity_dates()
		self.validate_single_global_default()

	def set_period_days_from_range(self):
		"""Derive first_period_days from the period type. For Date Range, use the
		inclusive span between the two dates — the dates are only a calculator for
		the day count, the billing engine still consumes first_period_days alone.
		For other period types, use the standard day count for that period."""
		if self.billing_period_type == "Date Range":
			if not self.period_from_date or not self.period_to_date:
				frappe.throw(_("Period From Date and Period To Date are required for a Date Range period."))
			if getdate(self.period_to_date) < getdate(self.period_from_date):
				frappe.throw(_("Period To Date cannot be before Period From Date."))
			self.first_period_days = date_diff(self.period_to_date, self.period_from_date) + 1
			return

		mapped = PERIOD_TYPE_DAYS.get(self.billing_period_type)
		if mapped:
			self.first_period_days = mapped

	def validate_pricing(self):
		if cint(self.first_period_days) <= 0:
			frappe.throw(_("First Period Days must be greater than 0."))
		if flt(self.first_period_amount) < 0:
			frappe.throw(_("First Period Amount cannot be negative."))
		if flt(self.extra_day_rate) < 0:
			frappe.throw(_("Extra Day Rate cannot be negative."))

	def validate_validity_dates(self):
		if self.effective_from and self.effective_to:
			if getdate(self.effective_to) < getdate(self.effective_from):
				frappe.throw(_("Effective To Date cannot be before Effective From Date."))

	def validate_single_global_default(self):
		if not self.is_global_default:
			return

		other = frappe.db.get_value(
			"Seal Billing Rate",
			{"is_global_default": 1, "name": ["!=", self.name]},
			"name",
		)
		if other:
			frappe.throw(
				_("{0} is already the global default billing rule. Only one is allowed.").format(
					frappe.bold(other)
				)
			)
