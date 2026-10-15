# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, now_datetime


class SealDevice(Document):
	pass


_DOCTYPE = "Seal Device"

# Custody types allowed on the dynamic pointer. Each maps to the field on the
# target doctype that yields a human-friendly name for the custodian.
_CUSTODY_LABEL_FIELD = {
	# The full warehouse name (e.g. "Stores - TD"), as the old Custody Points were
	# named, so custody labels and status history read the same before and after.
	"Warehouse": "name",
	"PCB Job Order": "name",
	"User": "full_name",
	"Customer": "customer_name",
}

_CUSTODY_TYPE_PREFIX = {
	"Warehouse": "Warehouse",
	"PCB Job Order": "Job Order",
	"User": "Person",
	"Customer": "Customer",
}

# The custody columns on the single per-journey Seal Status History row, in the
# order a seal moves through them. Callers pass one of these as ``column`` so the
# handoff is recorded inline against the journey's one row instead of a row per
# hop. See set_seal_custody / record_journey_custody.
JOURNEY_CUSTODY_COLUMNS = (
	"start_warehouse",
	"tagging_to",
	"customer",
	"untagging_to",
	"seal_return_to",
	"return_warehouse",
)

_ENTRY_TYPE_JOURNEY_SUMMARY = "Journey Summary"


def _custodian_name(custody_type, custodian):
	"""Plain human name for a custodian, e.g. 'Diana Nyambura' / 'ACME Ltd' /
	'Nairobi Depot' — no role prefix, since the column name already conveys the
	role."""
	if not custody_type or not custodian:
		return ""
	label_field = _CUSTODY_LABEL_FIELD.get(custody_type, "name")
	if label_field == "name":
		return custodian
	return frappe.db.get_value(custody_type, custodian, label_field) or custodian


def _custody_label(custody_type, custodian):
	"""Prefixed label for the live pointer field, e.g. 'Warehouse: Nairobi Depot'."""
	name = _custodian_name(custody_type, custodian)
	if not name:
		return ""
	prefix = _CUSTODY_TYPE_PREFIX.get(custody_type, custody_type)
	return f"{prefix}: {name}"


def main_warehouse_name():
	"""Name of the warehouse flagged Main Seal Store, if any."""
	from tnt_seal_management.tnt_seal_management.api.seal_warehouses import main_seal_store

	return main_seal_store()


def last_known_warehouse(seal_device, exclude_journey=None):
	"""
	The most recent return warehouse recorded for this seal across its past
	journeys — i.e. where it was last returned to. Used as the start warehouse
	for a new journey's custody row. Returns None if the seal has no prior
	journey with a recorded return warehouse (e.g. its first cycle) — the caller
	should leave the column blank in that case; it will start getting logged from
	the next cycle onward.
	"""
	if not seal_device:
		return None
	filters = {
		"seal": seal_device,
		"entry_type": _ENTRY_TYPE_JOURNEY_SUMMARY,
		"return_warehouse": ["!=", ""],
	}
	if exclude_journey:
		filters["journey"] = ["!=", exclude_journey]
	rows = frappe.get_all(
		"Seal Status History",
		filters=filters,
		fields=["return_warehouse"],
		order_by="modified desc",
		limit=1,
	)
	return rows[0].return_warehouse if rows else None


def journey_start_custody(seal_device, exclude_journey=None):
	"""Where the seal is starting its next journey from, for the start_warehouse
	column on that journey's custody row.

	That is whoever holds it right now, from the live custody pointer: the
	warehouse it sits in (after a return, a Material Transfer, a handover or the
	GPS store check), the person it was handed to, or the customer still holding
	it after a journey that ended with the seal left on the vehicle (see
	journey_request.close_for_retained_seal). Only a seal with no custody on
	record falls back to the warehouse its previous journey returned it to."""
	if not seal_device:
		return None
	custody = frappe.db.get_value(
		_DOCTYPE, seal_device, ["current_custody_type", "current_custodian"], as_dict=True
	)
	if custody and custody.current_custody_type in ("Warehouse", "User", "Customer") and custody.current_custodian:
		return _custodian_name(custody.current_custody_type, custody.current_custodian)
	return last_known_warehouse(seal_device, exclude_journey=exclude_journey)


