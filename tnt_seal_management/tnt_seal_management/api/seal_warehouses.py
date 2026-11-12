# Seal warehouses are ERPNext Warehouses whose Branch checkbox ECTS or RECTS is ticked. The
# seals are the same across TNT and RECTS, so custody, pickers and GPS matching
# use every seal warehouse; only the Warehouses page splits them per system
# (see SYSTEM_BRANCH). Material Transfer / Issue / Receipt keep stock on them as usual;
# seal management adds a few custom fields (Main Seal Store, GPS position and
# radius) and treats them as the places a seal can rest.


import frappe
from frappe import _
from frappe.utils import cint, flt

# Branch checkboxes on the Warehouse (same as on Customer): ECTS = PCB (TNT),
# RECTS = RECTs. A seal warehouse ticks ECTS and/or RECTS; FMS-only warehouses
# aren't seal warehouses.
SEAL_BRANCHES = ("custom_division_ects", "custom_division_rects")

# Which warehouses each system's Warehouses page lists (a Branch checkbox).
SYSTEM_BRANCH = {
	"TNT": "custom_division_ects",
	"RECTS": "custom_division_rects",
}

# Link filters for picking a seal warehouse (Return Warehouse, custody handover).
SEAL_WAREHOUSE_FILTERS = {"is_group": 0, "disabled": 0}
SEAL_WAREHOUSE_OR_FILTERS = [[b, "=", 1] for b in SEAL_BRANCHES]


def seal_warehouses(extra_filters=None, **kwargs):
	"""Active seal warehouses (ECTS or RECTS ticked), as frappe.get_all rows."""
	return frappe.get_all(
		"Warehouse",
		filters={**SEAL_WAREHOUSE_FILTERS, **(extra_filters or {})},
		or_filters=SEAL_WAREHOUSE_OR_FILTERS,
		**kwargs,
	)


def is_seal_warehouse(warehouse):
	"""True when ``warehouse`` is an active seal warehouse (ECTS or RECTS ticked)."""
	return bool(warehouse) and bool(seal_warehouses({"name": warehouse}, limit=1))


def warehouse_system(warehouse):
	"""The system a seal warehouse serves, from its Branch: "RECTs" when only RECTS
	is ticked, "TNT" (PCB) when ECTS is ticked and RECTS isn't, None for any other
	warehouse and for one shared by both (no system restriction)."""
	if not warehouse:
		return None
	ects, rects = frappe.db.get_value("Warehouse", warehouse, ["custom_division_ects", "custom_division_rects"]) or (0, 0)
	if cint(rects) and not cint(ects):
		return "RECTs"
	return "TNT" if cint(ects) and not cint(rects) else None


def check_seal_system(seal, warehouse):
	"""Refuse moving a seal into a warehouse of the other system: a PCB seal only
	rests in PCB warehouses and a RECTs seal only in RECTs ones."""
	target = warehouse_system(warehouse)
	owner = frappe.db.get_value("Seal Device", seal, "belongs_to") or "TNT"
	if target and target != owner:
		frappe.throw(
			_("Seal {0} belongs to {1} and can't be moved into {2}, a {3} warehouse.").format(
				seal, "RECTs" if owner == "RECTs" else "PCB", warehouse, "RECTs" if target == "RECTs" else "PCB"
			),
			title=_("Different System"),
		)


def get_customer_warehouse(customer, store=None):
	"""The ERPNext warehouse holding the seals sold to ``customer``, created on
	first use next to the main seal store (same company and parent). A Material
	Transfer into it is how a sale takes the seals out of the store's ERP stock."""
	name = frappe.db.get_value("Warehouse", {"custom_customer": customer, "disabled": 0}, "name")
	if name:
		return name
	store = store or main_seal_store()
	if not store:
		frappe.throw(_("Can't create a warehouse for the customer: no seal store to base it on."))
	company, parent = frappe.db.get_value("Warehouse", store, ["company", "parent_warehouse"])
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	wh = frappe.get_doc(
		{
			"doctype": "Warehouse",
			"warehouse_name": customer_name,
			"company": company,
			"parent_warehouse": parent,
			"custom_customer": customer,
		}
	)
	wh.flags.ignore_permissions = True
	wh.insert()
	return wh.name


