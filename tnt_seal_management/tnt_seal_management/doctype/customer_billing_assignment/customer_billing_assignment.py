# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class CustomerBillingAssignment(Document):
	def validate(self):
		self.validate_target()
		self.validate_validity_dates()

	def validate_target(self):
		if self.assignment_type == "Customer":
			if not self.customer:
				frappe.throw(_("Customer is required for a Customer assignment."))
			self.customer_group = None
		elif self.assignment_type == "Customer Group":
			if not self.customer_group:
				frappe.throw(_("Customer Group is required for a Customer Group assignment."))
			self.customer = None
		else:
			frappe.throw(_("Assignment Type must be either Customer or Customer Group."))

	def validate_validity_dates(self):
		if self.effective_from and self.effective_to:
			if getdate(self.effective_to) < getdate(self.effective_from):
				frappe.throw(_("Effective To Date cannot be before Effective From Date."))

		if not self.billing_rule:
			return

		rule = frappe.db.get_value(
			"Seal Billing Rate", self.billing_rule, ["effective_from", "effective_to"], as_dict=True
		)
		if not rule:
			return

		# The rule's own Validity section is the company-wide window the rule may be
		# used in at all; this assignment's dates are the customer's slice of that
		# window and can never extend past it.
		if rule.effective_from and self.effective_from and getdate(self.effective_from) < getdate(rule.effective_from):
			frappe.throw(
				_("Effective From Date cannot be before the billing rule's Effective From Date ({0}).").format(
					frappe.format(rule.effective_from, {"fieldtype": "Date"})
				)
			)
		if rule.effective_to and self.effective_to and getdate(self.effective_to) > getdate(rule.effective_to):
			frappe.throw(
				_("Effective To Date cannot be after the billing rule's Effective To Date ({0}).").format(
					frappe.format(rule.effective_to, {"fieldtype": "Date"})
				)
			)
