import frappe


def execute():
	"""Backfill the Customer Branch checkboxes from the old custom_division select
	(FMS Division / ECTS Division / Both = FMS + ECTS / RECTS Division)."""
	# Custom fields are fixtures, synced after patches run, so create them first.
	from frappe.utils.fixtures import sync_fixtures

	sync_fixtures("tnt_seal_management")
	frappe.clear_cache(doctype="Customer")
	if not frappe.db.has_column("Customer", "custom_division_ects"):
		return

	frappe.db.sql(
		"""
		update `tabCustomer`
		set custom_division_fms = custom_division in ('FMS Division', 'Both', ''),
			custom_division_ects = custom_division in ('ECTS Division', 'Both'),
			custom_division_rects = custom_division = 'RECTS Division',
			custom_division_all = 0
		"""
	)
