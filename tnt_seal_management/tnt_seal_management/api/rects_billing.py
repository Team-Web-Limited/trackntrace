# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

"""RECTs is prepaid. The customer's billing rule sets the period (its
Frequency, or First Period Days) and the price of each period; a Sales Order is
raised and submitted at the start of every period (when the billing is saved or
approved, then daily as periods roll over) and the customer's RECTs work —
new RECTs journey requests and seal sales — is blocked until it is paid, either
by an advance payment against the order or by paying its invoice(s). Journeys in
a prepaid period carry no per-journey charge. Seals sold from the warehouse
raise their own Sales Order when the Material Transfer is approved.

Prepay covers the RECTs side of a customer only: a customer with the RECTS
branch ticked prepays for its RECTs journeys; if ECTS is ticked too, its TNT
(PCB) journeys stay billed per completed journey and the period dates here never
touch the assignment's effective dates, which the TNT side relies on.

ERPNext's own Subscription only generates Sales Invoices, so RECTs customers do
not get a recurring Subscription; the period dates on the customer's billing
assignment (``billed_from``/``billed_to``) are the schedule instead.

Both kinds of order are marked on ``custom_rects_order_type`` so the Sales Order
list can colour them. Turning ``rects_auto_invoice`` on in the site config also
drafts the period's Sales Invoice; it is off."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, today

ORDER_TYPE_BILLING = "RECTs Billing"
ORDER_TYPE_SEAL_SALE = "RECTs Seal Sale"
MAX_CATCH_UP_PERIODS = 12
RECTS_SYSTEM = "RECTs"


def is_rects_customer(customer):
	"""A customer on RECTs only (RECTS branch ticked, ECTS not)."""
	rects, ects = frappe.db.get_value("Customer", customer, ["custom_division_rects", "custom_division_ects"]) or (0, 0)
	return bool(cint(rects) and not cint(ects))


def prepays_rects(customer):
	"""A customer whose RECTs side is prepaid: the RECTS branch is ticked (alone
	or alongside ECTS)."""
	return bool(customer and cint(frappe.db.get_value("Customer", customer, "custom_division_rects")))


def _primary_assignment(customer):
	return frappe.db.get_value(
		"Customer Billing Assignment",
		{"assignment_type": "Customer", "customer": customer, "active": 1, "is_extra_billing": 0},
		["name", "billing_rule", "outright_purchase", "owned_seal_count", "billed_from", "billed_to", "last_sales_order"],
		order_by="priority desc, modified desc",
		as_dict=True,
	)


def is_upfront_billed(customer, system=None):
	"""True when a journey of ``system`` (RECTs / PCB) for ``customer`` is covered
	by the RECTs prepaid period, so it carries no per-journey charge. A RECTs-only
	customer's journeys all are; a customer on both branches only its RECTs ones."""
	if not prepays_rects(customer):
		return False
	if system != RECTS_SYSTEM and not (system is None and is_rects_customer(customer)):
		return False
	return bool(_primary_assignment(customer) and prepay_started_on(customer))


def prepay_started_on(customer):
	"""The start of the customer's first prepaid RECTs period (from its period
	Sales Orders, referenced "<assignment>:<period start>"), or None."""
	refs = frappe.get_all(
		"Sales Order",
		filters={"customer": customer, "custom_rects_order_type": ORDER_TYPE_BILLING, "docstatus": ["<", 2]},
		pluck="custom_rects_reference",
	)
	starts = [getdate(ref.rsplit(":", 1)[1]) for ref in refs if ref and ":" in ref]
	return min(starts) if starts else None


def is_journey_prepaid(customer, system, start_date):
	"""A journey covered by RECTs prepay: a RECTs journey (or any journey of a
	RECTs-only customer) starting on or after the first prepaid period. Journeys
	from before prepay began keep their per-journey charge."""
	if not start_date or not is_upfront_billed(customer, system):
		return False
	started = prepay_started_on(customer)
	return bool(started and getdate(start_date) >= started)


def _period_days(rule_name_or_type, first_period_days=None):
	from tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate import PERIOD_TYPE_DAYS

	return PERIOD_TYPE_DAYS.get(rule_name_or_type) or cint(first_period_days) or 30


def _rule_period_days(rule_name):
	rule = frappe.db.get_value("Seal Billing Rate", rule_name, ["billing_period_type", "first_period_days"], as_dict=True)
	return _period_days(rule.billing_period_type, rule.first_period_days) if rule else 30


