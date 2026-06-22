import frappe

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


def after_install():
	set_landing_page()


def after_migrate():
	set_landing_page()
