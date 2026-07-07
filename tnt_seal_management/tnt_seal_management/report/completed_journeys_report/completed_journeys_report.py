# Copyright (c) 2026, TNT Seal Management and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, flt

from tnt_seal_management.tnt_seal_management.api.current_customers import (
	TAX_CATEGORY_NORMAL,
	TAX_CATEGORY_EXEMPT,
	TAX_CATEGORY_ZERO_RATED,
)

VAT_RATE = 0.16

# Tax Exempt and Zero Rated customers both owe no VAT on their total payable.
_ZERO_VAT_CATEGORIES = frozenset({TAX_CATEGORY_EXEMPT, TAX_CATEGORY_ZERO_RATED})


def _vat_rate_for_category(tax_category):
	return 0.0 if tax_category in _ZERO_VAT_CATEGORIES else VAT_RATE


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"label": _("Journey"), "fieldname": "name", "fieldtype": "Link", "options": "Seal Journey", "width": 130},
		{"label": _("Customer Name"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 180},
		{"label": _("Container/Truck Number"), "fieldname": "container_number", "fieldtype": "Data", "width": 150},
		{"label": _("Origin"), "fieldname": "origin", "fieldtype": "Data", "width": 130},
		{"label": _("Destination"), "fieldname": "destination", "fieldtype": "Data", "width": 130},
		{"label": _("Tagging Date"), "fieldname": "tagging_date_time", "fieldtype": "Datetime", "width": 160},
		{"label": _("Arrival Date"), "fieldname": "arrival_date_time", "fieldtype": "Datetime", "width": 160},
		{"label": _("Un-tagging Date"), "fieldname": "untagging_completed_date_time", "fieldtype": "Datetime", "width": 160},
		{"label": _("Seal Number"), "fieldname": "seal_number", "fieldtype": "Data", "width": 150},
		{"label": _("File Number"), "fieldname": "file_number", "fieldtype": "Data", "width": 120},
		{"label": _("Hours/Days Taken"), "fieldname": "days_taken_display", "fieldtype": "Data", "width": 130},
		{"label": _("Days Taken"), "fieldname": "days_taken", "fieldtype": "Float", "width": 100},
		{"label": _("Contact Person"), "fieldname": "contact_person_name", "fieldtype": "Data", "width": 150},
		{"label": _("Departure Card Number"), "fieldname": "departure_card_number", "fieldtype": "Data", "width": 150},
		{"label": _("Retrieval Card Number"), "fieldname": "retrieval_card_number", "fieldtype": "Data", "width": 150},
		{"label": _("Amount"), "fieldname": "total_charge", "fieldtype": "Currency", "width": 120},
		# Scenario 6 — additional leasing charge for seals leased beyond an
		# outright-purchase customer's owned pool (see
		# billing.resolve_customer_extra_billing / seal_journey.set_extra_billing).
		{"label": _("Extra Billing"), "fieldname": "extra_billing_amount", "fieldtype": "Currency", "width": 120},
	]


def get_conditions(filters):
	conditions = {"journey_status": "Completed"}

	if filters.get("customer"):
		conditions["customer"] = filters.customer

	from_date = filters.get("from_date")
	# completion_date_time is a Datetime; extend the upper bound to end-of-day so
	# journeys completed in the afternoon of to_date are included.
	to_date = filters.get("to_date")
	to_datetime = f"{to_date} 23:59:59" if to_date else None

	if from_date and to_datetime:
		conditions["completion_date_time"] = ["between", [from_date, to_datetime]]
	elif from_date:
		conditions["completion_date_time"] = [">=", from_date]
	elif to_datetime:
		conditions["completion_date_time"] = ["<=", to_datetime]

	return conditions


def get_data(filters):
	journeys = frappe.get_all(
		"Seal Journey",
		filters=get_conditions(filters),
		fields=[
			"name",
			"customer",
			"container_number",
			"vehicle_plate_number",
			"origin",
			"destination",
			"tagging_date_time",
			"arrival_date_time",
			"untagging_completed_date_time",
			"completion_date_time",
			"assigned_seal",
			"file_number",
			"days_taken",
			"days_taken_display",
			"contact_person_name",
			"departure_card_number",
			"retrieval_card_number",
			"total_charge",
			"first_period_amount",
			"extra_day_amount",
			"seal_count",
			"extra_billing_amount",
		],
		# Group by customer first so journeys for the same customer are
		# consolidated together; completion date orders each customer's block.
		order_by="customer asc, completion_date_time asc",
	)

	if not journeys:
		return []

	seals_by_journey = get_seals_by_journey([j["name"] for j in journeys])

	for j in journeys:
		# Container falls back to the vehicle plate when no container is recorded.
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		# Prefer the concatenated list of journey seals; fall back to the primary seal.
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	return consolidate_by_customer(journeys)