def main_seal_store():
	"""Name of the warehouse flagged Main Seal Store, if any."""
	rows = seal_warehouses({"custom_is_main_seal_store": 1}, pluck="name", limit=1)
	return rows[0] if rows else None


@frappe.whitelist()
def get_seal_warehouse_options():
	"""Active seal warehouses for pickers, main store first. A plain list, so the
	handover dialog works for roles (e.g. Operations Control Room) that have no
	permission on the ERPNext Warehouse doctype."""
	return seal_warehouses(
		fields=["name", "warehouse_name"],
		order_by="custom_is_main_seal_store desc, warehouse_name asc",
	)


# The Warehouses page is a shortcut to where seals are: the ERPNext warehouses
# of the ECTS division (where Material Transfer / Issue / Receipt book them),
# plus whoever holds seals right now outside a warehouse.
_WAREHOUSE_STATUSES = {"Active": 0, "Inactive": 1}  # value of Warehouse.disabled
_HOLDER_STATUSES = ("User", "Customer")

# Page roles that see every seal holder. A Field Technician (tag operator) with
# none of them sees only the seals in their own custody — where a seal rests is
# dynamic (Seal Device custody), so their "warehouse" is themselves.
_ALL_HOLDERS_ROLES = frozenset({
	"System Manager",
	"Operations Control Room",
	"Management",
	"Managing Director",
	"PCB Team Leader",
	"Account Manager",
})


# The seal journey life-cycle roles, as shown in the Warehouses page's Role
# column for staff holding seals (oversight roles like Management are left out).
_LIFECYCLE_ROLE_LABELS = {
	"Field Technician": "TO",
	"PCB Team Leader": "PCB Team Leader",
	"Operations Control Room": "Control Room",
	"Finance PCB": "Finance PCB",
	"Account Manager": "Account Manager",
}


# Who may set a staff member's base location on the Warehouses page (besides the
# staff member themselves). Stored on a hidden User field, so this replaces the
# System Manager-only User form.
_BASE_LOCATION_EDITORS = frozenset({
	"System Manager",
	"Operations Control Room",
	"Management",
	"Managing Director",
	"PCB Team Leader",
})


def is_technician_only(user=None):
	roles = set(frappe.get_roles(user or frappe.session.user))
	return "Field Technician" in roles and not roles & _ALL_HOLDERS_ROLES


@frappe.whitelist()
def get_warehouse_list(search=None, status="All", page=1, page_length=25, system="TNT"):
	"""Rows for the Warehouses page: every ERPNext Warehouse whose Branch
	Branch checkbox is ticked for ``system`` (TNT: ECTS;
	RECTS: RECTS — see SYSTEM_BRANCH), with the number of seals its stock
	ledger holds (Serial No.warehouse), plus the Users and Customers that seals
	are in the custody of right now — straight from each Seal Device, so they
	appear and drop off as seals move. ``status`` is All, or one or more of
	Active / Inactive / User / Customer (a list, or its JSON) — rows matching any
	of them; ``summary`` counts every status regardless of the search.

	Warehouses are read without per-user permissions: the page itself is
	role-gated, and several of its roles (Control Room, Management) can't read
	the Warehouse doctype."""
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length) or 25, 1), 100)
	search = (search or "").strip().lower()
	branch = SYSTEM_BRANCH.get(system) or SYSTEM_BRANCH["TNT"]

	sold = _seals_sold(system)
	if is_technician_only():
		mine = ("User", frappe.session.user)
		rows = _holder_rows({k: v for k, v in _seals_held_by_custodian(system).items() if k == mine}, sold)
	else:
		held = _seals_held_by_custodian(system)
		if system == "RECTS":
			# A customer's own warehouse (made when seals are sold to them) lists as a
			# Customer row even before they hold any seal; the Customers filter finds them.
			for customer in frappe.get_all(
				"Warehouse", filters={"custom_customer": ["is", "set"], "disabled": 0}, pluck="custom_customer"
			):
				held.setdefault(("Customer", customer), 0)
			# So does every customer seals were sold to, wherever those seals are now.
			for customer in sold["by_customer"]:
				held.setdefault(("Customer", customer), 0)
		rows = _division_warehouse_rows(branch, system) + _holder_rows(held, sold)

	def in_status(row, key):
		if key == "All":
			return True
		if key in _HOLDER_STATUSES or key == "Warehouse":
			return row["holder_type"] == key
		return row["holder_type"] == "Warehouse" and cint(row["disabled"]) == _WAREHOUSE_STATUSES[key]

	summary = {key: sum(1 for r in rows if in_status(r, key)) for key in ("All", "Warehouse", *_WAREHOUSE_STATUSES, *_HOLDER_STATUSES)}
	selected = _parse_statuses(status, summary)
	matched = [
		r
		for r in rows
		if (not selected or any(in_status(r, key) for key in selected))
		and (not search or search in r["search_text"])
	]
	# Warehouses always come first, then staff, then customers; customers whose
	# seals are sold (status Sold) always go to the bottom.
	matched.sort(
		key=lambda r: (
			{"Warehouse": 0, "User": 1, "Customer": 2}.get(r["holder_type"], 3),
			1 if r["holder_type"] == "Customer" and r.get("sold") else 0,
		)
	)
	start = (page - 1) * page_length
	return {
		"warehouses": [{k: v for k, v in r.items() if k != "search_text"} for r in matched[start : start + page_length]],
		"total": len(matched),
		"summary": summary,
		"can_create": frappe.has_permission("Warehouse", "create"),
		"can_read_warehouse": frappe.has_permission("Warehouse", "read"),
		"can_edit_base_location": bool(set(frappe.get_roles()) & _BASE_LOCATION_EDITORS),
		"session_user": frappe.session.user,
	}


