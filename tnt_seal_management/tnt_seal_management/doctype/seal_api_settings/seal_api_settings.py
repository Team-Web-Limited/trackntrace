# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class SealAPISettings(Document):
	def validate(self):
		self.validate_checklist_template_permission()

	def validate_checklist_template_permission(self):
		if self.flags.ignore_checklist_template_permission:
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		old_items = [row.checklist_item for row in previous.pre_tagging_checklist_template]
		new_items = [row.checklist_item for row in self.pre_tagging_checklist_template]
		if old_items == new_items:
			return

		if "System Manager" not in frappe.get_roles(frappe.session.user):
			frappe.throw(
				_("Only System Managers can change the Pre-Tagging Checklist Template."),
				frappe.PermissionError,
			)
