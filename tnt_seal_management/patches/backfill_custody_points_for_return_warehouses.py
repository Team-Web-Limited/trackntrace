import frappe


def execute():
	"""Journey Request / Journey Request Vehicle `return_warehouse` now links to
	Custody Point instead of ERPNext Warehouse. Historical rows hold Warehouse
	names, which would fail link validation on save. Create an inactive Custody
	Point of the same name for each (inactive keeps them out of the pickers, since
	warehouses are now dynamic Custody Points), so old records stay valid."""
	names = set()
	for doctype in ("Journey Request", "Journey Request Vehicle"):
		names.update(
			frappe.get_all(
				doctype,
				filters={"return_warehouse": ["is", "set"]},
				pluck="return_warehouse",
				distinct=True,
			)
		)
	for name in sorted(names):
		if frappe.db.exists("Custody Point", name):
			continue
		frappe.get_doc(
			{"doctype": "Custody Point", "custody_point_name": name, "is_main_warehouse": 0, "active": 0}
		).insert(ignore_permissions=True)
