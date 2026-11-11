import frappe

from tnt_seal_management.tnt_seal_management.api.rects_billing import PERIOD_ITEMS


def execute():
	"""Items a RECTs prepaid period is billed on (RECTs-LEASING /
	RECTs-SUBSCRIPTION), kept apart from the PCB (ECTS) items. Group, UOM and
	income accounts are copied from the closest existing item."""
	for billing_type, (code, *templates) in PERIOD_ITEMS.items():
		if frappe.db.exists("Item", code):
			continue
		template = next((t for t in templates if frappe.db.exists("Item", t)), None)
		src = frappe.get_doc("Item", template) if template else None
		item = frappe.get_doc({
			"doctype": "Item",
			"item_code": code,
			"item_name": code,
			"description": f"RECTs prepaid {billing_type.lower()} period",
			"item_group": src.item_group if src else frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
			"stock_uom": src.stock_uom if src else "Nos",
			"is_stock_item": 0,
			"is_sales_item": 1,
			"is_purchase_item": 0,
			"include_item_in_manufacturing": 0,
			"item_defaults": [
				{"company": d.company, "income_account": d.income_account, "selling_cost_center": d.selling_cost_center}
				for d in (src.item_defaults if src else [])
				if frappe.db.exists("Company", d.company)
			],
		})
		item.flags.ignore_mandatory = True
		item.insert(ignore_permissions=True, set_name=code)
