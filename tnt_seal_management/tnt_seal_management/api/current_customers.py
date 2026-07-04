import frappe
from frappe import _
from frappe.utils import cint, flt


CUSTOMER_BILLING_TYPE_FIELD = "custom_billing_type"

# Sentinel meaning "leave this field untouched" — distinct from an explicit
# None, which clears the value.
_UNSET = object()


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
	return {r.name: (r.billing_rule_name or r.name, r.billing_type or "Subscription") for r in rows}


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

	can_read_billing_rates = frappe.has_permission("Seal Billing Rate", "read")
	can_edit_billing = can_read_billing_rates and frappe.has_permission("Customer", "write")
	can_create_customer = frappe.has_permission("Customer", "create")

	billing_rates = frappe.get_list(
		"Seal Billing Rate",
		fields=["name", "billing_rule_name"],
		filters={"active": 1},
		order_by="billing_rule_name asc, name asc",
	) if can_read_billing_rates else []

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
		"permissions": {
			"can_create_customer": can_create_customer,
			"can_edit_billing": can_edit_billing,
		},
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


def _upsert_customer_assignment(customer, billing_rule, effective_from=_UNSET, effective_to=_UNSET):
	"""Persist a customer's chosen rule as a customer-level Customer Billing
	Assignment. Reuses the existing row when present, deactivates any extras, and
	clears the assignment when no rule is chosen.

	``effective_from``/``effective_to`` are the customer's own slice of the rule's
	validity window (the rule's Validity section is company-wide). Pass ``_UNSET``
	(the default) to leave whatever is already on the assignment untouched —
	callers that don't deal in per-customer dates (e.g. bulk billing-type saves)
	rely on this. Goes through ``doc.save()`` rather than ``db.set_value`` so the
	doctype's date-vs-rule-window validation in
	``customer_billing_assignment.py`` runs.
	"""
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
		doc = frappe.get_doc("Customer Billing Assignment", primary)
		doc.billing_rule = billing_rule
		doc.active = 1
		if effective_from is not _UNSET:
			doc.effective_from = effective_from
		if effective_to is not _UNSET:
			doc.effective_to = effective_to
		doc.save(ignore_permissions=True)
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
			"effective_from": None if effective_from is _UNSET else effective_from,
			"effective_to": None if effective_to is _UNSET else effective_to,
		}
	)
	doc.insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Per-customer billing modal (Set Billing)
# ---------------------------------------------------------------------------

RULE_DISPLAY_FIELDS = [
	"name",
	"billing_rule_name",
	"billing_type",
	"billing_period_type",
	"first_period_days",
	"first_period_amount",
	"extra_day_rate",
	"currency",
	"effective_from",
	"effective_to",
]


