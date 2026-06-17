import frappe

from tnt_seal_management.tnt_seal_management.api.current_customers import (
	ensure_seed_current_customers,
)


def execute():
	ensure_seed_current_customers()
	frappe.db.commit()
