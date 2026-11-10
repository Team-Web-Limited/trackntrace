import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from tnt_seal_management.tnt_seal_management.api.rects_billing import RECTS_RULE_CUSTOM_FIELD


def execute():
	"""Customer "RECTs Prepay Rate": the RECTs price of a customer on both ECTS
	and RECTS. Fixtures sync after patches, so the field is created here."""
	create_custom_field("Customer", RECTS_RULE_CUSTOM_FIELD)
	frappe.clear_cache(doctype="Customer")