def resolve_period(customer, billing_period_type, first_period_days=None):
	"""(from, to) the customer's current upfront period, driven by Frequency:
	the running period when one is still open, otherwise today for one Frequency."""
	a = _primary_assignment(customer)
	if a and a.billed_to and getdate(a.billed_to) >= getdate(today()):
		return a.billed_from, a.billed_to
	days = _period_days(billing_period_type, first_period_days)
	start = today()
	return start, add_days(start, days - 1)


def _new_sales_order(customer, order_type, reference, currency=None, billing_type=None):
	from tnt_seal_management.tnt_seal_management.api.completed_journeys import _get_business_line

	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.transaction_date = today()
	so.custom_rects_order_type = order_type
	so.custom_rects_reference = reference
	if currency:
		so.currency = currency
	business_line = _get_business_line(billing_type) if billing_type else None
	if business_line:
		so.cost_center = business_line
	so.append("custom_installation_location", {
		"contact_name": "N/A", "contact_mobile_no": "N/A", "vehicle_registration_no": "N/A",
		"vehicle_model": "N/A", "vehicle_make": "N/A", "vehicle_colour": "N/A", "location": "N/A",
	})
	return so


def _finish_sales_order(so, customer, submit=False):
	from tnt_seal_management.tnt_seal_management.api.completed_journeys import _apply_sales_order_taxes
	from tnt_seal_management.tnt_seal_management.api.current_customers import TAX_CATEGORY_NORMAL

	tax_category = frappe.db.get_value("Customer", customer, "custom_tax_category") or TAX_CATEGORY_NORMAL
	if tax_category != TAX_CATEGORY_NORMAL:
		so.tax_category = tax_category
	_apply_sales_order_taxes(so, tax_category)
	so.insert(ignore_permissions=True, ignore_mandatory=True)
	if submit:
		_submit_period_order(so)
	return so


def _submit_period_order(so):
	"""Submit the period's order so payment can be taken against it. If ERPNext
	refuses (a missing price list, account…), it stays a draft for Finance and
	the customer stays blocked until it is submitted and paid."""
	frappe.db.savepoint("rects_period_order_submit")
	try:
		so.flags.ignore_permissions = True
		so.submit()
	except Exception:
		frappe.db.rollback(save_point="rects_period_order_submit")
		so.reload()
		frappe.log_error(title=f"RECTs period Sales Order {so.name} not submitted", message=frappe.get_traceback())
		return
	_maybe_invoice(so)


def _maybe_invoice(so):
	"""Off unless site config ``rects_auto_invoice``: drafts the submitted
	order's Sales Invoice for Finance."""
	if not frappe.conf.get("rects_auto_invoice") or so.docstatus != 1:
		return None
	from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

	invoice = make_sales_invoice(so.name)
	invoice.insert(ignore_permissions=True)
	return invoice.name


def _billing_ready(customer, rule_name):
	"""A period can be billed: the Managing Director has approved the rule and
	the customer is enabled again (it stays disabled while any of its rules,
	the Import/Export one included, waits for approval)."""
	return bool(rule_name) and frappe.db.get_value("Seal Billing Rate", rule_name, "approval_status") == "Approved" and not cint(
		frappe.db.get_value("Customer", customer, "disabled")
	)


def _rects_rule(customer, assignment=None):
	"""The rule that prices the customer's RECTs periods. A RECTs-only customer's
	billing (RECTs Customer Billing page) is its RECTs billing. A customer also on
	ECTS has a TNT rate there, which is no RECTs price, so it needs its own RECTs
	rate (Customer.custom_rects_billing_rule), set on the RECTs Customer Billing
	page — None until one is set."""
	if is_rects_customer(customer):
		assignment = assignment or _primary_assignment(customer)
		return assignment.billing_rule if assignment else None
	if not frappe.get_meta("Customer").has_field(RECTS_RULE_FIELD):
		return None
	return frappe.db.get_value("Customer", customer, RECTS_RULE_FIELD)


# Item a prepaid RECTs period is billed on, kept apart from the PCB (ECTS)
# items. The first entry is the RECTs item (created by the
# create_rects_period_items patch); the rest are the items it copies its group
# and income accounts from.
PERIOD_ITEMS = {
	"Leasing": ("RECTs-LEASING", "E-Seal Leasing", "PCB-LEASING"),
	"Subscription": ("RECTs-SUBSCRIPTION", "E-Seal Monthly Subscription", "PCB SUBSCRIPTIONS"),
}