def record_journey_custody(seal_device, journey, column, values=None, remarks=None):
	"""
	Upsert the single "Journey Summary" row for (seal, journey) in the seal's
	status history and set one or more custody columns on it inline.

	Instead of a row per handoff, one row per journey accumulates the whole
	custody path across its columns (start_warehouse -> tagging_to -> customer ->
	untagging_to / seal_return_to -> return_warehouse) as the seal changes hands.

	``column``/``values``: pass a single ``column`` name with the value supplied
	positionally via ``values`` (a string), or pass ``column=None`` and a dict of
	{column: value} in ``values`` to set several at once.
	"""
	if not seal_device or not journey:
		return

	if column:
		values = {column: values}
	if not values:
		return
	values = {k: v for k, v in values.items() if k in JOURNEY_CUSTODY_COLUMNS and v}
	if not values:
		return

	doc = frappe.get_doc(_DOCTYPE, seal_device)
	row = next(
		(
			r
			for r in doc.status_history
			if r.journey == journey and r.entry_type == _ENTRY_TYPE_JOURNEY_SUMMARY
		),
		None,
	)
	if row is None:
		row = doc.append(
			"status_history",
			{"seal": seal_device, "journey": journey, "entry_type": _ENTRY_TYPE_JOURNEY_SUMMARY},
		)
	for key, value in values.items():
		row.set(key, value)
	row.status_date_time = now_datetime()
	row.updated_by = frappe.session.user
	# Remarks describe the hop just recorded, like status_date_time and
	# updated_by — a hop without one clears the previous hop's text rather than
	# leaving stale remarks attached to a newer handoff.
	row.remarks = remarks or None
	doc.save(ignore_permissions=True)


def set_seal_custody(seal_device, custody_type, custodian, remarks=None, journey=None, column=None):
	"""
	Move a seal into the custody of a new holder (its current "warehouse").

	Two responsibilities:
	  1. Update the live custody pointer on Seal Device (current_custody_type /
	     current_custodian / current_custody_label / current_custody_since) — this
	     is "who holds it right now" and is a no-op if unchanged.
	  2. If ``journey`` and ``column`` are given, record this handoff inline into
	     the journey's single Seal Status History row (see record_journey_custody).

	``custody_type`` is one of the Select options on Seal Device (Warehouse /
	User / Customer, plus PCB Job Order) and ``custodian`` is the name of a
	record of that doctype.
	"""
	if not seal_device or not custody_type or not custodian:
		return

	current = frappe.db.get_value(
		_DOCTYPE,
		seal_device,
		["current_custody_type", "current_custodian"],
		as_dict=True,
	)
	if not current:
		return

	changed = not (
		current.current_custody_type == custody_type
		and current.current_custodian == custodian
	)
	if changed:
		frappe.db.set_value(
			_DOCTYPE,
			seal_device,
			{
				"current_custody_type": custody_type,
				"current_custodian": custodian,
				"current_custody_label": _custody_label(custody_type, custodian),
				"current_custody_since": now_datetime(),
			},
		)

	if journey and column:
		record_journey_custody(
			seal_device,
			journey,
			column,
			_custodian_name(custody_type, custodian),
			remarks=remarks,
		)


_TRANSFER_TARGET_TYPES = ("Warehouse", "User")
# Roles that may hand over ANY seal (a Field Technician may only hand over
# seals they are currently holding).
_TRANSFER_SUPERVISOR_ROLES = ("System Manager", "Operations Control Room", "PCB Team Leader")


