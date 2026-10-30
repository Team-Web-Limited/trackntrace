import frappe
from frappe import _
from frappe.utils import cstr

from tnt_seal_management.tnt_seal_management.api.seal_warehouses import is_seal_warehouse

_PURPOSES = ("Material Receipt", "Material Issue", "Material Transfer")


def _row_serials(row):
	"""Serial numbers on one Stock Entry row: the Serial and Batch Bundle (v15),
	falling back to the legacy newline-separated serial_no text."""
	if row.get("serial_and_batch_bundle"):
		return frappe.get_all(
			"Serial and Batch Entry",
			filters={"parent": row.serial_and_batch_bundle, "serial_no": ["is", "set"]},
			pluck="serial_no",
		)
	return [s.strip() for s in cstr(row.get("serial_no")).split("\n") if s.strip()]


def seal_stock_serials(seals):
	"""{seal: Serial No row} for the seals whose ERPNext serial is in stock in a
	warehouse right now (status Active), matched on the Seal Device's name,
	serial number or IMEI."""
	if not seals:
		return {}
	rows = frappe.db.sql(
		"""
		select sd.name as seal, sn.name as serial_no, sn.item_code, sn.warehouse, sn.company
		from `tabSeal Device` sd
		join `tabSerial No` sn on sn.name in (sd.name, sd.serial_number, sd.imei_number)
		where sd.name in %(seals)s and sn.status = 'Active' and ifnull(sn.warehouse, '') != ''
		""",
		{"seals": tuple(seals)},
		as_dict=True,
	)
	return {r.seal: r for r in rows}


PENDING_APPROVAL = "Pending Approval"
# The Stock Entry workflow actions an approver can take from the seal panel.
SEAL_TRANSFER_ACTIONS = ("Approve", "Return For Amendment")


def request_seal_material_transfer(serials, target, remarks=None):
	"""Raise one Material Transfer moving the given seal serials (rows from
	seal_stock_serials) into ``target``, one item row per item code and source
	warehouse. Returns (stock entry name, pending).

	With the Stock Entry approval workflow active (as on this site), the entry
	is created as a Draft and moved to "Pending Approval" for the requester —
	the Control Room and Field Technicians who hand seals over don't hold the
	Regional Stock Manager role that "Send For Approval" needs — and the
	workflow's approvers are notified as usual. Nothing moves until an approver
	approves it (see act_on_seal_transfer, or ERPNext itself): the submit then
	runs on_stock_entry_submit, which moves custody and writes the history.
	Without a workflow it is submitted straight away."""
	from frappe.model.workflow import get_workflow_name
	from frappe.workflow.doctype.workflow_action.workflow_action import process_workflow_actions

	groups = {}
	for row in serials:
		groups.setdefault((row.item_code, row.warehouse), []).append(row.serial_no)
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Transfer",
			"purpose": "Material Transfer",
			"company": frappe.db.get_value("Warehouse", target, "company"),
			"remarks": remarks,
			"items": [
				{
					"item_code": item_code,
					"s_warehouse": source,
					"t_warehouse": target,
					"qty": len(serial_nos),
					"use_serial_batch_fields": 1,
					"serial_no": "\n".join(serial_nos),
				}
				for (item_code, source), serial_nos in groups.items()
			],
		}
	)
	entry.flags.ignore_permissions = True
	entry.insert()

	workflow = get_workflow_name("Stock Entry")
	if workflow and frappe.db.exists("Workflow Document State", {"parent": workflow, "state": PENDING_APPROVAL}):
		entry.db_set("workflow_state", PENDING_APPROVAL)
		entry.add_comment("Workflow", PENDING_APPROVAL)
		process_workflow_actions(entry, "on_update")
		return entry.name, True

	entry.submit()
	return entry.name, False


