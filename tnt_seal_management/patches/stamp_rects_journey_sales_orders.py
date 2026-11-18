import frappe


def execute():
	"""Stamp existing journey-billed RECTs Sales Orders as "RECTs Billing" so the
	Sales Order list colours them. Leaves orders that already have a type alone."""
	names = frappe.db.sql_list(
		"""
		SELECT DISTINCT sj.sales_order_reference
		FROM `tabSeal Journey` sj
		JOIN `tabSales Order` so ON so.name = sj.sales_order_reference
		WHERE sj.system = 'RECTs' AND IFNULL(sj.sales_order_reference, '') != ''
			AND IFNULL(so.custom_rects_order_type, '') = ''
		"""
	)
	for name in names:
		frappe.db.set_value("Sales Order", name, "custom_rects_order_type", "RECTs Billing", update_modified=False)
