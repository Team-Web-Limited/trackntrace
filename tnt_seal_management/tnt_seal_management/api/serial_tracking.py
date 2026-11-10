"""Serial numbers typed against an item that doesn't track them.

ERPNext only creates Serial No records for items with "Has Serial No" ticked, so
a receipt listing serials for any other item fails at submit with a bare "Could
not find ... Serial No". And it won't let the box be ticked later once the item
is on any submitted document, Purchase Invoices included, even ones that never
moved stock. Here the receipt says so on save instead, and a stock manager can
turn tracking on from the Item while that is still safe: nothing has ever moved
the item in stock."""

import frappe
from frappe import _
from frappe.utils import cint

ENABLE_ROLES = frozenset({"System Manager", "Stock Manager", "Stock Manager (Technical)", "Regional Stock Manager"})

# Submitted documents that put an item's serials in or out of stock.
_STOCK_MOVING = (
	("Purchase Receipt Item", None),
	("Delivery Note Item", None),
	("Stock Entry Detail", None),
	("Stock Reconciliation Item", None),
	("Purchase Invoice Item", "Purchase Invoice"),
	("Sales Invoice Item", "Sales Invoice"),
	("POS Invoice Item", "POS Invoice"),
)


def check_untracked_serials(doc, method=None):
	"""Purchase Receipt validate: refuse serials on an item without serial tracking."""
	from erpnext.stock.doctype.serial_no.serial_no import get_serial_nos

	for row in doc.items:
		if not (row.get("serial_no") or "").strip() or not row.item_code:
			continue
		if cint(frappe.db.get_value("Item", row.item_code, "has_serial_no")):
			continue
		count = len(get_serial_nos(row.serial_no))
		if stock_moved(row.item_code):
			how = _("It has already moved in stock, so tracking can't be turned on: clear the Serial No box, or receive the serials under a serialised item.")
		else:
			how = _("Open the Item and click Track Serial Numbers (stock managers), then save this receipt again. Or clear the Serial No box.")
		frappe.throw(
			_("Row {0}: {1} serial numbers are entered for {2}, but the item doesn't track serial numbers (Has Serial No is off), so they can't be received.").format(
				row.idx, count, frappe.bold(row.item_code)
			)
			+ "<br><br>"
			+ how,
			title=_("Item Doesn't Track Serial Numbers"),
		)


def stock_moved(item_code):
	"""True once anything has put the item in or out of stock."""
	if frappe.db.exists("Stock Ledger Entry", {"item_code": item_code, "is_cancelled": 0}):
		return True
	for child, parent in _STOCK_MOVING:
		if parent:
			moved = frappe.db.sql(
				f"""select 1 from `tab{child}` c join `tab{parent}` p on p.name = c.parent
				where c.item_code = %s and c.docstatus = 1 and p.update_stock = 1 limit 1""",
				item_code,
			)
		else:
			moved = frappe.db.exists(child, {"item_code": item_code, "docstatus": 1})
		if moved:
			return True
	return False


@frappe.whitelist()
def get_serial_tracking_state(item_code):
	return {
		"can_enable": bool(set(frappe.get_roles()) & ENABLE_ROLES),
		"stock_moved": stock_moved(item_code),
	}


@frappe.whitelist()
def enable_serial_tracking(item_code):
	"""Tick Has Serial No on an item ERPNext won't let you change because it is
	on submitted documents, when none of them moved stock (e.g. Purchase
	Invoices without Update Stock): no stock record can clash with it."""
	if not set(frappe.get_roles()) & ENABLE_ROLES:
		frappe.throw(_("Only a stock manager can turn on serial tracking."), frappe.PermissionError)
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item not found."))
	if cint(frappe.db.get_value("Item", item_code, "has_serial_no")):
		return {"changed": False}
	if stock_moved(item_code):
		frappe.throw(
			_("{0} has already moved in stock, so serial tracking can't be turned on now.").format(item_code),
			title=_("Item Has Stock Movements"),
		)
	frappe.db.set_value("Item", item_code, "has_serial_no", 1)
	frappe.get_doc("Item", item_code).add_comment(
		"Comment", _("Serial tracking turned on by {0} (Track Serial Numbers): the item had never moved in stock.").format(frappe.session.user)
	)
	frappe.clear_document_cache("Item", item_code)
	return {"changed": True}
