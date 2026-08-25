import frappe

from tnt_seal_management.seed_guard import seeding_allowed
from tnt_seal_management.tnt_seal_management.api.current_customers import (
	ensure_seed_current_customers,
)


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	ensure_seed_current_customers()
	frappe.db.commit()
