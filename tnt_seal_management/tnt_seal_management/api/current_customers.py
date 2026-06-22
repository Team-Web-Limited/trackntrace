import frappe
from frappe import _
from frappe.utils import cint, flt


CUSTOMER_BILLING_TYPE_FIELD = "custom_billing_type"

# Standard day counts per fixed contract period. Mirrors the client + Seal
# Billing Rate definitions; amounts are always per-rule, never derived here.
PERIOD_TYPE_DAYS = {
	"Weekly": 7,
	"Monthly": 30,
	"Quarterly": 90,
	"Semi-Annually": 180,
	"Annually": 365,
}


def _get_customer_level_assignment_map(customer_names):
	"""Return {customer: billing_rule} for active, customer-level Customer Billing
	Assignments. Highest priority (then most recent) wins per customer."""
	if not customer_names:
		return {}

	rows = frappe.get_all(
		"Customer Billing Assignment",
		filters={
			"assignment_type": "Customer",
			"customer": ["in", list(customer_names)],
			"active": 1,
		},
		fields=["customer", "billing_rule"],
		order_by="priority desc, modified desc",
	)

	mapping = {}
	for row in rows:
		# First row per customer wins thanks to the ordering above.
		mapping.setdefault(row.customer, row.billing_rule)
	return mapping


def _get_rule_label_map(rule_names):
	"""Return {rule_name: (billing_rule_name, billing_type)} for display labels."""
	names = list({r for r in rule_names if r})
	if not names:
		return {}
	rows = frappe.get_all(
		"Seal Billing Rate",
		filters={"name": ["in", names]},
		fields=["name", "billing_rule_name", "billing_type"],
	)
	return {r.name: (r.billing_rule_name or r.name, r.billing_type or "Default") for r in rows}


SEED_CUSTOMERS = (
	{
		"customer_name": "Apex Transit Limited",
		"mobile_no": "0703143784",
		"email_id": "apextransit@gmail.com",
	},
	{
		"customer_name": "BlueRoute Logistics Ltd",
		"mobile_no": "0703143785",
		"email_id": "blueroutelogistics@gmail.com",
	},
	{
		"customer_name": "CargoSpan East Africa Ltd",
		"mobile_no": "0703143786",
		"email_id": "cargospan@gmail.com",
	},
	{
		"customer_name": "Delta Haulage Kenya Ltd",
		"mobile_no": "0703143787",
		"email_id": "deltahaulage@gmail.com",
	},
	{
		"customer_name": "Frontier Gate Logistics Ltd",
		"mobile_no": "0703143788",
		"email_id": "frontiergate@gmail.com",
	},
	{
		"customer_name": "HarborBridge Freight Ltd",
		"mobile_no": "0703143789",
		"email_id": "harborbridge@gmail.com",
	},
	{
		"customer_name": "Summit Link Movers Ltd",
		"mobile_no": "0703143790",
		"email_id": "summitlink@gmail.com",
	},
)


def _get_default_customer_group():
	group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
	if group:
		return group

	root_group = frappe.db.get_value("Customer Group", {"parent_customer_group": ""}, "name")
	if root_group:
		return root_group

	return None


def _get_default_territory():
	territory = frappe.db.get_value("Territory", {"is_group": 0}, "name")
	if territory:
		return territory

	root_territory = frappe.db.get_value("Territory", {"parent_territory": ""}, "name")
	if root_territory:
		return root_territory

	return None


def ensure_seed_current_customers():
	customer_group = _get_default_customer_group()
	territory = _get_default_territory()
	created = []

	for customer_data in SEED_CUSTOMERS:
		customer_name = customer_data["customer_name"]
		existing = frappe.db.exists("Customer", {"customer_name": customer_name})
		if existing:
			doc = frappe.get_doc("Customer", existing)
			updated = False
			for fieldname in ("mobile_no", "email_id"):
				if not doc.get(fieldname) and customer_data.get(fieldname):
					doc.set(fieldname, customer_data[fieldname])
					updated = True
			if updated:
				doc.save(ignore_permissions=True)
			continue

			doc = frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": customer_name,
				"customer_type": "Company",
				"customer_group": customer_group,
					"territory": territory,
					"mobile_no": customer_data["mobile_no"],
					"email_id": customer_data["email_id"],
				}
			)
			doc.insert(ignore_permissions=True)
			created.append(doc.name)

	return created