@frappe.whitelist()
def download_warehouse_report(search=None, status="All", system="TNT", file_format="xlsx"):
	"""Download the Warehouses page list (same search and status filters, every
	row rather than one page) as an Excel or PDF file."""
	file_format = "pdf" if file_format == "pdf" else "xlsx"
	rows, page_no = [], 1
	while True:
		data = get_warehouse_list(search=search, status=status, page=page_no, page_length=100, system=system)
		rows += data["warehouses"]
		if len(rows) >= data["total"] or not data["warehouses"]:
			break
		page_no += 1

	rects = system == "RECTS"
	headers = ["Holder", "Type", "Role", "Status", "Seals"]
	if rects:
		headers += ["Sold", "ERP Stock", "Address / Contact"]
	else:
		headers += ["ERP Stock", "Location", "Company", "Parent Warehouse"]

	def line(r):
		is_wh = r["holder_type"] == "Warehouse"
		status_text = ("Inactive" if cint(r.get("disabled")) else "Active") if is_wh else "Holding"
		seals = r.get("seals_held")
		if is_wh:
			erp = r.get("in_stock") if r.get("show_erp_stock") else ""
		else:
			erp = ""
		out = [r.get("label"), r["holder_type"], r.get("role") or "", status_text, seals]
		if rects:
			out += [r.get("sold") or "", erp, r.get("address_line") or ""]
		else:
			out += [erp, r.get("location") or r.get("base_location") or "", r.get("company") or "", r.get("parent_warehouse") or ""]
		return out

	table = [line(r) for r in rows]
	title = "RECTs Warehouses" if rects else "TNT Warehouses"
	stamp = frappe.utils.now_datetime().strftime("%Y-%m-%d_%H%M")
	base = f"{title.replace(' ', '_')}_{stamp}"

	if file_format == "xlsx":
		from io import BytesIO

		from openpyxl import Workbook
		from openpyxl.styles import Font, PatternFill

		wb = Workbook()
		ws = wb.active
		ws.title = "Warehouses"
		ws.append(headers)
		for c in ws[1]:
			c.font = Font(bold=True)
			c.fill = PatternFill("solid", fgColor="DBEAFE")
		for t in table:
			ws.append(t)
		for i, h in enumerate(headers, 1):
			width = max([len(str(h))] + [len(str(t[i - 1] or "")) for t in table]) + 2
			ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(width, 60)
		ws.freeze_panes = "A2"
		buf = BytesIO()
		wb.save(buf)
		frappe.response["filename"] = base + ".xlsx"
		frappe.response["filecontent"] = buf.getvalue()
		frappe.response["type"] = "binary"
		return

	from frappe.utils import escape_html
	from frappe.utils.pdf import get_pdf

	head = "".join(f"<th>{escape_html(h)}</th>" for h in headers)
	body = "".join(
		"<tr>" + "".join(f"<td>{escape_html(str(v if v is not None else ''))}</td>" for v in t) + "</tr>" for t in table
	)
	html = f"""<style>
		body {{ font-family: sans-serif; font-size: 10px; }}
		h2 {{ margin: 0 0 2px; }} .meta {{ color: #64748b; margin-bottom: 10px; }}
		table {{ border-collapse: collapse; width: 100%; }}
		th, td {{ border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }}
		th {{ background: #dbeafe; }}
	</style>
	<h2>{title}</h2>
	<div class="meta">Generated {frappe.utils.format_datetime(frappe.utils.now_datetime())} &middot; {len(table)} row(s)</div>
	<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"""
	frappe.response["filename"] = base + ".pdf"
	frappe.response["filecontent"] = get_pdf(html, {"orientation": "Landscape"})
	frappe.response["type"] = "pdf"