def pending_seal_transfers(serial_nos=None, warehouse=None):
	"""Material Transfers awaiting approval that move seal serials, as
	{stock entry: {"serials": {...}, "from": {...}, "to": {...}}}. Narrowed to the
	given serials, or to entries moving stock out of or into ``warehouse``."""
	rows = frappe.db.sql(
		"""
		select se.name, se.owner, se.creation, sed.serial_no, sed.s_warehouse, sed.t_warehouse
		from `tabStock Entry` se
		join `tabStock Entry Detail` sed on sed.parent = se.name and sed.parenttype = 'Stock Entry'
		where se.docstatus = 0 and se.purpose = 'Material Transfer' and se.workflow_state = %(state)s
		""",
		{"state": PENDING_APPROVAL},
		as_dict=True,
	)
	wanted = {cstr(s) for s in serial_nos} if serial_nos is not None else None
	out = {}
	for r in rows:
		serials = {s.strip() for s in cstr(r.serial_no).split("\n") if s.strip()}
		if wanted is not None and not serials & wanted:
			continue
		if warehouse and warehouse not in (r.s_warehouse, r.t_warehouse):
			continue
		entry = out.setdefault(
			r.name, {"owner": r.owner, "creation": r.creation, "serials": set(), "from": set(), "to": set()}
		)
		entry["serials"] |= serials if wanted is None else serials & wanted
		entry["from"].add(r.s_warehouse)
		entry["to"].add(r.t_warehouse)
	return out


@frappe.whitelist()
def get_seal_transfer_approvals(warehouse):
	"""Seal Material Transfers awaiting approval that move stock out of or into
	``warehouse``, for the Warehouse form's panel, with the approval actions the
	current user may take on each (empty for users the workflow doesn't allow)."""
	from frappe.model.workflow import get_transitions

	out = []
	for name, entry in pending_seal_transfers(warehouse=warehouse).items():
		seals = [s for s in (_seal_for_serial(serial) for serial in sorted(entry["serials"])) if s]
		if not seals:
			continue
		try:
			actions = sorted(
				{t.action for t in get_transitions(frappe.get_doc("Stock Entry", name)) if t.action in SEAL_TRANSFER_ACTIONS},
				key=SEAL_TRANSFER_ACTIONS.index,
			)
		except frappe.PermissionError:
			actions = []
		out.append(
			{
				"stock_entry": name,
				"requested_by": frappe.utils.get_fullname(entry["owner"]),
				"requested_on": entry["creation"],
				"from": sorted(w for w in entry["from"] if w),
				"to": sorted(w for w in entry["to"] if w),
				"seals": seals,
				"actions": actions,
			}
		)
	return out


@frappe.whitelist()
def act_on_seal_transfer(stock_entry, action):
	"""Approve or return a pending seal Material Transfer through the Stock Entry
	workflow, as the current user — the workflow checks they hold an approving
	role. Approving submits it, and on_stock_entry_submit then moves the seals'
	custody. Returns the new workflow state."""
	from frappe.model.workflow import apply_workflow

	if action not in SEAL_TRANSFER_ACTIONS:
		frappe.throw(_("Only {0} can be done here.").format(" / ".join(SEAL_TRANSFER_ACTIONS)))
	doc = frappe.get_doc("Stock Entry", stock_entry)
	if doc.workflow_state != PENDING_APPROVAL:
		frappe.throw(_("{0} is no longer awaiting approval ({1}).").format(stock_entry, doc.workflow_state))
	return apply_workflow(doc, action).workflow_state


