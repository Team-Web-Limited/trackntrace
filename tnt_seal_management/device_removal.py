# Device removal on an Issue: bring removed devices back into stock.
#
# When a field technician (TO) uninstalls a tracker from a customer's vehicle,
# the device's Serial No must stop showing "Delivered" to the customer and show
# that it went to the technician. ERPNext's own way to record that is a Sales
# Return (a return Delivery Note) against the Delivery Note that installed the
# device. From the technician's warehouse it then moves on with a normal
# Material Transfer, and a reinstall is a new Delivery Note. The Serial No
# Ledger shows every hop.
#
# The return is made at rate 0: the customer is not refunded for a removal, so
# it must not count as a sales return or show up as something to credit. The
# stock value still comes back at the original cost (ERPNext takes the
# incoming rate from the original delivery), so stock and COGS stay right.
#
# Issue fields (fixtures): custom_return_warehouse, custom_removed_devices
# (Issue Removed Device rows), custom_no_device_recovered / _reason.

import frappe
from frappe import _
from frappe.utils import cint

DEVICE_REMOVAL = "Device removal"
CLOSED_STATUSES = ("Resolved", "Closed")


def _is_device_removal(doc):
	return doc.issue_type == DEVICE_REMOVAL


def find_installing_delivery_note(serial_no):
	"""The latest submitted, non-return Delivery Note line that delivered this serial.

	Returns (delivery_note, dn_detail) or (None, None).
	"""
	# Serial and Batch Bundle era (ERPNext v15).
	row = frappe.db.sql(
		"""
		select b.voucher_no, b.voucher_detail_no
		from `tabSerial and Batch Entry` e
		join `tabSerial and Batch Bundle` b on b.name = e.parent
		join `tabDelivery Note` dn on dn.name = b.voucher_no
		where e.serial_no = %s
			and b.voucher_type = 'Delivery Note'
			and b.type_of_transaction = 'Outward'
			and b.is_cancelled = 0 and b.docstatus = 1
			and dn.docstatus = 1 and dn.is_return = 0
		order by b.posting_date desc, b.posting_time desc, b.creation desc
		limit 1
		""",
		serial_no,
	)
	if row:
		return row[0]

	# Older deliveries kept serials in the item's serial_no text field.
	for dn, detail, serials in frappe.db.sql(
		"""
		select dn.name, i.name, i.serial_no
		from `tabDelivery Note Item` i
		join `tabDelivery Note` dn on dn.name = i.parent
		where dn.docstatus = 1 and dn.is_return = 0 and i.serial_no like %s
		order by dn.posting_date desc, dn.posting_time desc, dn.creation desc
		""",
		f"%{serial_no}%",
	):
		if serial_no in (s.strip() for s in (serials or "").splitlines()):
			return dn, detail

	return None, None


def _check_device(doc, row):
	"""A device still to be returned must be delivered to this Issue's customer."""
	serial = frappe.db.get_value("Serial No", row.serial_no, ["status", "customer", "warehouse"], as_dict=True)
	if not serial:
		frappe.throw(_("Row {0}: Serial No {1} does not exist.").format(row.idx, frappe.bold(row.serial_no)))

	if serial.status != "Delivered":
		where = _(" in warehouse {0}").format(frappe.bold(serial.warehouse)) if serial.warehouse else ""
		frappe.throw(
			_("Row {0}: {1} is not with a customer (status {2}{3}), so there is nothing to return.").format(
				row.idx, frappe.bold(row.serial_no), serial.status, where
			),
			title=_("Device Not Installed"),
		)

	if doc.customer and serial.customer and serial.customer != doc.customer:
		frappe.throw(
			_("Row {0}: {1} was delivered to {2}, not to this Issue's customer {3}.").format(
				row.idx, frappe.bold(row.serial_no), frappe.bold(serial.customer), frappe.bold(doc.customer)
			),
			title=_("Wrong Customer"),
		)


