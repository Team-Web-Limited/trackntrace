import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from tnt_seal_management.tnt_seal_management.api.user_flags import (
	CUSTOM_FIELD,
	FIELD,
	ROLE,
	TEAM_LEADER_CUSTOM_FIELD,
	TEAM_LEADER_FIELD,
)

PROFILE = "PCB Lead Technician"
# Only these users may transfer RECTs seals.
SEAL_MANAGERS = (
	"cmalusi@trackntrace.co.ke",
	"awanjiru@trackntrace.co.ke",
	"gogera@trackntrace.co.ke",
	"michael@teamweb.africa",
)
# Only these are offered as PCB Team Leader when Finance approves a booking.
LISTED_TEAM_LEADERS = ("ekituyi@trackntrace.co.ke", "cmalusi@trackntrace.co.ke")


def execute():
	"""User form switches: "Seal Manager" (grants / removes the role, even with a
	Role Profile) and "Listed as PCB Team Leader". Fixtures sync after patches,
	so the fields are created here."""
	create_custom_field("User", CUSTOM_FIELD)
	create_custom_field("User", TEAM_LEADER_CUSTOM_FIELD)
	frappe.clear_cache(doctype="User")

	if frappe.db.exists("Role", ROLE):
		# Seal Manager is per user, never through the PCB Lead Technician profile.
		if frappe.db.exists("Role Profile", PROFILE):
			profile = frappe.get_doc("Role Profile", PROFILE)
			if ROLE in [r.role for r in profile.roles]:
				profile.set("roles", [r for r in profile.roles if r.role != ROLE])
				profile.flags.ignore_permissions = True
				profile.save()
				profile.update_all_users()

		holders = set(frappe.get_all("Has Role", filters={"role": ROLE, "parenttype": "User"}, pluck="parent"))
		for name in holders | set(SEAL_MANAGERS):
			if name in ("Administrator", "Guest") or not frappe.db.exists("User", name):
				continue
			user = frappe.get_doc("User", name)
			keep = name in SEAL_MANAGERS
			user.set(FIELD, 1 if keep else 0)
			if not keep:
				user.set("roles", [r for r in user.roles if r.role != ROLE])
			user.flags.ignore_permissions = True
			user.save()

	for name in LISTED_TEAM_LEADERS:
		if frappe.db.exists("User", name):
			frappe.db.set_value("User", name, TEAM_LEADER_FIELD, 1, update_modified=False)
