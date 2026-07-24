import frappe
from frappe import _
from frappe.utils import cint, flt


CUSTOMER_BILLING_TYPE_FIELD = "custom_billing_type"

# Sentinel meaning "leave this field untouched" — distinct from an explicit
# None, which clears the value.
_UNSET = object()

# Per-customer tax treatment, set from the Set Billing modal. Drives the VAT
# calculation in completed_journeys.py / completed_journeys_report.py — Tax
# Exempt and Zero Rated both mean no VAT is added to the total payable.
TAX_CATEGORY_NORMAL = "Normal Tax (16% VAT)"
TAX_CATEGORY_EXEMPT = "Tax Exempt"
TAX_CATEGORY_ZERO_RATED = "Zero Rated"
TAX_CATEGORY_OPTIONS = (TAX_CATEGORY_NORMAL, TAX_CATEGORY_EXEMPT, TAX_CATEGORY_ZERO_RATED)


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
			"can_grant_portal_access": can_edit_billing,
		},
	}


def _require_portal_access_permission():
	if not frappe.has_permission("Customer", "write") or not frappe.has_permission("User", "create"):
		frappe.throw(_("Not permitted to grant customer portal access."), frappe.PermissionError)


def _find_contact_for_customer(customer, email=None):
	"""Return the Contact linked to ``customer`` that matches ``email`` (or the
	Customer's own mirrored email_id when unset), or None if there is no such
	link — Customer.email_id/mobile_no are Read Only fields mirrored from
	whichever Contact is primary, so this is the same identity the Current
	Customers table already shows the admin."""
	target_email = email or frappe.db.get_value("Customer", customer, "email_id")
	if not target_email:
		return None

	contact_names = frappe.get_all(
		"Dynamic Link",
		filters={"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer},
		pluck="parent",
	)
	if not contact_names:
		return None

	match = frappe.get_all(
		"Contact",
		filters={"name": ["in", contact_names], "email_id": target_email},
		fields=["name"],
		limit=1,
	)
	return frappe.get_doc("Contact", match[0].name) if match else None


def _create_contact_for_customer(customer, first_name, last_name, email):
	contact = frappe.get_doc({
		"doctype": "Contact",
		"first_name": first_name,
		"last_name": last_name or "",
		"email_ids": [{"email_id": email, "is_primary": 1}],
		"links": [{"link_doctype": "Customer", "link_name": customer}],
	})
	contact.insert()
	return contact


def _add_customer_portal_user(customer, user):
	"""Link ``user`` on Customer.portal_users if not already present. Saving
	triggers Customer.on_update, which grants the Customer role to every user
	in that table (erpnext.selling.doctype.customer.customer.on_update)."""
	customer_doc = frappe.get_doc("Customer", customer)
	if any(row.user == user for row in customer_doc.portal_users):
		return False

	customer_doc.append("portal_users", {"user": user})
	customer_doc.save()
	return True


@frappe.whitelist()
def grant_customer_portal_access(customer, first_name=None, last_name=None, email=None):
	"""One-click customer registration for the Current Customers page: reuse
	(or create) a Contact, invite it as a Website User if it isn't one already,
	and grant Customer Portal access. Mirrors the manual Contact → "Invite as
	User" → Customer "Portal Users" tab workflow, minus the three separate
	trips through the desk.

	Returns {"status": "needs_contact_details"} when no email is on file and
	none was supplied — the caller should collect first_name/last_name/email
	and call again."""
	_require_portal_access_permission()

	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} not found.").format(customer))

	contact = _find_contact_for_customer(customer, email)

	if not contact:
		if not email:
			return {"status": "needs_contact_details"}
		if not first_name:
			frappe.throw(_("Name is required to create a new contact."))
		contact = _create_contact_for_customer(customer, first_name, last_name, email)

	if contact.user:
		user = contact.user
		invited = False
	else:
		from frappe.contacts.doctype.contact.contact import invite_user

		# Existing company-style Contacts often have only company_name set, which
		# makes the User created by invite_user fail its required First Name.
		# Backfill from company_name (or the customer) before inviting.
		if not contact.first_name:
			contact.first_name = contact.company_name or customer
			contact.save(ignore_permissions=True)

		user = invite_user(contact.name)
		invited = True

	newly_linked = _add_customer_portal_user(customer, user)

	if not invited and not newly_linked:
		message = _("{0} already has customer portal access.").format(user)
	elif invited:
		message = _("Invited {0} — a welcome email with password setup instructions was sent.").format(user)
	else:
		message = _("Granted {0} customer portal access.").format(user)

	return {"status": "ok", "user": user, "contact": contact.name, "invited": invited, "message": message}


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