@frappe.whitelist()
def transfer_custody(seals, to_custody_type, to_custodian, remarks=None, item_code=None):
	"""Hand seals over to a live person (User) or a seal warehouse (an ERPNext Warehouse
	whose Branch is ECTS Division or Both, such as the main store). One step: custody moves as soon as this is submitted, and a
	Seal Custody Transfer record keeps who moved what from whom to whom.

	To a warehouse, stock moves with custody: a Material Transfer is raised for
	the seals' serials under ``item_code`` and sent for approval through the
	Stock Entry workflow (see stock_seal_transfers.request_seal_material_transfer).
	Nothing moves until a stock approver approves it; the submit's hook then moves
	custody and writes the history. Every seal must be in stock under that item; a seal
	whose stock already sits in the target only has its custody moved. A handover
	to a person moves custody only.

	Seals held by a Customer move only through the journey workflow, and a seal on
	a journey that is In Transit can't be handed over."""
	seals = frappe.parse_json(seals) if isinstance(seals, str) else seals
	# Seal names are often all digits; a client can send them as numbers.
	seals = list(dict.fromkeys(cstr(s) for s in (seals or []) if cstr(s)))
	if not seals:
		frappe.throw(_("Select at least one seal to transfer."))
	if to_custody_type not in _TRANSFER_TARGET_TYPES:
		frappe.throw(_("Seals can only be handed to a person or a seal warehouse."))
	if not to_custodian or not frappe.db.exists(to_custody_type, to_custodian):
		frappe.throw(_("Select who is receiving the seals."))
	if to_custody_type == "User" and not frappe.db.get_value("User", to_custodian, "enabled"):
		frappe.throw(_("{0} is not an active user.").format(to_custodian))
	if to_custody_type == "Warehouse":
		from tnt_seal_management.tnt_seal_management.api.seal_warehouses import is_seal_warehouse

		if not is_seal_warehouse(to_custodian):
			frappe.throw(_("{0} is not an active seal warehouse (Branch ECTS Division or Both).").format(to_custodian))

	user = frappe.session.user
	supervisor = user == "Administrator" or bool(set(frappe.get_roles(user)) & set(_TRANSFER_SUPERVISOR_ROLES))

	rows = []
	for seal in seals:
		info = frappe.db.get_value(
			_DOCTYPE,
			seal,
			["current_custody_type", "current_custodian", "current_custody_label", "current_journey"],
			as_dict=True,
		)
		if not info:
			frappe.throw(_("Seal {0} not found.").format(seal))
		if not supervisor and not (info.current_custody_type == "User" and info.current_custodian == user):
			frappe.throw(
				_("You can only hand over seals you are currently holding ({0} is not with you).").format(seal),
				frappe.PermissionError,
			)
		if info.current_custody_type == "Customer":
			frappe.throw(_("Seal {0} is with a customer; it moves back through the journey workflow.").format(seal))
		if info.current_custody_type == to_custody_type and info.current_custodian == to_custodian:
			frappe.throw(_("Seal {0} is already with {1}.").format(seal, to_custodian))
		if info.current_journey and frappe.db.get_value("Seal Journey", info.current_journey, "journey_status") == "In Transit":
			frappe.throw(_("Seal {0} is on a journey in transit and can't be handed over.").format(seal))
		rows.append(
			{
				"seal_device": seal,
				"from_custody_type": info.current_custody_type,
				"from_custodian": info.current_custodian,
				"from_label": info.current_custody_label,
			}
		)

	stock_entry, pending = None, False
	stocked = set()  # seals whose custody and history the Material Transfer handles
	if to_custody_type == "Warehouse":
		from tnt_seal_management.tnt_seal_management.api.stock_seal_transfers import (
			pending_seal_transfers,
			request_seal_material_transfer,
			seal_stock_serials,
		)

		if not item_code:
			frappe.throw(_("Select the Item Code the seals are stocked under."), title=_("Item Code Required"))
		serials = seal_stock_serials([r["seal_device"] for r in rows])
		missing = [r["seal_device"] for r in rows if r["seal_device"] not in serials]
		if missing:
			frappe.throw(
				_("These seals have no serial in stock, so they can't be moved to {0}: {1}. Receive them into stock first.").format(
					to_custodian, ", ".join(missing)
				),
				title=_("Not in Stock"),
			)
		other_item = [f"{seal} ({s.item_code})" for seal, s in serials.items() if s.item_code != item_code]
		if other_item:
			frappe.throw(
				_("These seals are stocked under a different item than {0}: {1}. Transfer them separately under their own item code.").format(
					item_code, ", ".join(other_item)
				),
				title=_("Item Code Mismatch"),
			)
		waiting = pending_seal_transfers(serial_nos=[s.serial_no for s in serials.values()])
		if waiting:
			held = {serial for entry in waiting.values() for serial in entry["serials"]}
			warehouses = sorted({w for entry in waiting.values() for w in entry["from"] | entry["to"] if w})
			frappe.throw(
				_("These seals already have a transfer awaiting approval ({0}): {1}. A stock approver can approve or return it under Transfers awaiting approval on the {2} warehouse form, or on the Stock Entry itself.").format(
					", ".join(waiting),
					", ".join(seal for seal, s in serials.items() if s.serial_no in held),
					" / ".join(warehouses),
				),
				title=_("Awaiting Approval"),
			)
		to_move = [s for seal, s in serials.items() if s.warehouse != to_custodian]
		if to_move:
			stock_entry, pending = request_seal_material_transfer(
				to_move,
				to_custodian,
				remarks=_("Seal transfer by {0}{1}").format(user, f": {remarks}" if remarks else ""),
			)
			stocked = {s.seal for s in to_move}

	for row in rows:
		if row["seal_device"] in stocked:
			continue
		set_seal_custody(
			row["seal_device"],
			to_custody_type,
			to_custodian,
			remarks=remarks or _("Handed over by {0}").format(user),
		)
	to_label = _custody_label(to_custody_type, to_custodian)
	# Seals waiting on the approval haven't moved, so they aren't on the transfer
	# record; their move is recorded by the Material Transfer when approved.
	moved_rows = [r for r in rows if not (pending and r["seal_device"] in stocked)]
	transfer = None
	if moved_rows:
		transfer = frappe.get_doc(
			{
				"doctype": "Seal Custody Transfer",
				"transfer_date_time": now_datetime(),
				"transferred_by": user,
				"to_custody_type": to_custody_type,
				"to_custodian": to_custodian,
				"to_label": to_label,
				"remarks": " — ".join(filter(None, [remarks, stock_entry and _("Stock Entry {0}").format(stock_entry)])) or None,
				"seals": moved_rows,
			}
		).insert(ignore_permissions=True)
	for row in moved_rows:
		if row["seal_device"] in stocked:
			continue  # the Material Transfer's hook wrote this seal's history row
		_append_transfer_history(
			row["seal_device"],
			row["from_label"] or _("(no custodian)"),
			to_label,
			_("{0}{1}").format(transfer.name, f" — {remarks}" if remarks else ""),
			from_warehouse=row["from_custodian"] if row["from_custody_type"] == "Warehouse" else None,
			to_warehouse=to_custodian if to_custody_type == "Warehouse" else None,
		)
	return {
		"transfer": transfer.name if transfer else None,
		"transferred": len(moved_rows),
		"stock_entry": stock_entry,
		"awaiting_approval": len(stocked) if pending else 0,
	}


