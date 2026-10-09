import frappe


def execute():
	"""Warehouses are dynamic Custody Points now. Move every seal whose live custody
	pointer is an ERPNext Warehouse onto the Custody Point of the same name,
	creating (or re-activating) that Custody Point when needed — a location that
	physically holds seals is a live one. 'In Custody Since' is left as it was."""
	from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
		_custody_label,
	)

	seals = frappe.get_all(
		"Seal Device",
		filters={"current_custody_type": "Warehouse", "current_custodian": ["is", "set"]},
		fields=["name", "current_custodian"],
	)
	for name in sorted({s.current_custodian for s in seals}):
		if not frappe.db.exists("Custody Point", name):
			frappe.get_doc(
				{"doctype": "Custody Point", "custody_point_name": name, "is_main_warehouse": 0, "active": 1}
			).insert(ignore_permissions=True)
		elif not frappe.db.get_value("Custody Point", name, "active"):
			frappe.db.set_value("Custody Point", name, "active", 1)

	for s in seals:
		frappe.db.set_value(
			"Seal Device",
			s.name,
			{
				"current_custody_type": "Custody Point",
				"current_custody_label": _custody_label("Custody Point", s.current_custodian),
			},
			update_modified=False,
		)