@frappe.whitelist()
def set_staff_base_location(user, base_location=None):
	"""Set a staff member's fixed base (e.g. Mombasa office), shown on the
	Warehouses page next to the live GPS position of the seals they hold."""
	if user != frappe.session.user and not set(frappe.get_roles()) & _BASE_LOCATION_EDITORS:
		frappe.throw(_("Not permitted to set another staff member's base location."), frappe.PermissionError)
	if not frappe.db.exists("User", user):
		frappe.throw(_("User {0} not found").format(user))
	base_location = (base_location or "").strip() or None
	frappe.db.set_value("User", user, "custom_seal_base_location", base_location)
	return base_location


def _parse_statuses(status, known):
	"""The selected filters as a list; empty means All."""
	if isinstance(status, str):
		status = frappe.parse_json(status) if status.strip().startswith("[") else [status]
	return [s for s in (status or []) if s in known and s != "All"]


def _division_warehouse_rows(branch, system="TNT"):
	"""Seal warehouses with the ``branch`` checkbox ticked, active first, each with its seal count.
	Only seals that belong to ``system`` are counted: a RECTs warehouse can hold
	PCB seals, which don't show in RECTs seal management (and the other way round)."""
	owner = "RECTs" if system == "RECTS" else "TNT"
	# RECTs: for now the only warehouse is the seal store (Main Seal Store or Show
	# ERP Stock ticked: Agnes's); everyone else (staff, customers) is a holder.
	warehouses = frappe.get_all(
		"Warehouse",
		filters={branch: 1, "is_group": 0},
		or_filters=[["custom_is_main_seal_store", "=", 1], ["custom_show_erp_stock", "=", 1]] if owner == "RECTs" else None,
		fields=[
			"name", "warehouse_name", "company", "parent_warehouse", "disabled", "city", "address_line_1",
			"custom_is_main_seal_store", "custom_show_erp_stock", "custom_location",
		],
		order_by="custom_is_main_seal_store desc, disabled asc, warehouse_name asc",
	)
	names = [w.name for w in warehouses]
	stock = _seals_by_warehouse(names, owner)
	received = _seals_received_by_warehouse(names, owner)
	held = dict(
		frappe.get_all(
			"Seal Device",
			filters={
				"current_custody_type": "Warehouse",
				"current_custodian": ["in", names or [""]],
				"in_uffizio": 1,
				"belongs_to": "RECTs" if owner == "RECTs" else ["!=", "RECTs"],
			},
			fields=["current_custodian", "count(name)"],
			group_by="current_custodian",
			as_list=True,
		)
	)
	return [
		{
			"name": w.name,
			"label": w.warehouse_name or w.name,
			"holder_type": "Warehouse",
			"company": w.company,
			"parent_warehouse": w.parent_warehouse,
			"disabled": cint(w.disabled),
			"is_main_seal_store": cint(w.custom_is_main_seal_store),
			# The main seal store's keeper (Agnes, for RECTs) shows in the Role column.
			"role": _("Seals Manager") if cint(w.custom_is_main_seal_store or w.custom_show_erp_stock) else None,
			"show_erp_stock": cint(w.custom_is_main_seal_store or w.custom_show_erp_stock),
			"region": w.city,
			"location": w.custom_location,
			"address_line": w.address_line_1,
			# Seals Held is custody (what is physically there, as on the Warehouse
			# form); In Stock is ERPNext's Serial No count, shown alongside so the
			# two can be reconciled.
			# Seals Held is custody (what is physically there). The ERP Stock pill is
			# the initial ERP stock plus everything received since and never goes
			# down; the live stock is Seals In Stock (ERP) on the Warehouse form.
			"seals_held": cint(held.get(w.name)),
			"in_stock": max(received.get(w.name, 0), stock.get(w.name, 0)),
			"search_text": " ".join(
				str(v or "") for v in (w.name, w.warehouse_name, w.company, w.city, w.custom_location, w.address_line_1)
			).lower(),
		}
		for w in warehouses
	]