def validate_issue(doc, method=None):
	"""doc_events Issue.validate"""
	if not _is_device_removal(doc):
		return

	seen = set()
	for row in doc.get("custom_removed_devices") or []:
		if row.serial_no in seen:
			frappe.throw(_("Row {0}: {1} is listed twice.").format(row.idx, frappe.bold(row.serial_no)))
		seen.add(row.serial_no)

		if row.return_delivery_note:
			continue

		_check_device(doc, row)
		row.installed_under = find_installing_delivery_note(row.serial_no)[0]
		if not row.installed_under:
			frappe.throw(
				_("Row {0}: no Delivery Note found that installed {1}, so it can't be returned against one.").format(
					row.idx, frappe.bold(row.serial_no)
				),
				title=_("Installation Not Found"),
			)

	if doc.status not in CLOSED_STATUSES or cint(doc.custom_no_device_recovered):
		return
	# Only when the Issue is being closed: an Issue closed before this existed
	# must still save so devices can be added and returned on it.
	if not (doc.is_new() or doc.has_value_changed("status")):
		return

	rows = doc.get("custom_removed_devices") or []
	if not rows:
		frappe.throw(
			_(
				"Add the removed device(s) under Removed Devices and return them to the field technician, "
				"or tick No Device Recovered, before setting this Issue to {0}."
			).format(doc.status),
			title=_("Devices Not Recorded"),
		)

	pending = [r.serial_no for r in rows if not r.return_delivery_note]
	if pending:
		frappe.throw(
			_(
				"These devices have not been returned to the field technician yet: {0}.<br>"
				"Click <b>Return Devices to Technician</b> first, then set the Issue to {1}."
			).format(", ".join(frappe.bold(s) for s in pending), doc.status),
			title=_("Devices Not Returned"),
		)


def _build_return(issue, delivery_note, rows, warehouse):
	from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_return

	ret = make_sales_return(delivery_note)

	serials_by_detail = {}
	for row in rows:
		serials_by_detail.setdefault(row._dn_detail, []).append(row.serial_no)

	items = []
	for item in ret.items:
		serials = serials_by_detail.get(item.dn_detail)
		if not serials:
			continue
		item.warehouse = warehouse
		item.use_serial_batch_fields = 1
		item.serial_and_batch_bundle = None
		item.batch_no = None
		item.serial_no = "\n".join(serials)
		item.qty = -len(serials)
		item.stock_qty = item.qty * (item.conversion_factor or 1)
		# Removal, not a refund: no sales value on the return.
		for field in ("price_list_rate", "rate", "discount_percentage", "discount_amount", "margin_rate_or_amount"):
			if item.meta.has_field(field):
				item.set(field, 0)
		items.append(item)

	if not items:
		frappe.throw(_("Could not match the devices to the lines of {0}.").format(delivery_note))

	ret.set("items", items)
	for idx, item in enumerate(ret.items, 1):
		item.idx = idx
	ret.set_warehouse = warehouse
	ret.ignore_pricing_rule = 1
	ret.additional_discount_percentage = 0
	ret.discount_amount = 0
	ret.posting_date = frappe.utils.nowdate()
	ret.posting_time = frappe.utils.nowtime()
	ret.set_posting_time = 1
	ret.remarks = _("Device removal returned to field technician. Issue {0}.").format(issue.name)
	# Mandatory custom field on this site's Delivery Note; for a removal the
	# Issue is the job.
	if ret.meta.has_field("custom_job_card_no"):
		ret.custom_job_card_no = issue.name
	# Also mandatory on prod: the vehicle the device came off.
	ret.vehicle_no = issue.get("vehicle") or ret.get("vehicle_no")
	return ret


@frappe.whitelist()
def return_devices(issue):
	"""Create and submit return Delivery Notes for the Issue's removed devices."""
	doc = frappe.get_doc("Issue", issue)
	doc.check_permission("write")

	if not _is_device_removal(doc):
		frappe.throw(_("Only Device removal Issues can return devices."))
	if not doc.custom_return_warehouse:
		frappe.throw(_("Set the Field Technician Warehouse first."), title=_("Missing Warehouse"))
	if frappe.db.get_value("Warehouse", doc.custom_return_warehouse, "is_group"):
		frappe.throw(_("{0} is a group warehouse. Pick the technician's own warehouse.").format(doc.custom_return_warehouse))

	pending = [r for r in doc.get("custom_removed_devices") or [] if not r.return_delivery_note]
	if not pending:
		frappe.throw(_("All listed devices have already been returned."))

	by_dn = {}
	for row in pending:
		_check_device(doc, row)
		dn, detail = find_installing_delivery_note(row.serial_no)
		if not dn:
			frappe.throw(_("Row {0}: no Delivery Note found that installed {1}.").format(row.idx, frappe.bold(row.serial_no)))
		row._dn_detail = detail
		row.installed_under = dn
		by_dn.setdefault(dn, []).append(row)

	created = []
	for dn, rows in by_dn.items():
		ret = _build_return(doc, dn, rows, doc.custom_return_warehouse)
		# Field technicians usually can't create Delivery Notes. This path is
		# safe to elevate: it only returns serials that are delivered to this
		# Issue's customer, at rate 0, into the warehouse named on the Issue.
		ret.flags.ignore_permissions = True
		ret.insert()
		ret.submit()
		for row in rows:
			row.return_delivery_note = ret.name
		created.append(ret.name)

	doc.flags.ignore_permissions = True
	doc.save()
	return created
