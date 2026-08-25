import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.query_builder import DocType

TAX_CATEGORY_NORMAL = "Normal Tax (16% VAT)"


def execute():
	create_custom_fields(
		{
			"Customer": [
				{
					"fieldname": "custom_tax_category",
					"label": "VAT Tax Category",
					"fieldtype": "Select",
					"options": "Normal Tax (16% VAT)\nTax Exempt\nZero Rated",
					"default": TAX_CATEGORY_NORMAL,
					"insert_after": "tax_category",
					"description": "Drives VAT on Completed Journeys billing. Distinct from the standard Tax Category field, which is ERPNext's separate Sales Taxes/Tax Rule mechanism.",
				}
			]
		},
		update=True,
	)

	# Query builder (not frappe.db.sql with %-style params) — a literal "%" in
	# a bound value confuses pymysql's %-substitution and doubles it up.
	Customer = DocType("Customer")
	frappe.qb.update(Customer).set(Customer.custom_tax_category, TAX_CATEGORY_NORMAL).where(
		Customer.custom_tax_category.isnull() | (Customer.custom_tax_category == "")
	).run()

	frappe.clear_cache(doctype="Customer")
