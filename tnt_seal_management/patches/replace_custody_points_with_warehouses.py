import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from tnt_seal_management.tnt_seal_management.api.seal_warehouses import (
	BOTH_DIVISIONS,
	ECTS_DIVISION,
	SEAL_DIVISIONS,
)

FMS_DIVISION = "FMS Division"

# Seal-management fields on ERPNext Warehouse. Also shipped as fixtures; created
# here because fixtures sync after patches and the data move below needs them.
WAREHOUSE_SEAL_FIELDS = {
	"Warehouse": [
		{
			"fieldname": "custom_seal_management_section",
			"fieldtype": "Section Break",
			"label": "Seal Management",
			"insert_after": "default_in_transit_warehouse",
			"depends_on": f"eval:{list(SEAL_DIVISIONS)!r}.includes(doc.custom_division)",
			"collapsible": 1,
		},
		{
			"fieldname": "custom_is_main_seal_store",
			"fieldtype": "Check",
			"label": "Main Seal Store",
			"insert_after": "custom_seal_management_section",
			"description": "Where returned seals go by default.",
		},
		{
			"fieldname": "custom_seal_column",
			"fieldtype": "Column Break",
			"insert_after": "custom_is_main_seal_store",
		},
		{
			"fieldname": "custom_seal_latitude",
			"fieldtype": "Float",
			"label": "Latitude",
			"precision": "6",
			"insert_after": "custom_seal_column",
		},
		{
			"fieldname": "custom_seal_longitude",
			"fieldtype": "Float",
			"label": "Longitude",
			"precision": "6",
			"insert_after": "custom_seal_latitude",
		},
		{
			"fieldname": "custom_seal_geofence_radius",
			"fieldtype": "Float",
			"label": "Geofence Radius (m)",
			"default": "300",
			"insert_after": "custom_seal_longitude",
			"description": "An idle seal whose GPS falls within this radius is recorded as held here.",
		},
	]
}


def execute():
	"""Retire Custody Point: seal warehouses are ERPNext Warehouses whose Branch
	is ECTS Division or Both.

	Every Custody Point maps to the Warehouse of the same name. Its GPS, radius
	and main-store flag move onto that Warehouse. A point that is active, or that
	still holds seals, stays a seal warehouse: a blank Branch becomes ECTS
	Division and FMS Division becomes Both (e.g. the main store, Stores - TD).
	Seals, custody transfers and Journey Request return warehouses that pointed
	at the Custody Point now point at the Warehouse.
	Anything with no Warehouse of that name is cleared and logged. The Custody
	Point doctype is then deleted."""
	create_custom_fields(WAREHOUSE_SEAL_FIELDS, update=True)
	if not frappe.db.table_exists("Custody Point"):
		return

	points = frappe.db.sql(
		"""select name, active, is_main_warehouse, latitude, longitude, geofence_radius_meters
		from `tabCustody Point`""",
		as_dict=True,
	)
	held = set(
		frappe.get_all(
			"Seal Device", filters={"current_custody_type": "Custody Point"}, pluck="current_custodian"
		)
	)
	unmatched = []
	for p in points:
		branch = frappe.db.get_value("Warehouse", p.name, "custom_division")
		if branch is None and not frappe.db.exists("Warehouse", p.name):
			unmatched.append(p.name)
			continue
		values = {
			"custom_is_main_seal_store": 1 if (p.is_main_warehouse and p.active) else 0,
			"custom_seal_geofence_radius": p.geofence_radius_meters or 300,
		}
		if p.latitude or p.longitude:
			values.update(custom_seal_latitude=p.latitude, custom_seal_longitude=p.longitude)
		if p.active or p.name in held:
			if not branch:
				values["custom_division"] = ECTS_DIVISION
			elif branch == FMS_DIVISION:
				values["custom_division"] = BOTH_DIVISIONS
		frappe.db.set_value("Warehouse", p.name, values, update_modified=False)

	from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import _custody_label

	for seal in frappe.get_all(
		"Seal Device", filters={"current_custody_type": "Custody Point"}, fields=["name", "current_custodian"]
	):
		if seal.current_custodian in unmatched or not seal.current_custodian:
			values = {"current_custody_type": None, "current_custodian": None, "current_custody_label": None}
		else:
			values = {
				"current_custody_type": "Warehouse",
				"current_custody_label": _custody_label("Warehouse", seal.current_custodian),
			}
		frappe.db.set_value("Seal Device", seal.name, values, update_modified=False)

	if frappe.db.table_exists("Seal Custody Transfer"):
		frappe.db.sql(
			"update `tabSeal Custody Transfer` set to_custody_type = 'Warehouse' where to_custody_type = 'Custody Point'"
		)
		frappe.db.sql(
			"""update `tabSeal Custody Transfer Item` set from_custody_type = 'Warehouse'
			where from_custody_type = 'Custody Point'"""
		)

	for doctype in ("Journey Request", "Journey Request Vehicle"):
		if unmatched:
			frappe.db.sql(
				f"update `tab{doctype}` set return_warehouse = null where return_warehouse in %(names)s",
				{"names": tuple(unmatched)},
			)

	if unmatched:
		frappe.log_error(
			title="Custody Point retirement",
			message="No Warehouse of the same name, so seals and return warehouses pointing here were cleared: "
			+ ", ".join(unmatched),
		)

	frappe.delete_doc("DocType", "Custody Point", ignore_missing=True, force=True)
