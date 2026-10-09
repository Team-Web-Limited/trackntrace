import frappe

NAME = "Stores - TD"


def execute():
	"""Warehouses are becoming dynamic Custody Points; only the main store is
	predefined. Create it (flagged main unless another main already exists)."""
	if frappe.db.exists("Custody Point", NAME):
		return
	has_main = frappe.db.exists("Custody Point", {"is_main_warehouse": 1, "active": 1})
	frappe.get_doc(
		{
			"doctype": "Custody Point",
			"custody_point_name": NAME,
			"is_main_warehouse": 0 if has_main else 1,
			"active": 1,
		}
	).insert(ignore_permissions=True)
