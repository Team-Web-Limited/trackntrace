# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""
Completed Journeys — per-customer consolidated billing view.

Replaces the old "Completed Journeys Report" script report with a single
whitelisted method that returns journeys already grouped by customer, each
group carrying its own Normal/Extra/VAT/Total Payable billing summary
(first_period_amount / extra_day_amount / total_charge are already computed
per journey by Seal Journey's billing logic — see billing.py).
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

from tnt_seal_management.tnt_seal_management.api.seal_lease_billing import (
	LEASE_ITEM,
	OWNERSHIP_ITEM,
	INTERVAL_REVERSE,
)
from tnt_seal_management.tnt_seal_management.api.current_customers import (
	TAX_CATEGORY_NORMAL,
	TAX_CATEGORY_EXEMPT,
	TAX_CATEGORY_ZERO_RATED,
)

VAT_RATE = 0.16

# Tax Exempt and Zero Rated customers both owe no VAT on their total payable —
# they differ for statutory reporting, not for this calculation.
_ZERO_VAT_CATEGORIES = frozenset({TAX_CATEGORY_EXEMPT, TAX_CATEGORY_ZERO_RATED})


def _get_customer_tax_categories(customer_names):
	"""Return {customer: tax_category}, defaulting to Normal Tax when unset."""
	if not customer_names:
		return {}
	rows = frappe.get_all(
		"Customer",
		filters={"name": ["in", list(customer_names)]},
		fields=["name", "custom_tax_category"],
	)
	return {r.name: r.custom_tax_category or TAX_CATEGORY_NORMAL for r in rows}


def _vat_rate_for_category(tax_category):
	return 0.0 if tax_category in _ZERO_VAT_CATEGORIES else VAT_RATE

# Human labels for the recurring subscription line items (Scenarios 4-6).
_RECURRING_ITEM_LABELS = {
	LEASE_ITEM: _("Recurring Lease Fee (leased seals)"),
	OWNERSHIP_ITEM: _("Ownership Service Fee (owned seals)"),
}

_ALLOWED_ROLES = frozenset({
	"System Manager", "Finance PCB", "Accounts Manager", "Accounts User",
})

_FIELDS = [
	"name", "customer", "container_number", "vehicle_plate_number",
	"origin", "destination", "tagging_date_time", "arrival_date_time",
	"untagging_completed_date_time", "completion_date_time",
	"assigned_seal", "file_number", "days_taken", "days_taken_display",
	"contact_person_name", "departure_card_number", "retrieval_card_number",
	"total_charge", "first_period_amount", "extra_day_amount", "seal_count",
	"extra_billing_amount", "extra_billing_seal_count",
	"sales_order_reference", "billing_status", "extra_days",
]


@frappe.whitelist()
def get_completed_journeys(from_date=None, to_date=None, customer=None):
	"""Return Completed journeys grouped by customer, each with a billing
	summary. Shape: {"customers": [...], "grand_total": {...} | None}."""
	_require_billing_permission()

	journeys = _fetch_journeys(from_date, to_date, customer)
	return _build_customer_groups(journeys, customer)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_valid_customers_for_filter(doctype, txt, searchfield, start, page_len, filters):
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")
	to_datetime = f"{to_date} 23:59:59" if to_date else None

	conditions = ["journey_status = 'Completed'"]
	values = []

	if from_date and to_datetime:
		conditions.append("completion_date_time between %s and %s")
		values.extend([from_date, to_datetime])
	elif from_date:
		conditions.append("completion_date_time >= %s")
		values.append(from_date)
	elif to_datetime:
		conditions.append("completion_date_time <= %s")
		values.append(to_datetime)

	condition_str = " and ".join(conditions) if conditions else "1=1"

	journey_customers = frappe.db.sql(f"""
		select distinct customer from `tabSeal Journey`
		where {condition_str}
	""", tuple(values), as_dict=True)

	valid_customers = {r.customer for r in journey_customers if r.customer}
	
	recurring = _get_recurring_fees_by_customer(None)
	valid_customers.update(recurring.keys())

	if not valid_customers:
		return []

	return frappe.db.sql(f"""
		select name from `tabCustomer`
		where name in %s and name like %s
		order by name asc
		limit %s, %s
	""", (tuple(valid_customers), f"%{txt}%", cint(start), cint(page_len)))


def _require_billing_permission():
	if not set(frappe.get_roles(frappe.session.user)) & _ALLOWED_ROLES:
		frappe.throw(_("Not permitted to view completed journey billing data."), frappe.PermissionError)


def _fetch_journeys(from_date, to_date, customer):
	conditions = {"journey_status": "Completed"}
	if customer:
		conditions["customer"] = customer

	to_datetime = f"{to_date} 23:59:59" if to_date else None
	if from_date and to_datetime:
		conditions["completion_date_time"] = ["between", [from_date, to_datetime]]
	elif from_date:
		conditions["completion_date_time"] = [">=", from_date]
	elif to_datetime:
		conditions["completion_date_time"] = ["<=", to_datetime]

	journeys = frappe.get_all(
		"Seal Journey",
		filters=conditions,
		fields=_FIELDS,
		order_by="customer asc, completion_date_time asc",
	)
	if not journeys:
		return []

	seals_by_journey = _get_seals_by_journey([j["name"] for j in journeys])
	for j in journeys:
		# Container falls back to the vehicle plate when no container is recorded.
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		# Prefer the concatenated list of journey seals; fall back to the primary seal.
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	return journeys


def _get_seals_by_journey(journey_names):
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


def _build_customer_groups(journeys, customer_filter=None):
	groups = {}
	order = []
	for j in journeys:
		c = j["customer"]
		if c not in groups:
			groups[c] = []
			order.append(c)
		groups[c].append(j)

	# Recurring subscription fees (Scenarios 4-6) — billed independently of
	# journeys, but merged into each customer's summary so the per-customer
	# view reads as one consolidated invoice (the PDF's Scenario 6 requirement).
	recurring_by_customer = _get_recurring_fees_by_customer(customer_filter)

	# Surface customers who carry a recurring subscription but had no completed
	# journeys in the period — they still owe the recurring fee.
	for cust in recurring_by_customer:
		if cust not in groups:
			groups[cust] = []
			order.append(cust)

	tax_category_by_customer = _get_customer_tax_categories(order)

	customers = []
	for c in order:
		group = groups[c]
		recurring = recurring_by_customer.get(c, [])
		tax_category = tax_category_by_customer.get(c, TAX_CATEGORY_NORMAL)
		customers.append({
			"customer": c,
			"journeys": group,
			"journey_count": len(group),
			"total_days_taken": sum(flt(j.get("days_taken")) for j in group),
			"recurring_fees": recurring,
			"tax_category": tax_category,
			"summary": _billing_summary(group, recurring, tax_category),
		})

	grand_total = None
	if len(customers) > 1:
		# Customers can carry different tax categories, so the grand total is
		# summed from each customer's own already-correctly-rated summary
		# rather than recomputed with a single VAT rate.
		grand_total = _sum_summaries([c["summary"] for c in customers])
		grand_total["journey_count"] = len(journeys)

	return {"customers": customers, "grand_total": grand_total}


@frappe.whitelist()
def generate_sales_order(customer, from_date=None, to_date=None):
	"""Generate a Sales Order for a customer's unbilled completed journeys."""
	_require_billing_permission()

	if not customer:
		frappe.throw(_("Customer is required to generate a Sales Order."))

	# Filter specifically for unbilled journeys
	conditions = {
		"journey_status": "Completed",
		"customer": customer,
		"billing_status": ["in", ["Pending Billing", "No Per-Journey Charge"]],
		"sales_order_reference": ["in", ["", None]]
	}
	to_datetime = f"{to_date} 23:59:59" if to_date else None
	if from_date and to_datetime:
		conditions["completion_date_time"] = ["between", [from_date, to_datetime]]
	elif from_date:
		conditions["completion_date_time"] = [">=", from_date]
	elif to_datetime:
		conditions["completion_date_time"] = ["<=", to_datetime]

	journeys = frappe.get_all(
		"Seal Journey",
		filters=conditions,
		fields=_FIELDS,
		order_by="completion_date_time asc",
	)

	seals_by_journey = _get_seals_by_journey([j["name"] for j in journeys])
	for j in journeys:
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	# We reuse _build_customer_groups to calculate the total charges
	group_data = _build_customer_groups(journeys, customer)
	customer_data = group_data["customers"][0] if group_data["customers"] else None

	if not customer_data or (not journeys and not customer_data.get("recurring_fees")):
		frappe.throw(_("No unbilled completed journeys or active recurring subscription fees found for this customer in the selected period."))

	summary = customer_data["summary"]
	recurring_fees = customer_data["recurring_fees"]

	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.transaction_date = frappe.utils.today()
	if summary.get("tax_category") and summary["tax_category"] != TAX_CATEGORY_NORMAL:
		so.tax_category = summary["tax_category"]

	so.append("custom_installation_location", {
		"contact_name": "N/A",
		"contact_mobile_no": "N/A",
		"vehicle_registration_no": "N/A",
		"vehicle_model": "N/A",
		"vehicle_make": "N/A",
		"vehicle_colour": "N/A",
		"location": "N/A"
	})

	def add_item(item_code, qty, rate, description):
		if flt(rate) > 0 or flt(qty) > 0:
			so.append("items", {
				"item_code": item_code,
				"qty": qty,
				"rate": rate,
				"price_list_rate": rate,
				"description": description,
				"delivery_date": frappe.utils.today()
			})

	rental_item = "SJ-Subscription"
	extra_item = "Extra Days" if frappe.db.exists("Item", "Extra Days") else "SJ-Subscription"

	if flt(summary["normal_charges"]) > 0:
		# Quantity is the number of journeys, and rate is the baseline charge rate per journey
		journey_count = max(len(journeys), 1)
		rate = flt(summary["normal_charges"]) / journey_count
		add_item(rental_item, journey_count, rate, "Completed Journeys - Normal Charges")
	
	if flt(summary["extra_charges"]) > 0:
		# Quantity is the total extra days across all journeys, and rate is the extra day rate
		extra_days = sum(cint(j.get("extra_days")) * max(cint(j.get("seal_count")), 1) for j in journeys)
		if extra_days > 0:
			rate = flt(summary["extra_charges"]) / extra_days
			add_item(extra_item, extra_days, rate, "Completed Journeys - Extra Charges for Extra Days")
		else:
			# Fallback if extra days is 0 (should not happen if extra_charges > 0)
			add_item(extra_item, 1, summary["extra_charges"], "Completed Journeys - Extra Charges for Extra Days")

	if flt(summary["extra_billing_total"]) > 0:
		add_item(rental_item, 1, summary["extra_billing_total"], "Completed Journeys - Extra Billing (leased seals)")

	for r in recurring_fees:
		if flt(r["amount"]) > 0:
			# The recurring items might be set up in ERPNext, but we fallback to rental_item if needed.
			# Using rental_item to avoid Missing Item errors.
			add_item(rental_item, r["seal_count"], r["rate"], f"{r['label']} - {r['billing_interval']}")

	if not so.items:
		frappe.throw(_("Total billable amount is zero. No Sales Order created."))

	so.insert(ignore_permissions=True, ignore_mandatory=True)

	for j in journeys:
		frappe.db.set_value("Seal Journey", j["name"], {
			"sales_order_reference": so.name,
			"billing_status": "Processing Payment"
		})

	frappe.db.commit()

	return so.name


def _sum_summaries(summaries):
	total_cost = sum(s["total_cost"] for s in summaries)
	vat = sum(s["vat"] for s in summaries)

	# Customers can carry different tax categories, so there is no single VAT
	# rate to report once mixed — a blended average (e.g. "VAT @11%") reads as
	# a real rate and confuses. When every customer shares the same rate we
	# still show it; otherwise the client just labels the line "VAT".
	distinct_rates = {s["vat_rate"] for s in summaries}
	mixed_vat_rates = len(distinct_rates) > 1

	return {
		"normal_charges": sum(s["normal_charges"] for s in summaries),
		"extra_charges": sum(s["extra_charges"] for s in summaries),
		"journey_total": sum(s["journey_total"] for s in summaries),
		"extra_billing_total": sum(s["extra_billing_total"] for s in summaries),
		"recurring_total": sum(s["recurring_total"] for s in summaries),
		"total_cost": total_cost,
		"vat_rate": None if mixed_vat_rates else next(iter(distinct_rates), 0.0),
		"mixed_vat_rates": mixed_vat_rates,
		"vat": vat,
		"total_payable": total_cost + vat,
	}


def _get_recurring_fees_by_customer(customer_filter=None):
	"""Return {customer: [fee, ...]} of active recurring subscription line items
	(Seal Lease Fee / Seal Ownership Service Fee) for the given customer, or all
	customers when unfiltered. Each fee is one Subscription Plan row expanded to
	its per-cycle amount (seal_count * rate)."""
	sub_filters = {"party_type": "Customer", "status": ["!=", "Cancelled"]}
	if customer_filter:
		sub_filters["party"] = customer_filter

	subs = frappe.get_all("Subscription", filters=sub_filters, fields=["name", "party"])
	if not subs:
		return {}

	party_by_sub = {s.name: s.party for s in subs}
	rows = frappe.get_all(
		"Subscription Plan Detail",
		filters={"parent": ["in", list(party_by_sub)]},
		fields=["parent", "plan", "qty"],
	)
	if not rows:
		return {}

	plan_names = list({r.plan for r in rows})
	plans = {
		p.name: p
		for p in frappe.get_all(
			"Subscription Plan",
			filters={"name": ["in", plan_names]},
			fields=["name", "item", "cost", "currency", "billing_interval", "billing_interval_count"],
		)
	}

	fees_by_customer = {}
	for row in rows:
		plan = plans.get(row.plan)
		if not plan or plan.item not in _RECURRING_ITEM_LABELS:
			continue
		seal_count = cint(row.qty)
		rate = flt(plan.cost)
		interval_label = INTERVAL_REVERSE.get(
			(plan.billing_interval, cint(plan.billing_interval_count)), plan.billing_interval
		)
		fees_by_customer.setdefault(party_by_sub[row.parent], []).append({
			"item": plan.item,
			"label": _RECURRING_ITEM_LABELS[plan.item],
			"seal_count": seal_count,
			"rate": rate,
			"amount": seal_count * rate,
			"currency": plan.currency,
			"billing_interval": interval_label,
		})

	return fees_by_customer


def _billing_summary(group, recurring=None, tax_category=None):
	"""Normal Charges / Extra Charges / Extra Billing / Recurring Fees / Total
	Cost / VAT / Total Payable for a set of journeys plus any recurring
	subscription fees. first_period_amount and extra_day_amount are stored
	per-seal on Seal Journey, so scale each by the journey's seal_count before
	summing (mirrors how total_charge itself is computed). extra_billing_amount
	(Scenario 6 — leased seals beyond an outright-purchase customer's owned
	pool, see billing.resolve_customer_extra_billing) is already a per-journey
	total, not per-seal, so it's summed as-is. Tax Exempt / Zero Rated
	customers owe no VAT — see ``_vat_rate_for_category``."""
	recurring = recurring or []
	tax_category = tax_category or TAX_CATEGORY_NORMAL
	vat_rate = _vat_rate_for_category(tax_category)

	def scaled(fieldname, j):
		return flt(j.get(fieldname)) * max(cint(j.get("seal_count")), 1)

	normal_charges = sum(scaled("first_period_amount", j) for j in group)
	extra_charges = sum(scaled("extra_day_amount", j) for j in group)
	journey_total = sum(flt(j.get("total_charge")) for j in group)
	extra_billing_total = sum(flt(j.get("extra_billing_amount")) for j in group)
	recurring_total = sum(flt(f["amount"]) for f in recurring)
	total_cost = journey_total + extra_billing_total + recurring_total
	vat = total_cost * vat_rate
	total_payable = total_cost + vat

	return {
		"normal_charges": normal_charges,
		"extra_charges": extra_charges,
		"journey_total": journey_total,
		"extra_billing_total": extra_billing_total,
		"recurring_total": recurring_total,
		"total_cost": total_cost,
		"tax_category": tax_category,
		"vat_rate": vat_rate,
		"vat": vat,
		"total_payable": total_payable,
	}

@frappe.whitelist()
def export_pdf(html, filename):
	from frappe.utils.pdf import get_pdf

	# Strip columns that should not appear on the exported statement.
	html = _strip_pdf_columns(html, {"Seal Number", "Departure Card #", "Retrieval Card #"})

	options = {
		"page-size": "A4",
		"orientation": "Landscape",
		"margin-top": "15mm",
		"margin-right": "15mm",
		"margin-bottom": "15mm",
		"margin-left": "15mm"
	}

	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = get_pdf(html, options=options)
	frappe.local.response.type = "pdf"


def _strip_pdf_columns(html, drop_labels):
	"""Remove table columns whose header text is in ``drop_labels``.

	Runs server-side so the export is unaffected by any stale client asset.
	"""
	from bs4 import BeautifulSoup

	soup = BeautifulSoup(html, "html.parser")

	for table in soup.find_all("table"):
		header_row = table.find("tr")
		if not header_row:
			continue

		headers = header_row.find_all(["th", "td"])
		drop_idx = [
			i for i, cell in enumerate(headers)
			if cell.get_text(strip=True) in drop_labels
		]
		if not drop_idx:
			continue

		for row in table.find_all("tr"):
			cells = row.find_all(["th", "td"])
			for i in drop_idx:
				if i < len(cells):
					cells[i].decompose()

	return str(soup)

@frappe.whitelist()
def export_xlsx(data, filename):
	import json
	from io import BytesIO

	import openpyxl
	from openpyxl.styles import Font

	from frappe.desk.utils import provide_binary_file

	data_list = json.loads(data)

	# Labels whose rows should be bolded
	bold_labels = {
		"Customer", "Total Journeys", "Total Days Taken",
		"Journey",  # column header row
		"Summary", "Recurring Subscription Fees",
		"Normal Charges", "Extra Charges for Extra Days",
		"Extra Billing (leased seals)",
		"Total Cost", "Total Payable",
	}
	# Also bold any row whose first cell starts with "VAT"
	bold_font = Font(name="Calibri", bold=True)

	wb = openpyxl.Workbook()
	ws = wb.active
	ws.title = filename[:31] if filename else "Sheet1"

	for row_data in data_list:
		ws.append(row_data if row_data else [])

	# Apply bold formatting
	for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
		first_val = row[0].value
		if first_val and (
			str(first_val) in bold_labels
			or str(first_val).startswith("VAT")
		):
			for cell in row:
				cell.font = bold_font

	# Auto-fit column widths (approximate)
	for col in ws.columns:
		max_len = 0
		col_letter = col[0].column_letter
		for cell in col:
			if cell.value:
				max_len = max(max_len, len(str(cell.value)))
		ws.column_dimensions[col_letter].width = min(max_len + 3, 40)

	xlsx_file = BytesIO()
	wb.save(xlsx_file)
	provide_binary_file(filename, "xlsx", xlsx_file.getvalue())

