import frappe


def execute():
	"""Leased seals are owned by the company: fill Owner on the existing ones."""
	if not frappe.db.has_column("Seal Device", "seal_owner"):
		return

	company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	if not company:
		return

	frappe.db.sql(
		"""
		update `tabSeal Device`
		set seal_owner = %s
		where ifnull(seal_category, 'Lease') != 'Outright Purchase'
		""",
		company,
	)