def _append_transfer_history(seal_device, from_label, to_label, note, from_warehouse=None, to_warehouse=None):
	"""A "Seal Transfer" row in the seal's Status History: any movement outside a
	journey's own custody path (handover, custody to custody, stock distribution).
	The warehouses it moved between, when it did, go in the row's Start Warehouse
	(from) and Return Warehouse (to) columns so they show in the history table;
	those columns are only read back for "Journey Summary" rows."""
	# Inserted directly rather than via a Seal Device save: older seals can carry
	# legacy history rows (e.g. entry_type "Handoff") that would fail validation
	# on a full save.
	idx = frappe.db.sql(
		"select ifnull(max(idx), 0) from `tabSeal Status History` where parent = %s and parenttype = %s",
		(seal_device, _DOCTYPE),
	)[0][0]
	frappe.get_doc(
		{
			"doctype": "Seal Status History",
			"parent": seal_device,
			"parenttype": _DOCTYPE,
			"parentfield": "status_history",
			"idx": idx + 1,
			"seal": seal_device,
			"entry_type": "Seal Transfer",
			"status_date_time": now_datetime(),
			"updated_by": frappe.session.user,
			"start_warehouse": from_warehouse,
			"return_warehouse": to_warehouse,
			"remarks": f"{from_label} → {to_label} ({note})",
		}
	).db_insert()