@frappe.whitelist()
def get_warehouse_stock_count(warehouse):
	"""Seal serials ERPNext has in stock in one warehouse, for the Warehouse form."""
	frappe.has_permission("Warehouse", "read", warehouse, throw=True)
	owner = warehouse_system(warehouse) or "TNT"
	return _seals_by_warehouse([warehouse], owner).get(warehouse, 0)


@frappe.whitelist()
def get_holder_seals(custody_type, custodian, system="TNT"):
	"""Seals a staff member or customer holds right now, only those of ``system``
	(TNT / RECTS), for the holder panel on the Warehouses page. On RECTs a
	customer's list also has every seal sold to them that is away from them now
	(with a TO tagging for them...); each row says who bought it and who has it."""
	if custody_type not in _HOLDER_STATUSES or not custodian:
		return []
	fields = [
		"name", "seal_number", "device_id", "current_status", "lock_status", "condition", "current_custody_since",
		"current_journey", "seal_category", "category_customer", "category_customer_name",
		"current_custody_type", "current_custodian", "current_custody_label",
	]
	belongs = "RECTs" if system == "RECTS" else ["!=", "RECTs"]
	rows = frappe.get_list(
		"Seal Device",
		filters={"current_custody_type": custody_type, "current_custodian": custodian, "belongs_to": belongs},
		fields=fields,
		order_by="current_custody_since desc, seal_number asc",
		limit_page_length=0,
	)
	if system == "RECTS" and custody_type == "Customer":
		mine = {r.name for r in rows}
		rows += [
			r
			for r in frappe.get_list(
				"Seal Device",
				filters={"belongs_to": "RECTs", "seal_category": SOLD_CATEGORY, "category_customer": custodian},
				fields=fields,
				order_by="seal_number asc",
				limit_page_length=0,
			)
			if r.name not in mine
		]
	for r in rows:
		r.sold = r.seal_category == SOLD_CATEGORY and bool(r.category_customer)
	return rows


def _seals_by_warehouse(warehouses, owner="TNT"):
	"""{warehouse: seal count} from the stock ledger: Serial Nos that are seals of
	``owner`` (TNT / RECTs), matched on the Seal Device's name, serial number or IMEI."""
	if not warehouses:
		return {}
	rows = frappe.db.sql(
		"""
		select sn.warehouse, count(distinct sn.name)
		from `tabSerial No` sn
		where sn.warehouse in %(warehouses)s
			and exists (
				select 1 from `tabSeal Device` sd
				where sn.name in (sd.name, sd.serial_number, sd.imei_number)
					and ifnull(sd.in_uffizio, 1) = 1
					and (ifnull(sd.belongs_to, 'TNT') = 'RECTs') = %(rects)s
			)
		group by sn.warehouse
		""",
		{"warehouses": tuple(warehouses), "rects": 1 if owner == "RECTs" else 0},
	)
	return {warehouse: cint(count) for warehouse, count in rows}