def consolidate_by_customer(journeys):
	"""Interleave a subtotal row and a Normal/Extra/VAT/Total Payable billing
	summary after each customer's journeys, plus a grand total row at the end,
	so the report reads as per-customer sections."""
	rows = []
	current_customer = None
	group = []

	def flush_group():
		if not group:
			return
		rows.extend(group)
		rows.append(make_total_row(current_customer, group))
		rows.extend(make_billing_summary_rows(group))

	for j in journeys:
		if j["customer"] != current_customer:
			flush_group()
			group = []
			current_customer = j["customer"]
		group.append(j)
	flush_group()

	if len(set(j["customer"] for j in journeys)) > 1:
		rows.append(make_total_row(_("Grand Total"), journeys, is_grand_total=True))

	return rows


def make_total_row(customer, group, is_grand_total=False):
	return {
		"customer": _("Grand Total") if is_grand_total else _("Total — {0}").format(customer),
		"days_taken_display": _("{0} journey").format(len(group))
		if len(group) == 1
		else _("{0} journeys").format(len(group)),
		"days_taken": sum(j.get("days_taken") or 0 for j in group),
		"total_charge": sum(j.get("total_charge") or 0 for j in group),
		"bold": 1,
		"is_total_row": 1,
	}


def make_billing_summary_rows(group):
	"""Normal Charges / Extra Charges / Extra Billing / Total Cost / VAT / Total
	Payable, for one customer's journeys — first_period_amount and
	extra_day_amount are stored per-seal, so scale each by the journey's
	seal_count before summing. extra_billing_amount (Scenario 6 — see
	billing.resolve_customer_extra_billing) is already a per-journey total, not
	per-seal, so it's summed as-is and folded into Total Cost alongside
	total_charge. VAT is skipped for Tax Exempt / Zero Rated customers (see
	``_vat_rate_for_category``)."""

	def scaled(fieldname, j):
		return flt(j.get(fieldname)) * max(cint(j.get("seal_count")), 1)

	tax_category = frappe.db.get_value("Customer", group[0]["customer"], "custom_tax_category") or TAX_CATEGORY_NORMAL
	vat_rate = _vat_rate_for_category(tax_category)

	normal_charges = sum(scaled("first_period_amount", j) for j in group)
	extra_charges = sum(scaled("extra_day_amount", j) for j in group)
	extra_billing_total = sum(flt(j.get("extra_billing_amount")) for j in group)
	total_cost = sum(flt(j.get("total_charge")) for j in group) + extra_billing_total
	vat = total_cost * vat_rate
	total_payable = total_cost + vat

	def summary_row(label, amount, is_payable=False):
		# The label+amount is written into the "customer" column (always
		# visible without horizontal scrolling); total_charge still carries
		# the raw number for exports/sorting.
		return {
			"customer": f"    {label}: {frappe.utils.fmt_money(amount)}",
			"total_charge": amount,
			"bold": 1,
			"is_summary_row": 1,
			"is_payable_row": is_payable,
		}

	vat_label = _("VAT @{0}%").format(int(vat_rate * 100))
	if tax_category != TAX_CATEGORY_NORMAL:
		vat_label = f"{vat_label} ({_(tax_category)})"

	rows = [
		summary_row(_("Normal Charges"), normal_charges),
		summary_row(_("Extra Charges for Extra Days"), extra_charges),
	]
	if extra_billing_total:
		rows.append(summary_row(_("Extra Billing (leased seals)"), extra_billing_total))
	rows.extend([
		summary_row(_("Total Cost"), total_cost),
		summary_row(vat_label, vat),
		summary_row(_("Total Payable"), total_payable, is_payable=True),
	])
	return rows


def get_seals_by_journey(journey_names):
	"""Return {seal_journey_name: 'SEAL1, SEAL2'} from the journey_seals child table."""
	if not journey_names:
		return {}

	rows = frappe.get_all(
		"Journey Request Seal",
		filters={
			"parenttype": "Seal Journey",
			"parentfield": "journey_seals",
			"parent": ["in", journey_names],
		},
		fields=["parent", "seal_number"],
		order_by="idx asc",
	)

	seals_by_journey = {}
	for row in rows:
		if not row.get("seal_number"):
			continue
		seals_by_journey.setdefault(row["parent"], []).append(row["seal_number"])

	return {parent: ", ".join(seals) for parent, seals in seals_by_journey.items()}
