# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, date_diff, flt, getdate, now_datetime

# Default number of days a fixed contract period covers.
PERIOD_TYPE_DAYS = {
	"Weekly": 7,
	"Bi-Weekly": 14,
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
	"journey_type",
	"active",
	"currency",
	"billing_period_type",
	"is_global_default",
	"period_from_date",
	"period_to_date",
	"first_period_days",
	"first_period_amount",
	"extra_day_rate",
	# Per-seal rates are prices like any other term here, so re-pricing them on
	# an already-approved rule sends it back for approval too.
	"owned_rate_per_seal",
	"lease_rate_per_seal",
)


class SealBillingRate(Document):
	def validate(self):
		self.set_period_days_from_range()
		self.validate_pricing()
		self.validate_single_global_default()
		self.validate_approval_status()

	def on_update(self):
		if self.approval_status == "Pending Approval" and self.has_value_changed("approval_status"):
			_notify_managing_director_pending(self)

	def set_period_days_from_range(self):
		"""Derive first_period_days from the period type. For Date Range, use the
		inclusive span between the two dates — the dates are only a calculator for
		the day count, the billing engine still consumes first_period_days alone.
		For Days, keep the user-entered value.
		For other period types, use the standard day count for that period.

		Leasing rules skip all of this — they're a private contract with
		first_period_days entered directly, no period type or date range.
		Every Subscription rule (Flat or Non-Flat Rate) derives it from the
		period type, same as the Set Billing modal's Frequency; Custom, like
		Days, keeps the entered value."""
		if self.billing_type == "Leasing":
			return

		if self.billing_period_type == "Date Range":
			if not self.period_from_date or not self.period_to_date:
				frappe.throw(_("Period From Date and Period To Date are required for a Date Range period."))
			if getdate(self.period_to_date) < getdate(self.period_from_date):
				frappe.throw(_("Period To Date cannot be before Period From Date."))
			self.first_period_days = date_diff(self.period_to_date, self.period_from_date) + 1
			return

		if self.billing_period_type in ("Days", "Custom"):
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
		current_customers._upsert_customer_leasing_rule) but are now subject to
		this same approval process: a new leasing rule starts Pending Approval and
		any edit to an approved one's terms resets it back to Pending, exactly like
		a shared Subscription rate card."""

		if self.is_new():
			if not self.approval_status:
				self.approval_status = "Pending Approval"
			return

		if self.flags.approval_action:
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		# Saving a Rejected rule again (Finance revising the billing after a
		# rejection) resubmits it for approval.
		if previous.approval_status == "Rejected":
			self.approval_status = "Pending Approval"
			self.approved_by = None
			self.approved_on = None
			return

		if previous.approval_status != "Approved":
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
def approve_seal_billing_rate(name, remarks=None):
	_ensure_managing_director_role()
	doc = frappe.get_doc("Seal Billing Rate", name)
	if doc.approval_status == "Approved":
		# Nothing to transition, but still reconcile: a customer can end up
		# assigned to an already-Approved rule (e.g. current_customers.py's
		# _gate_customer_on_rule_approval running against stale data) without
		# ever living through a Pending -> Approved transition here, so make
		# sure they aren't left disabled on a rule that's fine.
		_reenable_customers_pending_on_rule(doc.name)
		return doc.as_dict()

	doc.flags.approval_action = True
	doc.approval_status = "Approved"
	doc.approved_by = frappe.session.user
	doc.approved_on = now_datetime()
	doc.approval_remarks = remarks or None
	# billing_type's Select options only list "Subscription" — Leasing rules are
	# a deliberate exception written through frappe.flags.in_import (see
	# current_customers._upsert_customer_leasing_rule) since they're created
	# outside this doctype's form. Re-saving one here needs the same bypass.
	frappe.flags.in_import = True
	try:
		doc.save(ignore_permissions=True)
	finally:
		frappe.flags.in_import = False
	_reenable_customers_pending_on_rule(doc.name)
	frappe.db.commit()
	_notify_rule_owner_decision(doc, approved=True)
	return doc.as_dict()


def _rule_summary_lines(doc):
	return [
		_("Billing Rule: {0}").format(doc.billing_rule_name or doc.name),
		_("Billing Type: {0}").format(doc.billing_type or "-"),
		_("First Period: {0} for {1} days").format(
			frappe.utils.fmt_money(doc.first_period_amount, currency=doc.currency), doc.first_period_days or "-"
		),
		_("Extra Day Rate: {0}").format(frappe.utils.fmt_money(doc.extra_day_rate, currency=doc.currency)),
	]


def _notify_managing_director_pending(doc):
	"""Ask the Managing Director to sign off on a new billing rule, or on an
	approved one whose terms just changed, via desk notification and email."""
	from tnt_seal_management.tnt_seal_management.api.notifications import (
		get_users_with_role,
		notify_users,
	)

	lines = [
		_("A billing rule is awaiting your approval. Customers assigned to it stay disabled until it is approved."),
		*_rule_summary_lines(doc),
	]
	notify_users(
		get_users_with_role("Managing Director"),
		_("Billing Rule Awaiting Approval: {0}").format(doc.billing_rule_name or doc.name),
		"<br>".join(str(line) for line in lines),
		document_type="Seal Billing Rate",
		document_name=doc.name,
		link=f"/app/seal-billing-rate/{doc.name}",
	)


def _notify_rule_owner_decision(doc, approved, remarks=None):
	"""Tell whoever created the billing rule how the Managing Director ruled."""
	from tnt_seal_management.tnt_seal_management.api.notifications import notify_users

	user = doc.owner
	if not user or user == frappe.session.user or not frappe.db.get_value("User", user, "enabled"):
		return

	verdict = _("approved") if approved else _("rejected")
	lines = [_("The Managing Director {0} this billing rule.").format(verdict), *_rule_summary_lines(doc)]
	if (remarks or "").strip():
		lines.append(_("Remarks: {0}").format(remarks.strip()))
	if not approved:
		lines.append(_("Revise the rule's terms to send it for approval again."))

	email = frappe.db.get_value("User", user, "email")
	notify_users(
		[(user, email or user)],
		_("Billing Rule {0}: {1}").format(_("Approved") if approved else _("Rejected"), doc.billing_rule_name or doc.name),
		"<br>".join(str(line) for line in lines),
		document_type="Seal Billing Rate",
		document_name=doc.name,
		link=f"/app/seal-billing-rate/{doc.name}",
	)


def _reenable_customers_pending_on_rule(rule_name):
	"""Customer.disabled is set to 1 by current_customers.set_customer_billing /
	set_customer_extra_billing whenever billing is (re)assigned, as a gate that
	holds until the Managing Director signs off. Once this rule is approved,
	re-enable every customer whose assignment points at it — unless that
	customer has another active assignment (primary or extra-billing) still
	sitting on a not-yet-approved rule, in which case they stay disabled."""
	customers = set(
		frappe.get_all(
			"Customer Billing Assignment",
			filters={"assignment_type": "Customer", "billing_rule": rule_name, "active": 1},
			pluck="customer",
		)
	)

	# The Import/Export rate set has no assignment of its own (see
	# current_customers._upsert_customer_*_rule — only Local gets one), so
	# approving THAT rule would otherwise never reach the customer it
	# belongs to via the lookup above. Reverse its private
	# "<Customer Name> BR" name (current_customers._customer_rule_name) back
	# to the customer directly.
	rule = frappe.db.get_value(
		"Seal Billing Rate", rule_name, ["billing_rule_name", "journey_type"], as_dict=True
	)
	if rule and rule.journey_type == "Import/Export" and (rule.billing_rule_name or "").endswith(" BR"):
		owner = frappe.db.get_value("Customer", {"customer_name": rule.billing_rule_name[: -len(" BR")]}, "name")
		if owner:
			customers.add(owner)

	for customer in customers:
		if _customer_billing_fully_approved(customer):
			frappe.db.set_value("Customer", customer, "disabled", 0)


def _customer_billing_fully_approved(customer):
	rule_names = frappe.get_all(
		"Customer Billing Assignment",
		filters={"assignment_type": "Customer", "customer": customer, "active": 1},
		pluck="billing_rule",
	)
	rule_names = {r for r in rule_names if r}

	# The Import/Export rate set is a private sibling rule with no assignment
	# of its own (see current_customers._upsert_customer_*_rule — only Local
	# gets a Customer Billing Assignment), so it's invisible to the lookup
	# above. Include it here too, by the same (name, journey_type) it's
	# findable by, or a customer with a pending Import/Export rate would be
	# wrongly treated as fully approved.
	from tnt_seal_management.tnt_seal_management.api.current_customers import (
		JOURNEY_TYPE_IMPORT_EXPORT,
		_customer_rule_name,
	)

	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	alt_rule = frappe.db.get_value(
		"Seal Billing Rate",
		{
			"billing_rule_name": _customer_rule_name(customer_name),
			"journey_type": JOURNEY_TYPE_IMPORT_EXPORT,
			"active": 1,
		},
		"name",
	)
	if alt_rule:
		rule_names.add(alt_rule)

	if not rule_names:
		return True

	statuses = frappe.get_all(
		"Seal Billing Rate",
		filters={"name": ["in", list(rule_names)]},
		pluck="approval_status",
	)
	return all(status == "Approved" for status in statuses)


@frappe.whitelist()
def reject_seal_billing_rate(name, remarks=None):
	_ensure_managing_director_role()
	doc = frappe.get_doc("Seal Billing Rate", name)
	doc.flags.approval_action = True
	doc.approval_status = "Rejected"
	doc.approved_by = frappe.session.user
	doc.approved_on = now_datetime()
	doc.approval_remarks = remarks
	# See approve_seal_billing_rate: Leasing rules need the same
	# in_import bypass to re-save past the Subscription-only options check.
	frappe.flags.in_import = True
	try:
		doc.save(ignore_permissions=True)
	finally:
		frappe.flags.in_import = False
	frappe.db.commit()
	_notify_rule_owner_decision(doc, approved=False, remarks=remarks)
	return doc.as_dict()