def _upsert_customer_assignment(
	customer,
	billing_rule,
	effective_from=_UNSET,
	effective_to=_UNSET,
	override_first_period_amount=_UNSET,
	override_currency=_UNSET,
	outright_purchase=_UNSET,
	owned_seal_count=_UNSET,
):
	"""Persist a customer's chosen rule as a customer-level Customer Billing
	Assignment. Reuses the existing row when present, deactivates any extras, and
	clears the assignment when no rule is chosen.

	``effective_from``/``effective_to`` are the customer's own billing window.
	``override_first_period_amount``/``override_currency`` are a per-customer
	Rate/Currency override on top of a shared Subscription rule (see
	billing.apply_billing_overrides) — Leasing callers should pass ``None`` for
	both explicitly (not ``_UNSET``) so a stale Subscription-era override never
	lingers on an assignment that's since moved to Leasing.
	``outright_purchase``/``owned_seal_count`` record whether this customer owns
	their seals outright (independent of billing_type) — the Set Billing
	modal's own Seal Ownership section.

	Pass ``_UNSET`` (the default) to leave whatever is already on the assignment
	untouched — callers that don't deal in per-customer dates (e.g. bulk
	billing-type saves) rely on this. Goes through ``doc.save()`` rather than
	``db.set_value`` so the doctype's validation in
	``customer_billing_assignment.py`` runs.
	"""
	existing = frappe.get_all(
		"Customer Billing Assignment",
		# Only the customer's *primary* assignment — never the Scenario 6 extra
		# leasing agreement (is_extra_billing=1), which is managed separately by
		# set_customer_extra_billing and must survive a primary save untouched.
		filters={"assignment_type": "Customer", "customer": customer, "is_extra_billing": 0},
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
		if override_first_period_amount is not _UNSET:
			doc.override_first_period_amount = override_first_period_amount
		if override_currency is not _UNSET:
			doc.override_currency = override_currency
		if outright_purchase is not _UNSET:
			doc.outright_purchase = outright_purchase
		if owned_seal_count is not _UNSET:
			doc.owned_seal_count = owned_seal_count
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
			"override_first_period_amount": None if override_first_period_amount is _UNSET else override_first_period_amount,
			"override_currency": None if override_currency is _UNSET else override_currency,
			"outright_purchase": None if outright_purchase is _UNSET else outright_purchase,
			"owned_seal_count": None if owned_seal_count is _UNSET else owned_seal_count,
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
	# Managing Director cannot yet be assigned to a customer. The seeded PCB
	# Scenario rates (seed_pcb_journey_billing_scenarios) are per-journey
	# transactional rates, not generic subscription rate cards, so they're
	# excluded from the Set Billing modal's picker — only generic rules show.
	subscription_rules = frappe.get_all(
		"Seal Billing Rate",
		filters={
			"active": 1,
			"billing_type": "Subscription",
			"approval_status": "Approved",
			"billing_rule_name": ["not like", "PCB Scenario%"],
		},
		fields=RULE_DISPLAY_FIELDS,
		order_by="first_period_days asc, billing_rule_name asc",
	)

	current = {
		"billing_type": "Subscription",
		"billing_rule": None,
		"rule": None,
		"period_from_date": None,
		"period_to_date": None,
		"outright_purchase": 0,
		"owned_seal_count": 0,
	}

	assignment = frappe.db.get_value(
		"Customer Billing Assignment",
		# Primary assignment only — the Scenario 6 extra leasing agreement
		# (is_extra_billing=1) has its own prefill (get_customer_extra_billing).
		{"assignment_type": "Customer", "customer": customer, "active": 1, "is_extra_billing": 0},
		[
			"billing_rule", "effective_from", "effective_to",
			"override_first_period_amount", "override_currency",
			"outright_purchase", "owned_seal_count",
		],
		order_by="priority desc, modified desc",
		as_dict=True,
	)
	if assignment:
		# Seal Ownership is independent of billing_type/billing_rule, so it's
		# carried whenever an assignment exists, even if the rule lookup below
		# doesn't resolve.
		current["outright_purchase"] = cint(assignment.outright_purchase)
		current["owned_seal_count"] = cint(assignment.owned_seal_count)

	if assignment and assignment.billing_rule:
		rule = frappe.db.get_value(
			"Seal Billing Rate", assignment.billing_rule, RULE_DISPLAY_FIELDS, as_dict=True
		)
		if rule:
			# Prefill with this customer's own effective Rate/Currency (the
			# override, if one is set) rather than the shared rule's raw values —
			# reopening the modal should show what actually bills them.
			# override_first_period_amount is a Currency field (Frappe hard-codes
			# these as NOT NULL DEFAULT 0), so it can never truly be empty once an
			# assignment exists — almost every assignment sits at its untouched
			# default of 0.0. A positive value is the only override we can
			# reliably tell apart from "unset" (see billing.apply_billing_overrides,
			# which has the same fix for the same reason).
			if flt(assignment.override_first_period_amount) > 0:
				rule.first_period_amount = assignment.override_first_period_amount
			if assignment.override_currency:
				rule.currency = assignment.override_currency

			current.update(
				{
					"billing_type": rule.billing_type or "Subscription",
					"billing_rule": rule.name,
					"rule": rule,
					# The customer's own slice of the rule's company-wide validity window.
					"period_from_date": assignment.effective_from,
					"period_to_date": assignment.effective_to,
				}
			)

	return {
		"customer": customer,
		"customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
		"subscription_rules": subscription_rules,
		"current": current,
		"tax_category": frappe.db.get_value("Customer", customer, "custom_tax_category") or TAX_CATEGORY_NORMAL,
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
	tax_category=None,
	outright_purchase=None,
	owned_seal_count=None,
):
	"""Assign billing to the customer.

	Subscription picks an existing, active shared rate card (``billing_rule``).
	``period_from_date``/``period_to_date`` are the customer's own billing window.
	``first_period_amount``/``currency`` are optional here too — when given (and
	different from the rule's own values) they're saved as a per-customer Rate/
	Currency override on the assignment (billing.apply_billing_overrides),
	without touching the shared rule or any other customer assigned to it.

	Leasing has no rule to pick — it's a private, per-customer contract, so its
	terms (``first_period_days``/``first_period_amount``/``extra_day_rate``/
	``currency``) are entered directly here and saved onto the customer's own
	auto-named rule (see ``_upsert_customer_leasing_rule``).

	``outright_purchase``/``owned_seal_count`` (Set Billing modal's Seal
	Ownership section) record whether this customer owns their seals outright —
	independent of ``billing_type``, so captured the same way for both
	Subscription and Leasing."""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	if tax_category:
		if tax_category not in TAX_CATEGORY_OPTIONS:
			frappe.throw(_("Invalid tax category."))
		frappe.db.set_value("Customer", customer, "custom_tax_category", tax_category)

	outright_purchase = cint(outright_purchase)
	if outright_purchase and cint(owned_seal_count) <= 0:
		frappe.throw(_("Enter the Number of Seals Owned for an Outright Purchase."))
	owned_seal_count = cint(owned_seal_count) if outright_purchase else 0

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
		)
		_upsert_customer_assignment(
			customer,
			rule_name,
			effective_from=period_from_date or None,
			effective_to=period_to_date or None,
			# Leasing already bills off the customer's own fully private rate —
			# clear out any override left over from a prior Subscription
			# assignment so it can never silently apply here.
			override_first_period_amount=None,
			override_currency=None,
			outright_purchase=outright_purchase,
			owned_seal_count=owned_seal_count,
		)

		frappe.db.set_value("Customer", customer, "disabled", 1)
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
		["name", "billing_type", "billing_rule_name", "approval_status", "first_period_amount", "currency"],
		as_dict=True,
	)
	if not billing_rule or not rule:
		frappe.throw(_("Choose an active billing rule."))
	if rule.billing_type != billing_type:
		frappe.throw(_("Selected rule does not match the chosen billing type."))
	if rule.approval_status != "Approved":
		frappe.throw(_("This billing rule is still awaiting Managing Director approval and cannot be assigned yet."))

	# Only persist as an override when it actually differs from the rule's own
	# Rate/Currency — otherwise every save would pin the rule's *current*
	# values onto the assignment, and this customer would stop following the
	# shared rule if its rate is ever updated later.
	rate_override = (
		flt(first_period_amount) if first_period_amount not in (None, "") and flt(first_period_amount) != flt(rule.first_period_amount) else None
	)
	currency_override = currency if currency and currency != rule.currency else None

	_upsert_customer_assignment(
		customer,
		rule.name,
		effective_from=period_from_date or None,
		effective_to=period_to_date or None,
		override_first_period_amount=rate_override,
		override_currency=currency_override,
		outright_purchase=outright_purchase,
		owned_seal_count=owned_seal_count,
	)

	frappe.db.set_value("Customer", customer, "disabled", 1)
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
		# Leasing rules now require Managing Director approval
		# workflow that applies to shared Subscription rate cards.
		"currency": currency or "KES",
		"first_period_days": cint(first_period_days),
		"first_period_amount": flt(first_period_amount),
		"extra_day_rate": flt(extra_day_rate),
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