def _period_item(billing_type):
	item = (PERIOD_ITEMS.get(billing_type) or PERIOD_ITEMS["Subscription"])[0]
	if not frappe.db.get_value("Item", {"name": item, "disabled": 0}):
		frappe.throw(_("Item {0} is missing or disabled: RECTs prepaid periods are billed on it.").format(item))
	return item


def _period_sales_order(customer, assignment, period_from, period_to):
	rule_name = _rects_rule(customer, assignment)
	rule = rule_name and frappe.db.get_value(
		"Seal Billing Rate",
		rule_name,
		["billing_type", "currency", "first_period_amount", "owned_rate_per_seal"],
		as_dict=True,
	)
	if not rule:
		return None
	billing_type = rule.billing_type
	item = _period_item(billing_type)
	seals, per_seal = cint(assignment.owned_seal_count), flt(rule.owned_rate_per_seal)
	if is_rects_customer(customer) and cint(assignment.outright_purchase) and seals > 0 and per_seal > 0:
		qty, rate = seals, per_seal
	else:
		qty, rate = 1, flt(rule.first_period_amount)
	if rate <= 0:
		return None

	so = _new_sales_order(customer, ORDER_TYPE_BILLING, f"{assignment.name}:{period_from}", rule.currency, billing_type)
	so.append("items", {
		"item_code": item,
		"qty": qty,
		"rate": rate,
		"price_list_rate": rate,
		"description": _("RECTs prepaid billing {0} to {1}").format(period_from, period_to),
		"delivery_date": today(),
	})
	return _finish_sales_order(so, customer, submit=True)


def _start_period(customer, assignment, period_from, period_to):
	"""Raise the period's Sales Order and record the period on the assignment.
	A RECTs-only customer's assignment is effective for exactly the paid period;
	a customer also on ECTS keeps its own effective dates (its TNT journeys bill
	off them)."""
	so = _period_sales_order(customer, assignment, period_from, period_to)
	if not so:
		return None
	values = {"billed_from": period_from, "billed_to": period_to, "last_sales_order": so.name}
	if is_rects_customer(customer):
		values.update({"effective_from": period_from, "effective_to": period_to})
	frappe.db.set_value("Customer Billing Assignment", assignment.name, values)
	return so


def on_billing_saved(customer):
	"""After Set Billing (Local) is saved for a customer
	with the RECTS branch: raise the Sales Order for the first prepaid period. A
	period already running keeps its order; changed terms apply from the next one.
	Billing still waiting for approval starts its first period once approved (see
	on_billing_approved). Returns the Sales Order name, or None."""
	if not prepays_rects(customer):
		return None
	a = _primary_assignment(customer)
	rule_name = _rects_rule(customer, a)
	if not a or not rule_name:
		return None
	if a.billed_to and getdate(a.billed_to) >= getdate(today()):
		frappe.msgprint(
			_("The current RECTs period ({0} to {1}) is already billed on {2}. Changed terms apply from the next period.").format(
				a.billed_from, a.billed_to, a.last_sales_order
			),
			alert=True,
		)
		return None
	if not _billing_ready(customer, rule_name):
		frappe.msgprint(
			_("The RECTs prepaid Sales Order is raised once the Managing Director approves the billing."), alert=True
		)
		return None
	start = today()
	end = add_days(start, _rule_period_days(rule_name) - 1)
	so = _start_period(customer, a, start, end)
	if not so:
		frappe.msgprint(_("No Sales Order raised: the billing rate is zero."), alert=True, indicator="orange")
		return None
	frappe.msgprint(
		_("RECTs prepaid Sales Order {0} raised for {1} to {2}.").format(so.name, start, end), alert=True, indicator="green"
	)
	return so.name


def on_billing_approved(customers):
	"""Customers whose billing was just fully approved: start the first prepaid
	period for each RECTs one that has none running yet."""
	for customer in customers or []:
		try:
			_catch_up(customer)
		except Exception:
			frappe.log_error(title=f"RECTs first period {customer}", message=frappe.get_traceback())