def _seals_received_by_warehouse(warehouses, owner="TNT"):
	"""{warehouse: seals ever received}: distinct seal serials with a submitted
	inward Serial and Batch Bundle into the warehouse (receipts and transfers in),
	whether or not they have since left."""
	if not warehouses:
		return {}
	rows = frappe.db.sql(
		"""
		select sbb.warehouse, count(distinct sbe.serial_no)
		from `tabSerial and Batch Entry` sbe
		join `tabSerial and Batch Bundle` sbb on sbb.name = sbe.parent
		where sbb.warehouse in %(warehouses)s
			and sbb.docstatus = 1 and ifnull(sbb.is_cancelled, 0) = 0
			and sbb.type_of_transaction = 'Inward'
			and ifnull(sbe.serial_no, '') != ''
			and exists (
				select 1 from `tabSeal Device` sd
				where sbe.serial_no in (sd.name, sd.serial_number, sd.imei_number)
					and ifnull(sd.in_uffizio, 1) = 1
					and (ifnull(sd.belongs_to, 'TNT') = 'RECTs') = %(rects)s
			)
		group by sbb.warehouse
		""",
		{"warehouses": tuple(warehouses), "rects": 1 if owner == "RECTs" else 0},
	)
	return {warehouse: cint(count) for warehouse, count in rows}


def _seals_held_by_custodian(system="TNT"):
	"""{(custody_type, custodian): seal count} for seals held by a User or Customer,
	counting only the seals that belong to ``system`` (TNT / RECTS)."""
	rows = frappe.get_all(
		"Seal Device",
		filters={
			"current_custody_type": ["in", _HOLDER_STATUSES],
			"current_custodian": ["is", "set"],
			"in_uffizio": 1,
			"belongs_to": "RECTs" if system == "RECTS" else ["!=", "RECTs"],
		},
		fields=["current_custody_type", "current_custodian", "count(name) as seals"],
		group_by="current_custody_type, current_custodian",
		limit_page_length=0,
	)
	return {(r.current_custody_type, r.current_custodian): cint(r.seals) for r in rows}


SOLD_CATEGORY = "Outright Purchase"


def _seals_sold(system="TNT"):
	"""RECTs seals bought outright, by buyer, wherever each is now: with the
	buyer, or away from them (a TO collecting them to tag, a warehouse...).
	{"by_customer": {customer: {"total", "with_customer", "away": {label: n}}},
	 "by_user": {user: {customer: n}}}. Empty for TNT: only RECTs seals are sold."""
	out = {"by_customer": {}, "by_user": {}}
	if system != "RECTS":
		return out
	seals = frappe.get_all(
		"Seal Device",
		filters={"belongs_to": "RECTs", "seal_category": SOLD_CATEGORY, "category_customer": ["is", "set"]},
		fields=["category_customer", "current_custody_type", "current_custodian", "current_custody_label", "current_journey"],
		limit_page_length=0,
	)
	users = {s.current_custodian for s in seals if s.current_custody_type == "User" and s.current_custodian}
	names = dict(frappe.get_all("User", filters={"name": ["in", list(users)]}, fields=["name", "full_name"], as_list=True)) if users else {}
	roles = _lifecycle_roles(list(users))
	for s in seals:
		entry = out["by_customer"].setdefault(s.category_customer, {"total": 0, "with_customer": 0, "away": {}})
		entry["total"] += 1
		if s.current_custody_type == "Customer" and s.current_custodian == s.category_customer:
			entry["with_customer"] += 1
			continue
		# A word for who has them, e.g. "TO" for a technical officer tagging for the buyer.
		if s.current_custody_type == "User":
			where = names.get(s.current_custodian) or s.current_custodian
			kind = (roles.get(s.current_custodian) or [_("Staff")])[0]
			out["by_user"].setdefault(s.current_custodian, {}).setdefault(s.category_customer, 0)
			out["by_user"][s.current_custodian][s.category_customer] += 1
		elif s.current_custody_type and s.current_custodian:
			where = s.current_custody_label or s.current_custodian
			kind = _(s.current_custody_type)
		else:
			where, kind = _("no custodian"), None
		if s.current_journey:
			where = _("{0}, on a journey").format(where)
		key = (kind, where)
		entry["away"][key] = entry["away"].get(key, 0) + 1
	return out