# ---------------------------------------------------------------------------
# Extra Billing — Scenario 6 (leasing agreement on top of a Subscription)
# ---------------------------------------------------------------------------
#
# An outright-purchase customer billed per journey on Subscription can also
# lease extra seals. That leasing agreement is a *second* Customer Billing
# Assignment (is_extra_billing=1) pointing at the customer's own auto-named
# "<Customer> Extra BR" leasing rule — it coexists with the primary
# Subscription assignment rather than replacing it (see _upsert_customer_assignment
# and billing._resolve_assignment, both scoped to is_extra_billing=0). The
# per-journey billing engine applies it at tagging (see
# billing.resolve_customer_extra_billing / seal_journey.set_billing).


def _find_extra_billing_assignment(customer):
	"""Name of the customer's extra-billing assignment (is_extra_billing=1), or
	None. There is at most one per customer."""
	rows = frappe.get_all(
		"Customer Billing Assignment",
		filters={"assignment_type": "Customer", "customer": customer, "is_extra_billing": 1},
		fields=["name"],
		order_by="modified desc",
	)
	return rows[0].name if rows else None


def _upsert_customer_extra_leasing_rule(
	customer, customer_name, first_period_days, first_period_amount, extra_day_rate, currency=None
):
	"""Create or update the customer's private *extra* Leasing rate, auto-named
	"<Customer Name> Extra BR" — the sibling of _upsert_customer_leasing_rule for
	the Scenario 6 extra agreement, found via the extra-billing assignment so it
	stays distinct from the customer's primary "<Customer Name> BR" rule."""
	existing_rule = None
	extra_assignment = _find_extra_billing_assignment(customer)
	if extra_assignment:
		current_rule_name = frappe.db.get_value("Customer Billing Assignment", extra_assignment, "billing_rule")
		if current_rule_name:
			row = frappe.db.get_value("Seal Billing Rate", current_rule_name, ["name", "billing_type"], as_dict=True)
			if row and row.billing_type == "Leasing":
				existing_rule = row.name

	values = {
		"billing_rule_name": f"{customer_name} Extra BR",
		"billing_type": "Leasing",
		"active": 1,
		"is_global_default": 0,
		# Leasing rules now require Managing Director approval
		# workflow that applies to shared Subscription rate cards.
		"currency": currency or "KES",
		"first_period_days": cint(first_period_days),
		"first_period_amount": flt(first_period_amount),
		"extra_day_rate": flt(extra_day_rate),
	}

	# See _upsert_customer_leasing_rule: bypass the (Subscription-only) billing_type
	# options check while keeping every other doctype validation.
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