def _catch_up(customer):
	"""Bring the customer's prepaid periods up to today: start the first one if
	none was ever billed, then one per period that has ended (up to a year)."""
	if not prepays_rects(customer):
		return
	for _i in range(MAX_CATCH_UP_PERIODS):
		a = _primary_assignment(customer)
		rule_name = _rects_rule(customer, a)
		if not a or not _billing_ready(customer, rule_name):
			return
		if a.billed_to and getdate(a.billed_to) >= getdate(today()):
			return
		start = add_days(a.billed_to, 1) if a.billed_to else today()
		end = add_days(start, _rule_period_days(rule_name) - 1)
		if not _start_period(customer, a, start, end):
			return


def raise_due_cycle_sales_orders():
	"""Daily: every customer with the RECTS branch and RECTs billing gets the
	Sales Order for each prepaid period that is due (the first one too, if the
	billing was set before prepay existed or its rule was approved later)."""
	rows = frappe.db.sql(
		"""select distinct a.customer from `tabCustomer Billing Assignment` a
		join `tabCustomer` c on c.name = a.customer
		where a.assignment_type = 'Customer' and a.active = 1 and a.is_extra_billing = 0
		and c.custom_division_rects = 1 and (a.billed_to is null or a.billed_to < %s)""",
		today(),
		pluck=True,
	)
	for customer in rows:
		try:
			_catch_up(customer)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"RECTs cycle Sales Order {customer}", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# Prepay gate
# ---------------------------------------------------------------------------

def sales_order_paid(sales_order):
	"""True when the order is submitted and settled: advance payments against it
	cover the total, or it is fully invoiced and those invoices are paid."""
	so = frappe.db.get_value(
		"Sales Order", sales_order, ["docstatus", "grand_total", "rounded_total", "advance_paid", "per_billed"], as_dict=True
	)
	if not so or so.docstatus != 1:
		return False
	total = flt(so.rounded_total) or flt(so.grand_total)
	if total <= 0 or flt(so.advance_paid) >= total - 0.01:
		return True
	if flt(so.per_billed) < 99.99:
		return False
	outstanding = frappe.db.sql(
		"""select sum(si.outstanding_amount) from `tabSales Invoice` si
		where si.docstatus = 1 and si.name in (
			select distinct sii.parent from `tabSales Invoice Item` sii where sii.sales_order = %s)""",
		sales_order,
	)
	return flt(outstanding[0][0] if outstanding else 0) <= 0.01


def _missing_billing_message(customer, a=None):
	"""Why the customer has no RECTs billing to prepay against, or None."""
	if not prepays_rects(customer):
		return None
	a = a or _primary_assignment(customer)
	if not a:
		return _("{0} is a RECTs customer with no billing set. RECTs is prepaid: Finance must set the customer's billing first.").format(customer)
	if not _rects_rule(customer, a):
		return _("{0} is on both ECTS and RECTS but has no RECTs billing. RECTs is prepaid: Finance must set its billing on the RECTs Customer Billing page first.").format(customer)
	return None


def prepay_status(customer):
	"""Where the customer's RECTs prepay stands: {"ok": bool, "message": str,
	"missing_billing": bool, "sales_order", "period_from", "period_to"}. ``ok``
	with no message for a customer without the RECTS branch."""
	result = frappe._dict(ok=True, message=None, missing_billing=False, sales_order=None, period_from=None, period_to=None)
	if not prepays_rects(customer):
		return result
	a = _primary_assignment(customer)
	missing = _missing_billing_message(customer, a)
	if missing:
		result.update(ok=False, missing_billing=True, message=missing)
		return result
	rule_name = _rects_rule(customer, a)
	if not _billing_ready(customer, rule_name):
		result.update(ok=False, message=_("{0}'s RECTs billing is waiting for the Managing Director's approval.").format(customer))
		return result
	if not a.billed_to or getdate(a.billed_to) < getdate(today()):
		_catch_up(customer)
		a = _primary_assignment(customer)
	if not a.billed_to or getdate(a.billed_to) < getdate(today()) or not a.last_sales_order:
		result.update(
			ok=False,
			missing_billing=True,
			message=_("{0} has no prepaid RECTs period running: its RECTs billing rate is zero.").format(customer),
		)
		return result
	result.update(sales_order=a.last_sales_order, period_from=a.billed_from, period_to=a.billed_to)
	if not sales_order_paid(a.last_sales_order):
		result.update(
			ok=False,
			message=_("{0} has not paid for the RECTs period {1} to {2} (Sales Order {3}). RECTs is prepaid: record the payment against the order or its invoice first.").format(
				customer, a.billed_from, a.billed_to, a.last_sales_order
			),
		)
	return result