@frappe.whitelist()
def get_custody_seals(custody_type, custodian):
	"""Seals whose live custody pointer is the given location right now
	(set_seal_custody moves a seal in on return and away on dispatch). Used by
	the "Seals in this ..." table on the Warehouse form."""
	if not custody_type or not custodian:
		return []
	return frappe.get_list(
		_DOCTYPE,
		filters={"current_custody_type": custody_type, "current_custodian": custodian},
		fields=[
			"name",
			"seal_number",
			"device_id",
			"current_status",
			"lock_status",
			"condition",
			"current_custody_since",
		],
		order_by="current_custody_since desc, seal_number asc",
		limit_page_length=0,
	)


@frappe.whitelist()
def get_warehouse_seals(warehouse):
	"""Seals whose live custody is this ERPNext Warehouse, for the Warehouse
	form's panel, each flagged ``in_stock`` with its ``stock_warehouse`` (whether
	the seal has an ERPNext serial in stock — a transfer to a warehouse needs
	one, see transfer_custody) and ``pending_transfer``: the Material Transfer
	awaiting approval that would move it, if any."""
	from tnt_seal_management.tnt_seal_management.api.stock_seal_transfers import (
		pending_seal_transfers,
		seal_stock_serials,
	)

	seals = get_custody_seals("Warehouse", warehouse)
	serials = seal_stock_serials([s.name for s in seals])
	waiting = pending_seal_transfers(serial_nos=[s.serial_no for s in serials.values()])
	for seal in seals:
		serial = serials.get(seal.name)
		seal.in_stock = bool(serial)
		seal.stock_warehouse = serial.warehouse if serial else None
		seal.pending_transfer = next(
			(name for name, entry in waiting.items() if serial and serial.serial_no in entry["serials"]), None
		)
	return seals


# Placement view, kept for later: lists seals here by custody OR by stock and
# flags whether the two agree ("here" / "stock_only" / "custody_only").
# @frappe.whitelist()
# def get_warehouse_seals(warehouse):
# 	"""Seals at an ERPNext Warehouse, for the Warehouse form's panel: those whose
# 	live custody is this warehouse and those whose serial is in stock here, each
# 	with ``placement`` saying whether the two agree —
#
# 	  "here"         custody and stock are both this warehouse
# 	  "stock_only"   stock is here, custody is elsewhere (or not recorded)
# 	  "custody_only" custody is here, stock is in another warehouse (or none)
#
# 	The same seals the Warehouses page counts by stock, plus those held here by
# 	custody alone."""
# 	if not warehouse:
# 		return []
# 	stock = dict(
# 		frappe.db.sql(
# 			"""
# 			select sd.name, sn.warehouse
# 			from `tabSeal Device` sd
# 			join `tabSerial No` sn on sn.name in (sd.name, sd.serial_number, sd.imei_number)
# 			where sn.status = 'Active' and ifnull(sn.warehouse, '') != ''
# 				and (sn.warehouse = %(w)s
# 					or (sd.current_custody_type = 'Warehouse' and sd.current_custodian = %(w)s))
# 			""",
# 			{"w": warehouse},
# 		)
# 	)
# 	in_stock_here = [seal for seal, wh in stock.items() if wh == warehouse]
# 	or_filters = [["name", "in", in_stock_here or [""]]]
# 	or_filters.append(["current_custodian", "=", warehouse])
# 	seals = frappe.get_list(
# 		_DOCTYPE,
# 		or_filters=or_filters,
# 		fields=[
# 			"name",
# 			"seal_number",
# 			"device_id",
# 			"current_status",
# 			"lock_status",
# 			"condition",
# 			"current_custody_type",
# 			"current_custodian",
# 			"current_custody_label",
# 			"current_custody_since",
# 		],
# 		order_by="current_custody_since desc, seal_number asc",
# 		limit_page_length=0,
# 	)
# 	rows = []
# 	for seal in seals:
# 		custody_here = seal.current_custody_type == "Warehouse" and seal.current_custodian == warehouse
# 		stock_here = stock.get(seal.name) == warehouse
# 		if not (custody_here or stock_here):
# 			continue  # same custodian name under another custody type
# 		seal.stock_warehouse = stock.get(seal.name)
# 		seal.placement = "here" if custody_here and stock_here else ("custody_only" if custody_here else "stock_only")
# 		rows.append(seal)
# 	order = {"here": 0, "stock_only": 1, "custody_only": 2}
# 	rows.sort(key=lambda r: order[r.placement])
# 	return rows