def _upsert_extra_billing_assignment(customer, billing_rule, active, effective_from, effective_to):
	"""Persist the customer's single extra-billing (is_extra_billing=1)
	assignment, independent of the primary one."""
	existing = frappe.get_all(
		"Customer Billing Assignment",
		filters={"assignment_type": "Customer", "customer": customer, "is_extra_billing": 1},
		fields=["name"],
		order_by="modified desc",
	)
	if existing:
		doc = frappe.get_doc("Customer Billing Assignment", existing[0].name)
		doc.billing_rule = billing_rule
		doc.active = cint(active)
		doc.is_extra_billing = 1
		doc.effective_from = effective_from
		doc.effective_to = effective_to
		doc.save(ignore_permissions=True)
		for row in existing[1:]:
			frappe.delete_doc("Customer Billing Assignment", row.name, ignore_permissions=True)
		return doc.name

	doc = frappe.get_doc(
		{
			"doctype": "Customer Billing Assignment",
			"assignment_type": "Customer",
			"customer": customer,
			"billing_rule": billing_rule,
			"active": cint(active),
			"is_extra_billing": 1,
			"effective_from": effective_from,
			"effective_to": effective_to,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def get_customer_extra_billing(customer):
	"""Prefill payload for the Set Billing modal's Extra Billing tab: the
	customer's extra leasing agreement (if any), whether it's active, and its
	leasing terms + customer period."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	empty = {
		"active": 0,
		"first_period_days": None,
		"first_period_amount": None,
		"extra_day_rate": None,
		"currency": "KES",
		"period_from_date": None,
		"period_to_date": None,
	}

	name = _find_extra_billing_assignment(customer)
	if not name:
		return empty

	assignment = frappe.db.get_value(
		"Customer Billing Assignment",
		name,
		["billing_rule", "active", "effective_from", "effective_to"],
		as_dict=True,
	)
	rule = (
		frappe.db.get_value(
			"Seal Billing Rate",
			assignment.billing_rule,
			["first_period_days", "first_period_amount", "extra_day_rate", "currency"],
			as_dict=True,
		)
		if assignment and assignment.billing_rule
		else None
	)

	return {
		"active": cint(assignment.active) if assignment else 0,
		"first_period_days": rule.first_period_days if rule else None,
		"first_period_amount": rule.first_period_amount if rule else None,
		"extra_day_rate": rule.extra_day_rate if rule else None,
		"currency": (rule.currency if rule else None) or "KES",
		"period_from_date": assignment.effective_from if assignment else None,
		"period_to_date": assignment.effective_to if assignment else None,
	}


@frappe.whitelist()
def set_customer_extra_billing(
	customer,
	activate,
	first_period_days=None,
	first_period_amount=None,
	extra_day_rate=None,
	currency=None,
	period_from_date=None,
	period_to_date=None,
):
	"""Upsert the customer's Scenario 6 extra leasing agreement. When ``activate``
	is on the leasing terms are required and the extra assignment is (re)activated;
	when off, an existing agreement is deactivated (its terms are preserved so it
	can be re-activated later)."""
	if not frappe.has_permission("Customer", "write"):
		frappe.throw(_("Not permitted to update customers."), frappe.PermissionError)
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer not found."))

	activate = cint(activate)
	has_terms = (
		first_period_days
		and first_period_amount not in (None, "")
		and extra_day_rate not in (None, "")
	)

	if activate and not has_terms:
		frappe.throw(_("Enter First Period Days, First Period Amount and Extra Day Rate for Extra Billing."))

	existing = _find_extra_billing_assignment(customer)

	# Nothing to store and nothing to keep active — just make sure any prior
	# agreement is switched off.
	if not activate and not has_terms:
		if existing:
			frappe.db.set_value("Customer Billing Assignment", existing, "active", 0)
			frappe.db.commit()
		return {"customer": customer, "active": 0}

	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	rule_name = _upsert_customer_extra_leasing_rule(
		customer, customer_name, first_period_days, first_period_amount, extra_day_rate, currency
	)
	assignment_name = _upsert_extra_billing_assignment(
		customer,
		rule_name,
		active=activate,
		effective_from=period_from_date or None,
		effective_to=period_to_date or None,
	)

	frappe.db.set_value("Customer", customer, "disabled", 1)
	frappe.db.commit()
	return {
		"customer": customer,
		"assignment": assignment_name,
		"billing_rule": rule_name,
		"active": activate,
	}