@frappe.whitelist()
def get_seal_transfer_options(seals=None):
	"""Choices for the seal Transfer dialog: the seal warehouses, the stock items
	(those ticked Is Seal first) and the item code the selected seals' serials
	share, as the default. Plain lists, so the dialog works for roles (Control
	Room, PCB Team Leader, Field Technician) that can't read Warehouse or Item."""
	from tnt_seal_management.tnt_seal_management.api.seal_warehouses import get_seal_warehouse_options

	seals = frappe.parse_json(seals) if isinstance(seals, str) else (seals or [])
	items = frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1, "has_variants": 0},
		fields=["name", "item_name", "custom_is_seal"],
		order_by="custom_is_seal desc, name asc",
	)
	codes = {s.item_code for s in seal_stock_serials([cstr(x) for x in seals]).values()}
	# Only seals going from a warehouse into a main store move stock (and need an
	# item code); every other transfer is a plain handover.
	from_store = bool(
		seals
		and frappe.db.exists("Seal Device", {"name": ["in", [cstr(x) for x in seals]], "current_custody_type": "Warehouse"})
	)
	return {
		"from_store": from_store,
		"main_stores": frappe.get_all(
			"Warehouse", filters={"custom_is_main_seal_store": 1, "disabled": 0}, pluck="name"
		),
		"warehouses": [w.name for w in get_seal_warehouse_options()],
		"items": [
			{
				"value": i.name,
				"label": i.name,
				"description": " · ".join(
					filter(None, [_("Seal item") if i.custom_is_seal else None, i.item_name if i.item_name != i.name else None])
				),
			}
			for i in items
		],
		"default_item": codes.pop() if len(codes) == 1 else None,
	}


def _seal_for_serial(serial):
	"""Seal Device matching an ERPNext serial number (by name, IMEI or serial)."""
	for field in ("name", "imei_number", "serial_number"):
		name = frappe.db.get_value("Seal Device", {field: serial}, "name")
		if name:
			return name
	return None


def on_stock_entry_submit(doc, method=None):
	"""Stock Entry → Seal Transfer. For every seal serial on a Material Receipt /
	Issue / Transfer, write a "Seal Transfer" row in the seal's Status History and,
	when the target is a seal warehouse (an active warehouse whose Branch is ECTS Division or Both, such as
	Stores - TD), move the seal's custody there. Other warehouses, e.g. status
	buckets like "Seals In journey - TD" or "Cut seals - TD", only get the history
	row. Never raises — a stock posting must not fail because of
	seal bookkeeping."""
	if doc.purpose not in _PURPOSES:
		return
	try:
		_apply(doc, cancelled=False)
	except Exception:
		frappe.log_error(title="Stock Entry seal transfer", message=frappe.get_traceback())


def on_stock_entry_cancel(doc, method=None):
	"""Note the cancellation on each seal's history. Custody is not rolled back —
	the seal may have moved again since; correct it with a handover if needed."""
	if doc.purpose not in _PURPOSES:
		return
	try:
		_apply(doc, cancelled=True)
	except Exception:
		frappe.log_error(title="Stock Entry seal transfer", message=frappe.get_traceback())


def _apply(doc, cancelled):
	from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
		_append_transfer_history,
		set_seal_custody,
	)

	moved = noted = 0
	for row in doc.items:
		for serial in _row_serials(row):
			seal = _seal_for_serial(serial)
			if not seal:
				continue
			source = row.s_warehouse or (_("Supplier") if doc.purpose == "Material Receipt" else "-")
			target = row.t_warehouse or (_("Issued") if doc.purpose == "Material Issue" else "-")
			note = _("{0} {1}").format(doc.purpose, doc.name)
			if cancelled:
				_append_transfer_history(
					seal, source, target, _("{0} — cancelled, custody not reverted").format(note),
					from_warehouse=row.s_warehouse, to_warehouse=row.t_warehouse,
				)
				noted += 1
				continue

			custody_note = ""
			if is_seal_warehouse(row.t_warehouse):
				journey = frappe.db.get_value("Seal Device", seal, "current_journey")
				in_transit = journey and frappe.db.get_value("Seal Journey", journey, "journey_status") == "In Transit"
				if in_transit:
					custody_note = _(" — custody kept: seal is on a journey in transit")
				else:
					set_seal_custody(seal, "Warehouse", row.t_warehouse, remarks=note)
					moved += 1
			_append_transfer_history(
				seal, source, target, note + custody_note, from_warehouse=row.s_warehouse, to_warehouse=row.t_warehouse
			)
			noted += 1
	return {"history_rows": noted, "custody_moved": moved}