def ensure_prepaid(customer, title=None, allow_unbilled=False):
	"""Throw unless the customer's current RECTs period is paid. With
	``allow_unbilled`` a customer with no billing set yet passes (a first seal
	sale comes before the billing is set up, and carries its own order).
	Missing billing also warns Finance."""
	status = prepay_status(customer)
	if status.ok:
		return
	if status.missing_billing:
		warn_finance_missing_billing(customer, status.message)
		if allow_unbilled:
			return
	frappe.throw(status.message, title=title or _("RECTs Prepayment Required"))


@frappe.whitelist()
def get_prepay_status(customer):
	return prepay_status(customer)


# ---------------------------------------------------------------------------
# Finance warning: a RECTs customer with no billing
# ---------------------------------------------------------------------------

FINANCE_ROLE = "Finance PCB"


def warn_finance_missing_billing(customer, message=None):
	"""Tell Finance (bell + email) that a RECTs customer needs its billing set,
	at most once a day per customer. Queued, so it still goes out when the
	journey request that triggered it is refused and rolled back."""
	message = message or _missing_billing_message(customer)
	if not message:
		return
	key = f"rects_missing_billing_warned:{customer}:{today()}"
	cache = frappe.cache()
	if cache.get_value(key, expires=True):
		return
	cache.set_value(key, 1, expires_in_sec=86400)
	frappe.enqueue(
		"tnt_seal_management.tnt_seal_management.api.rects_billing._send_finance_warning",
		queue="short",
		customer=customer,
		message=message,
		enqueue_after_commit=False,
	)


def _send_finance_warning(customer, message):
	from tnt_seal_management.tnt_seal_management.api.notifications import get_users_with_role, notify_users

	link = "/app/customer-billing/rects"
	notify_users(
		get_users_with_role(FINANCE_ROLE),
		_("RECTs customer needs billing: {0}").format(customer),
		"<br>".join(
			[
				message,
				_("New RECTs journey requests for this customer are blocked until it is set, approved and the period is paid."),
			]
		),
		document_type="Customer",
		document_name=customer,
		link=link,
	)
	frappe.db.commit()


def on_customer_update(doc, method=None):
	"""Customer saved with the RECTS branch newly ticked and no RECTs billing:
	warn Finance straight away."""
	if cint(doc.get("custom_division_rects")) and (doc.is_new() or doc.has_value_changed("custom_division_rects")
		or doc.has_value_changed("custom_division_ects")):
		message = _missing_billing_message(doc.name)
		if message:
			warn_finance_missing_billing(doc.name, message)


# ---------------------------------------------------------------------------
# RECTs rate of customers on both ECTS and RECTS (set on RECTs Customer Billing)
# ---------------------------------------------------------------------------

RECTS_RULE_FIELD = "custom_rects_billing_rule"
RECTS_RULE_CUSTOM_FIELD = {
	"fieldname": RECTS_RULE_FIELD,
	"fieldtype": "Link",
	"label": "RECTs Prepay Rate",
	"options": "Seal Billing Rate",
	"insert_after": "custom_division_rects",
	"read_only": 1,
	"no_copy": 1,
	"depends_on": "eval:doc.custom_division_rects && doc.custom_division_ects",
	"description": "What this customer prepays for RECTs each period. Only for customers on both ECTS and RECTS "
	"(RECTs-only customers keep it on their billing assignment). Set it on the RECTs Customer Billing page.",
}
def create_seal_sale_order(stock_entry, customer, lines):
	"""One Sales Order for the seals a Material Transfer sold to ``customer``:
	``lines`` is {item_code: [serial, ...]}. Priced from the item's selling price."""
	reference = stock_entry
	if frappe.db.exists("Sales Order", {"custom_rects_reference": reference, "docstatus": ["<", 2]}):
		return None
	so = _new_sales_order(customer, ORDER_TYPE_SEAL_SALE, reference)
	for item_code, serials in lines.items():
		rate = frappe.db.get_value("Item Price", {"item_code": item_code, "selling": 1}, "price_list_rate") \
			or frappe.db.get_value("Item", item_code, "standard_rate") or 0
		so.append("items", {
			"item_code": item_code,
			"qty": len(serials),
			"rate": flt(rate),
			"price_list_rate": flt(rate),
			"description": _("Seals sold from stock ({0}): {1}").format(stock_entry, ", ".join(serials)),
			"delivery_date": today(),
		})
	if not so.items:
		return None
	return _finish_sales_order(so, customer).name
