# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, date_diff, flt, getdate, now_datetime

# Default number of days a fixed contract period covers.
PERIOD_TYPE_DAYS = {
	"Weekly": 7,
	"Monthly": 30,
	"Quarterly": 90,
	"Semi-Annually": 180,
	"Annually": 365,
}

# A change to any of these fields on an already-Approved rule means the terms
# the Managing Director signed off on no longer hold — the rule must be
# re-approved before it can be used again. See validate_approval_status().
APPROVAL_WATCHED_FIELDS = (
	"billing_type",
	"active",
	"currency",
	"billing_period_type",
	"is_global_default",
	"period_from_date",
	"period_to_date",
	"first_period_days",
	"first_period_amount",
	"extra_day_rate",
	"effective_from",
	"effective_to",
)


class SealBillingRate(Document):
	def validate(self):
		self.set_period_days_from_range()
		self.validate_pricing()
		self.validate_validity_dates()
		self.validate_single_global_default()
		self.validate_approval_status()

	def set_period_days_from_range(self):
		"""Derive first_period_days from the period type. For Date Range, use the
		inclusive span between the two dates — the dates are only a calculator for
		the day count, the billing engine still consumes first_period_days alone.
		For Days, keep the user-entered value.
		For other period types, use the standard day count for that period.

		Leasing rules skip all of this — they're a private contract with
		first_period_days entered directly, no period type or date range."""
		if self.billing_type == "Leasing":
			return

		if self.billing_period_type == "Date Range":
			if not self.period_from_date or not self.period_to_date:
				frappe.throw(_("Period From Date and Period To Date are required for a Date Range period."))
			if getdate(self.period_to_date) < getdate(self.period_from_date):
				frappe.throw(_("Period To Date cannot be before Period From Date."))
			self.first_period_days = date_diff(self.period_to_date, self.period_from_date) + 1
			return

		if self.billing_period_type == "Days":
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
		if self.billing_type == "Leasing":
			# Leasing is a private, per-customer contract — never a fallback default.
			self.is_global_default = 0
			return

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

	def validate_approval_status(self):
		"""New Subscription rules start Pending Approval. Any edit to the watched
		terms on an already-Approved rule resets it back to Pending Approval — the
		Managing Director must sign off on the terms actually in effect. The
		approve/reject whitelisted actions set flags.approval_action so their own
		save() doesn't trigger this reset.

		Leasing rules are private, per-customer contracts entered directly by
		Finance in the Set Billing modal (see
		current_customers._upsert_customer_leasing_rule, which auto-approves them)
		— they sit outside this governance track."""
		if self.billing_type == "Leasing":
			return

		if self.is_new():
			if not self.approval_status:
				self.approval_status = "Pending Approval"
			return

		if self.flags.approval_action:
			return

		previous = self.get_doc_before_save()
		if not previous or previous.approval_status != "Approved":
			return

		if any(frappe.utils.cstr(previous.get(f)) != frappe.utils.cstr(self.get(f)) for f in APPROVAL_WATCHED_FIELDS):
			self.approval_status = "Pending Approval"
			self.approved_by = None
			self.approved_on = None
			self.approval_remarks = None


def _ensure_managing_director_role():
	roles = set(frappe.get_roles())
	if "System Manager" in roles or frappe.session.user == "Administrator":
		return
	if "Managing Director" not in roles:
		frappe.throw(
			_("Only the Managing Director can approve or reject billing rules."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def approve_seal_billing_rate(name):
	_ensure_managing_director_role()
	doc = frappe.get_doc("Seal Billing Rate", name)
	if doc.billing_type == "Leasing":
		frappe.throw(_("Leasing rates are auto-approved and do not go through this workflow."))
	if doc.approval_status == "Approved":
		return doc.as_dict()

	doc.flags.approval_action = True
	doc.approval_status = "Approved"
	doc.approved_by = frappe.session.user
	doc.approved_on = now_datetime()
	doc.approval_remarks = None
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return doc.as_dict()


@frappe.whitelist()
def reject_seal_billing_rate(name, remarks=None):
	_ensure_managing_director_role()
	doc = frappe.get_doc("Seal Billing Rate", name)
	if doc.billing_type == "Leasing":
		frappe.throw(_("Leasing rates are auto-approved and do not go through this workflow."))

	doc.flags.approval_action = True
	doc.approval_status = "Rejected"
	doc.approved_by = frappe.session.user
	doc.approved_on = now_datetime()
	doc.approval_remarks = remarks
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return doc.as_dict()