@frappe.whitelist()
def get_customer_billing(customer):
	"""Prefill payload for the Set Billing modal: the customer's current assignment
	plus the active Subscription rules available to pick from. Subscription rules are
	configured in Seal Billing Rate; Leasing has no list to pick from — it's a private,
	per-customer contract entered directly in the modal, so ``current.rule`` (when the
	customer's current assignment is a Leasing rate) carries its terms for prefill."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	# Only Approved rules are offered — a rule Pending (re-)approval by the
	# Managing Director cannot yet be assigned to a customer.
	subscription_rules = frappe.get_all(
		"Seal Billing Rate",
		filters={"active": 1, "billing_type": "Subscription", "approval_status": "Approved"},
		fields=RULE_DISPLAY_FIELDS,
		order_by="first_period_days asc, billing_rule_name asc",
	)

	current = {
		"billing_type": "Subscription",
		"billing_rule": None,
		"rule": None,
		"period_from_date": None,
		"period_to_date": None,
	}

	assignment = frappe.db.get_value(
		"Customer Billing Assignment",
		{"assignment_type": "Customer", "customer": customer, "active": 1},
		["billing_rule", "effective_from", "effective_to"],
		order_by="priority desc, modified desc",
		as_dict=True,
	)
	if assignment and assignment.billing_rule:
		rule = frappe.db.get_value(
			"Seal Billing Rate", assignment.billing_rule, RULE_DISPLAY_FIELDS, as_dict=True
		)
		if rule:
			current = {
				"billing_type": rule.billing_type or "Subscription",
				"billing_rule": rule.name,
				"rule": rule,
				# The customer's own slice of the rule's company-wide validity window.
				"period_from_date": assignment.effective_from,
				"period_to_date": assignment.effective_to,
			}

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
		"subscription_rules": subscription_rules,
		"current": current,
	}


@frappe.whitelist()
def set_customer_billing(
	customer,
	billing_type,
	billing_rule=None,
	period_from_date=None,
	period_to_date=None,
	first_period_days=None,
	first_period_amount=None,
	extra_day_rate=None,
	currency=None,
	rule_effective_from=None,
	rule_effective_to=None,
):
	"""Assign billing to the customer.

	Subscription picks an existing, active shared rate card (``billing_rule``); its
	own Validity window (``effective_from``/``effective_to``) is configured on the
	rule itself in Seal Billing Rate — company-wide, not editable here.
	``period_from_date``/``period_to_date`` are the customer's own slice of that
	window — they must fall within the rule's effective_from/effective_to,
	enforced by Customer Billing Assignment.validate().

	Leasing has no rule to pick — it's a private, per-customer contract, so its
	terms (``first_period_days``/``first_period_amount``/``extra_day_rate``/
	``currency``) *and* its own Validity window (``rule_effective_from``/
	``rule_effective_to``) are entered directly here and saved onto the
	customer's own auto-named rule (see ``_upsert_customer_leasing_rule``).
	``period_from_date``/``period_to_date`` still apply the same way — the
	customer's own slice of that (now customer-specific) window."""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	if billing_type == "Leasing":
		if not first_period_days or first_period_amount in (None, "") or extra_day_rate in (None, ""):
			frappe.throw(_("Enter First Period Days, First Period Amount and Extra Day Rate."))

		customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
		rule_name = _upsert_customer_leasing_rule(
			customer,
			customer_name,
			first_period_days,
			first_period_amount,
			extra_day_rate,
			currency,
			effective_from=rule_effective_from or None,
			effective_to=rule_effective_to or None,
		)
		_upsert_customer_assignment(
			customer, rule_name, effective_from=period_from_date or None, effective_to=period_to_date or None
		)

		frappe.db.commit()
		rule = frappe.db.get_value(
			"Seal Billing Rate", rule_name, ["name", "billing_rule_name", "billing_type"], as_dict=True
		)
		return {
			"customer": customer,
			"billing_rule": rule.name,
			"billing_rule_name": rule.billing_rule_name,
			"billing_type": rule.billing_type,
		}

	rule = frappe.db.get_value(
		"Seal Billing Rate",
		{"name": billing_rule, "active": 1},
		["name", "billing_type", "billing_rule_name", "approval_status"],
		as_dict=True,
	)
	if not billing_rule or not rule:
		frappe.throw(_("Choose an active billing rule."))
	if rule.billing_type != billing_type:
		frappe.throw(_("Selected rule does not match the chosen billing type."))
	if rule.approval_status != "Approved":
		frappe.throw(_("This billing rule is still awaiting Managing Director approval and cannot be assigned yet."))

	_upsert_customer_assignment(
		customer, rule.name, effective_from=period_from_date or None, effective_to=period_to_date or None
	)

	frappe.db.commit()
	return {
		"customer": customer,
		"billing_rule": rule.name,
		"billing_rule_name": rule.billing_rule_name,
		"billing_type": rule.billing_type,
	}


def _upsert_customer_leasing_rule(
	customer,
	customer_name,
	first_period_days,
	first_period_amount,
	extra_day_rate,
	currency=None,
	effective_from=None,
	effective_to=None,
):
	"""Create or update the customer's private Leasing rate, auto-named
	"<Customer Name> BR". There is exactly one per customer — found via the
	customer's current Customer Billing Assignment, not a separate lookup table.

	"Leasing" is intentionally no longer one of Seal Billing Rate.billing_type's
	Select options (that field is now Subscription-only, to keep the Billing Rate
	page limited to shared rate cards). Writes here run under
	``frappe.flags.in_import`` to bypass that per-field options check — the same
	escape hatch Frappe's own Data Import tooling uses for values outside the
	current option list — while every other validation on the doctype (pricing,
	single-global-default, etc.) still runs normally."""
	existing_rule = None
	current_rule_name = frappe.db.get_value(
		"Customer Billing Assignment",
		{"assignment_type": "Customer", "customer": customer, "active": 1},
		"billing_rule",
		order_by="priority desc, modified desc",
	)
	if current_rule_name:
		row = frappe.db.get_value("Seal Billing Rate", current_rule_name, ["name", "billing_type"], as_dict=True)
		if row and row.billing_type == "Leasing":
			existing_rule = row.name

	values = {
		"billing_rule_name": f"{customer_name} BR",
		"billing_type": "Leasing",
		"active": 1,
		"is_global_default": 0,
		# Leasing rates are private, per-customer contracts set directly by
		# Finance here — they sit outside the Managing Director approval
		# workflow that applies to shared Subscription rate cards.
		"approval_status": "Approved",
		"currency": currency or "KES",
		"first_period_days": cint(first_period_days),
		"first_period_amount": flt(first_period_amount),
		"extra_day_rate": flt(extra_day_rate),
		"effective_from": effective_from,
		"effective_to": effective_to,
	}

	frappe.flags.in_import = True
	try:
		if existing_rule:
			doc = frappe.get_doc("Seal Billing Rate", existing_rule)
			doc.update(values)
			doc.save(ignore_permissions=True)
		else:
			doc = frappe.get_doc({"doctype": "Seal Billing Rate", **values})
			doc.insert(ignore_permissions=True)
	finally:
		frappe.flags.in_import = False

	return doc.name
