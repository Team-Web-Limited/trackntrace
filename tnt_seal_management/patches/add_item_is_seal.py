import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# Also shipped as a fixture; created here so the data step below can use it
# (fixtures sync after patches).
ITEM_IS_SEAL = {
	"Item": [
		{
			"fieldname": "custom_is_seal",
			"fieldtype": "Check",
			"label": "Is Seal",
			"insert_after": "is_stock_item",
			"in_standard_filter": 1,
			"description": "Seal items are listed first in the seal Transfer dialog's Item Code.",
		}
	]
}


def execute():
	"""Add Item "Is Seal" and tick it on every item a Seal Device's serial uses."""
	create_custom_fields(ITEM_IS_SEAL, update=True)
	items = frappe.db.sql_list(
		"""
		select distinct sn.item_code
		from `tabSerial No` sn
		join `tabSeal Device` sd on sn.name in (sd.name, sd.serial_number, sd.imei_number)
		where ifnull(sn.item_code, '') != ''
		"""
	)
	if items:
		frappe.db.sql(
			"update `tabItem` set custom_is_seal = 1 where name in %(items)s", {"items": tuple(items)}
		)