def _holder_rows(held, sold=None):
	"""One row per User or Customer holding seals right now, most seals first.
	On RECTs a customer's row counts the seals sold to them (Sold), wherever
	they are, plus any others in their custody (Holding); a staff row notes the
	sold seals it is carrying for their owners."""
	sold = sold or {"by_customer": {}, "by_user": {}}
	users = [c for (t, c) in held if t == "User"]
	customers = [c for (t, c) in held if t == "Customer"]
	customers += [c for owners in sold["by_user"].values() for c in owners if c not in customers]
	user_info = {
		u.name: u
		for u in frappe.get_all(
			"User", filters={"name": ["in", users]}, fields=["name", "full_name", "custom_seal_base_location"]
		)
	} if users else {}
	customer_info = {
		c.name: c
		for c in frappe.get_all(
			"Customer", filters={"name": ["in", customers]}, fields=["name", "customer_name", "territory"]
		)
	} if customers else {}

	user_roles = _lifecycle_roles(users)
	user_locations = _staff_locations(users)

	rows = []
	for (custody_type, custodian), seals in held.items():
		role = location = base_location = None
		sold_info = {}
		if custody_type == "User":
			info = user_info.get(custodian) or frappe._dict()
			label, region, detail = info.full_name or custodian, None, custodian
			role = ", ".join(user_roles.get(custodian, [])) or None
			location = user_locations.get(custodian)
			base_location = info.custom_seal_base_location
			carrying = sold["by_user"].get(custodian) or {}
			if carrying:
				sold_info["sold_carrying"] = [
					{"customer": (customer_info.get(c) or frappe._dict()).customer_name or c, "count": n}
					for c, n in sorted(carrying.items())
				]
		elif custody_type == "Customer":
			info = customer_info.get(custodian) or frappe._dict()
			# The root territory says nothing about where the customer is.
			region = info.territory if info.territory != "All Territories" else None
			label, detail = info.customer_name or custodian, None
			bought = sold["by_customer"].get(custodian)
			if bought:
				# Seals in their custody that they didn't buy (leased) still show as held.
				holding = max(seals - bought["with_customer"], 0)
				sold_info = {
					"sold": bought["total"],
					"sold_with_customer": bought["with_customer"],
					"sold_away": [
						{"kind": kind, "label": where, "count": n}
						for (kind, where), n in sorted(bought["away"].items(), key=lambda i: (i[0][0] or "~", i[0][1]))
					],
					"holding": holding,
				}
				seals = bought["total"] + holding
		else:
			continue
		rows.append(
			{
				"name": custodian,
				"label": label,
				"holder_type": custody_type,
				"region": region,
				"location": location,
				"base_location": base_location,
				"role": role,
				"address_line": detail,
				"seals_held": seals,
				**sold_info,
				"search_text": " ".join(
					str(v or "")
					for v in (custodian, label, region, base_location, location, role, custody_type, "sold" if sold_info else "")
				).lower(),
			}
		)
	rows.sort(key=lambda r: (r["holder_type"], -r["seals_held"], r["label"].lower()))
	return rows


def _lifecycle_roles(users):
	"""{user: [life-cycle role labels]} for the given users, in a fixed order."""
	if not users:
		return {}
	held = {}
	for user, role in frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "parent": ["in", users], "role": ["in", list(_LIFECYCLE_ROLE_LABELS)]},
		fields=["parent", "role"],
		as_list=True,
	):
		held.setdefault(user, set()).add(role)
	return {
		user: [label for role, label in _LIFECYCLE_ROLE_LABELS.items() if role in roles]
		for user, roles in held.items()
	}


def _staff_locations(users):
	"""{user: location} — a person holding seals is a moving warehouse, so their
	location is the latest GPS fix among the seals in their custody."""
	if not users:
		return {}
	locations = {}
	for d in frappe.get_all(
		"Seal Device",
		filters={
			"current_custody_type": "User",
			"current_custodian": ["in", users],
			"in_uffizio": 1,
			"last_known_api_location": ["is", "set"],
		},
		fields=["current_custodian", "last_known_api_location"],
		order_by="last_api_sync_time desc",
	):
		locations.setdefault(d.current_custodian, d.last_known_api_location)
	return locations
