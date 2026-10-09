import frappe
from frappe import _
from frappe.utils import cstr

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
	when the target warehouse has an active Custody Point of the same name (e.g.
	Stores - TD), move the seal's custody there. Status-bucket warehouses such as
	"Seals In journey - TD" or "Cut seals - TD" have no Custody Point, so they only
	get the history row. Never raises — a stock posting must not fail because of
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
				_append_transfer_history(seal, source, target, _("{0} — cancelled, custody not reverted").format(note))
				noted += 1
				continue

			custody_note = ""
			if row.t_warehouse and frappe.db.get_value("Custody Point", row.t_warehouse, "active"):
				journey = frappe.db.get_value("Seal Device", seal, "current_journey")
				in_transit = journey and frappe.db.get_value("Seal Journey", journey, "journey_status") == "In Transit"
				if in_transit:
					custody_note = _(" — custody kept: seal is on a journey in transit")
				else:
					set_seal_custody(seal, "Custody Point", row.t_warehouse, remarks=note)
					moved += 1
			_append_transfer_history(seal, source, target, note + custody_note)
			noted += 1
	return {"history_rows": noted, "custody_moved": moved}
