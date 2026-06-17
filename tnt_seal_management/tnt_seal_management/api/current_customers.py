import frappe
from frappe import _
from frappe.utils import cint


CUSTOMER_BILLING_TYPE_FIELD = "custom_billing_type"


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
			CUSTOMER_BILLING_TYPE_FIELD,
			"modified",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)
	for customer in customers:
		customer.billing_type = customer.get(CUSTOMER_BILLING_TYPE_FIELD)

	billing_rates = frappe.get_list(
		"Seal Billing Rate",
		fields=["name", "billing_rule_name"],
		filters={"active": 1},
		order_by="billing_rule_name asc, name asc",
	)

	total_rows = frappe.get_list(
		"Customer",
		fields=[{"COUNT": "*", "as": "count"}],
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

		frappe.db.set_value(
			"Customer",
			customer,
			CUSTOMER_BILLING_TYPE_FIELD,
			billing_type,
			update_modified=True,
		)
		saved += 1

	frappe.db.commit()
	return {"saved": saved}
