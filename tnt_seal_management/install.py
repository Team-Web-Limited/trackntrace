import frappe

from tnt_seal_management.seed import seed_transport_locations
from tnt_seal_management.seed_guard import seeding_allowed

# The custom Page that renders the role-aware TNT landing cards
# (frappe/boot.py:add_home_page reads this default to decide the post-login route).
LANDING_PAGE = "tnt-seal-management"


def set_landing_page():
	"""Make the TNT cards page the post-login desk landing page.

	On Frappe v15 the desk falls back to the default workspace unless
	``desktop:home_page`` points at a valid Page. We pin it to the TNT
	landing page here so the v16 card experience is preserved.
	"""
	if not frappe.db.exists("Page", LANDING_PAGE):
		return
	if frappe.db.get_default("desktop:home_page") != LANDING_PAGE:
		frappe.db.set_default("desktop:home_page", LANDING_PAGE)


def _seed_dev_data():
	"""Seed masters only on a site that opted in — never on production.

	This used to run unconditionally on every install and every migrate, which
	meant each deploy injected the 58 built-in Transport Locations into live
	data. See tnt_seal_management.seed_guard.
	"""
	if not seeding_allowed():
		return
	seed_transport_locations()


def after_install():
	set_landing_page()
	_seed_dev_data()


def after_migrate():
	set_landing_page()
	_seed_dev_data()