@frappe.whitelist()
def get_current_customer_list(search=None, status=None, page=1, page_length=25):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	filters = []
	if status == "Active":
		filters.append(["disabled", "=", 0])
	elif status == "Disabled":
		filters.append(["disabled", "=", 1])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["customer_name", "like", search_text],
			["mobile_no", "like", search_text],
			["email_id", "like", search_text],
		]

	customers = frappe.get_list(
		"Customer",
		fields=[
			"name",
			"customer_name",
			"mobile_no",
			"email_id",
			"disabled",
			"modified",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	# The page edits each customer's customer-level billing assignment directly,
	# so display the rule from that assignment (not the resolved hierarchy).
	assignment_map = _get_customer_level_assignment_map([c.name for c in customers])
	rule_label_map = _get_rule_label_map(assignment_map.values())
	for customer in customers:
		rule_name = assignment_map.get(customer.name)
		customer.billing_type = rule_name  # rule docname (kept for compatibility)
		info = rule_label_map.get(rule_name) if rule_name else None
		customer.billing_label = info[0] if info else None
		customer.billing_kind = info[1] if info else None

	billing_rates = frappe.get_list(
		"Seal Billing Rate",
		fields=["name", "billing_rule_name"],
		filters={"active": 1},
		order_by="billing_rule_name asc, name asc",
	)

	total_rows = frappe.get_list(
		"Customer",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_rows[0].count) if total_rows else 0

	summary = {"All": 0, "Active": 0, "Disabled": 0}
	summary_rows = frappe.db.sql(
		"""
		select
			ifnull(disabled, 0) as disabled,
			count(*) as count
		from `tabCustomer`
		where 1 = 1
			{search_clause}
		group by ifnull(disabled, 0)
		""".format(
			search_clause="" if not search else """
			and (
				name like %(txt)s
				or customer_name like %(txt)s
				or ifnull(mobile_no, '') like %(txt)s
				or ifnull(email_id, '') like %(txt)s
			)
			"""
		),
		{"txt": f"%{search.strip()}%"} if search else {},
		as_dict=True,
	)
	for row in summary_rows:
		label = "Disabled" if cint(row.disabled) else "Active"
		summary[label] = cint(row.count)
		summary["All"] += cint(row.count)

	return {
		"customers": customers,
		"billing_rates": billing_rates,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
		"empty_message": _("Add customers to start tracking active TNT accounts."),
	}


@frappe.whitelist()
def save_customer_billing_types(updates):
	if isinstance(updates, str):
		updates = frappe.parse_json(updates)

	if not isinstance(updates, list):
		frappe.throw(_("Invalid billing type update payload."))

	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)

	valid_billing_rates = set(
		frappe.get_all("Seal Billing Rate", filters={"active": 1}, pluck="name")
	)
	saved = 0

	for update in updates:
		customer = (update or {}).get("customer")
		billing_type = (update or {}).get("billing_type") or None

		if not customer or not frappe.db.exists("Customer", customer):
			continue

		if billing_type and billing_type not in valid_billing_rates:
			frappe.throw(
				_("Billing Type {0} is not an active Seal Billing Rate.").format(
					frappe.bold(billing_type)
				)
			)

		_upsert_customer_assignment(customer, billing_type)
		saved += 1

	frappe.db.commit()
	return {"saved": saved}


def _upsert_customer_assignment(customer, billing_rule):
	"""Persist a customer's chosen rule as a customer-level Customer Billing
	Assignment. Reuses the existing row when present, deactivates any extras, and
	clears the assignment when no rule is chosen."""
	existing = frappe.get_all(
		"Customer Billing Assignment",
		filters={"assignment_type": "Customer", "customer": customer},
		fields=["name"],
		order_by="priority desc, modified desc",
	)

	if not billing_rule:
		# Clearing the rule: drop every customer-level assignment for this customer.
		for row in existing:
			frappe.delete_doc("Customer Billing Assignment", row.name, ignore_permissions=True)
		return

	if existing:
		# Keep the first, point it at the new rule, remove duplicates.
		primary = existing[0].name
		frappe.db.set_value(
			"Customer Billing Assignment",
			primary,
			{"billing_rule": billing_rule, "active": 1},
		)
		for row in existing[1:]:
			frappe.delete_doc("Customer Billing Assignment", row.name, ignore_permissions=True)
		return

	doc = frappe.get_doc(
		{
			"doctype": "Customer Billing Assignment",
			"assignment_type": "Customer",
			"customer": customer,
			"billing_rule": billing_rule,
			"active": 1,
		}
	)
	doc.insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Per-customer billing modal (Set Billing)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_customer_billing(customer):
	"""Prefill payload for the Set Billing modal: the customer's current rule plus
	the list of shareable Default rules to choose from."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	default_rules = frappe.get_all(
		"Seal Billing Rate",
		filters={"active": 1, "billing_type": "Default"},
		fields=[
			"name",
			"billing_rule_name",
			"billing_period_type",
			"first_period_days",
			"first_period_amount",
			"extra_day_rate",
			"currency",
		],
		order_by="first_period_days asc, billing_rule_name asc",
	)

	current = {
		"billing_type": "Default",
		"default_rule": None,
		"billing_period_type": "Monthly",
		"first_period_days": 30,
		"first_period_amount": 0,
		"extra_day_rate": 0,
		"period_from_date": None,
		"period_to_date": None,
		"currency": "KES",
		"rule_name": None,
	}

	rule_name = _get_customer_level_assignment_map([customer]).get(customer)
	if rule_name:
		rule = frappe.db.get_value(
			"Seal Billing Rate",
			rule_name,
			[
				"name",
				"billing_type",
				"billing_period_type",
				"first_period_days",
				"first_period_amount",
				"extra_day_rate",
				"period_from_date",
				"period_to_date",
				"currency",
			],
			as_dict=True,
		)
		if rule:
			current.update(
				{
					"rule_name": rule.name,
					"billing_type": rule.billing_type or "Default",
					"billing_period_type": rule.billing_period_type or "Monthly",
					"first_period_days": rule.first_period_days,
					"first_period_amount": rule.first_period_amount,
					"extra_day_rate": rule.extra_day_rate,
					"period_from_date": rule.period_from_date,
					"period_to_date": rule.period_to_date,
					"currency": rule.currency or "KES",
				}
			)
			if (rule.billing_type or "Default") == "Default":
				current["default_rule"] = rule.name

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
		"default_rules": default_rules,
		"current": current,
	}


@frappe.whitelist()
def set_customer_billing(
	customer,
	billing_type,
	default_rule=None,
	billing_period_type=None,
	first_period_days=None,
	first_period_amount=None,
	extra_day_rate=None,
	period_from_date=None,
	period_to_date=None,
	currency=None,
):
	"""Save a customer's billing choice from the modal.

	- ``Default``: assign one of the shared Default rules. Any private Special rule
	  the customer had is deactivated.
	- ``Special``: create/update a Special rule dedicated to this customer with the
	  given contract terms, then assign it.
	"""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	billing_type = billing_type or "Default"

	if billing_type == "Default":
		is_valid = frappe.db.exists(
			"Seal Billing Rate", {"name": default_rule, "active": 1, "billing_type": "Default"}
		)
		if not default_rule or not is_valid:
			frappe.throw(_("Choose an active default billing rule."))
		_deactivate_customer_special_rule(customer)
		_upsert_customer_assignment(customer, default_rule)
		rule_used = default_rule
	elif billing_type == "Special":
		rule_used = _save_customer_special_rule(
			customer,
			billing_period_type,
			first_period_amount,
			extra_day_rate,
			currency,
			period_from_date=period_from_date,
			period_to_date=period_to_date,
		)
		_upsert_customer_assignment(customer, rule_used)
	else:
		frappe.throw(_("Invalid billing type."))

	frappe.db.commit()
	return {
		"customer": customer,
		"billing_rule": rule_used,
		"billing_rule_name": frappe.db.get_value("Seal Billing Rate", rule_used, "billing_rule_name"),
		"billing_type": billing_type,
	}


def _get_customer_special_rule(customer):
	"""Return the customer's dedicated Special rule (via its current assignment), or
	None when the customer is on a shared Default rule / unassigned."""
	rule = _get_customer_level_assignment_map([customer]).get(customer)
	if rule and frappe.db.get_value("Seal Billing Rate", rule, "billing_type") == "Special":
		return rule
	return None


def _deactivate_customer_special_rule(customer):
	rule = _get_customer_special_rule(customer)
	if rule:
		frappe.db.set_value("Seal Billing Rate", rule, "active", 0)


def _save_customer_special_rule(
	customer, period_type, amount, rate, currency,
	period_from_date=None, period_to_date=None,
):
	period_type = period_type or "Monthly"
	amount = flt(amount)
	rate = flt(rate)
	if amount < 0 or rate < 0:
		frappe.throw(_("Amounts cannot be negative."))

	customer_label = frappe.db.get_value("Customer", customer, "customer_name") or customer
	rule_label = _("{0} — Special Contract").format(customer_label)

	existing = _get_customer_special_rule(customer)
	if existing:
		doc = frappe.get_doc("Seal Billing Rate", existing)
	else:
		doc = frappe.new_doc("Seal Billing Rate")

	doc.billing_rule_name = rule_label
	doc.billing_type = "Special"
	doc.active = 1
	doc.is_global_default = 0
	doc.currency = currency or "KES"
	doc.billing_period_type = period_type
	doc.first_period_amount = amount
	doc.extra_day_rate = rate

	if period_type == "Date Range":
		if not period_from_date or not period_to_date:
			frappe.throw(_("Period From Date and Period To Date are required for a Date Range period."))
		doc.period_from_date = period_from_date
		doc.period_to_date = period_to_date
		# first_period_days is derived from the range by the rule's own validate().
	else:
		doc.period_from_date = None
		doc.period_to_date = None
		mapped = PERIOD_TYPE_DAYS.get(period_type)
		if not mapped:
			frappe.throw(_("Invalid billing period type."))
		doc.first_period_days = mapped

	doc.save(ignore_permissions=True)
	return doc.name
