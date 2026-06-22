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
