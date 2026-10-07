import frappe


def execute():
	"""Every customer belongs to the FMS Division by default — new customers get it
	from the Customer-custom_division field default (fixtures/custom_field.json);
	this backfills the existing ones that have no division yet. Customers already
	set to a division keep it."""
	if not frappe.db.has_column("Customer", "custom_division"):
		return

	frappe.db.sql(
		"""
		update `tabCustomer`
		set custom_division = 'FMS Division'
		where ifnull(custom_division, '') = ''
		"""
	)
