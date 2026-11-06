import frappe


def execute():
	"""Backfill the Warehouse Branch checkboxes from the old custom_division select
	(FMS Division / ECTS Division / Both = FMS + ECTS / RECTS Division)."""
	# Custom fields are fixtures, synced after patches run, so create them first.
	from frappe.utils.fixtures import sync_fixtures

	sync_fixtures("tnt_seal_management")
	frappe.clear_cache(doctype="Warehouse")
	if not frappe.db.has_column("Warehouse", "custom_division_ects"):
		return

	frappe.db.sql(
		"""
		update `tabWarehouse`
		set custom_division_fms = ifnull(custom_division, '') in ('FMS Division', 'Both', ''),
			custom_division_ects = ifnull(custom_division, '') in ('ECTS Division', 'Both'),
			custom_division_rects = ifnull(custom_division, '') = 'RECTS Division',
			custom_division_all = 0
		"""
	)
