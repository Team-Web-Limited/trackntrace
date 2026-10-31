import frappe


def execute():
	"""RECTs seals aren't in Uffizio, but the sync flagged them in_uffizio = 0 and
	hid them from every list and count. Show them again, then create the Seal
	Devices for purchase receipts submitted before their warehouse had a Division."""
	frappe.db.sql(
		"""update `tabSeal Device` set in_uffizio = 1, removed_from_uffizio_on = null
		where belongs_to = 'RECTs' and ifnull(in_uffizio, 1) = 0"""
	)

	from tnt_seal_management.tnt_seal_management.api.stock_seal_transfers import (
		create_seals_from_purchase_receipt,
	)

	for name in ("MAT-PRE-2026-00101",):
		if frappe.db.get_value("Purchase Receipt", name, "docstatus") == 1:
			# Skips serials that already have a Seal Device.
			create_seals_from_purchase_receipt(frappe.get_doc("Purchase Receipt", name))
