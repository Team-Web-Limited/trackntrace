"""Per-user switches on the User form.

Seal Manager as a role of its own, switched per user by the User form's
"Seal Manager" checkbox (custom_seal_manager).

Frappe gives a user one Role Profile and rebuilds their roles from it on every
save (User.populate_role_profile_roles), so a role added to a profiled user
alone is lost on the next save. The checkbox is kept on the User and this
validate hook, which runs after that rebuild, adds or removes the role, so it
works with or without a Role Profile."""

import frappe
from frappe.utils import cint

ROLE = "Seal Manager"
FIELD = "custom_seal_manager"

CUSTOM_FIELD = {
	"fieldname": FIELD,
	"fieldtype": "Check",
	"label": "Seal Manager",
	"insert_after": "role_profile_name",
	"default": "0",
	"description": "May transfer RECTs seals. Works alongside the Role Profile: ticking this grants the Seal Manager role, unticking removes it.",
}


def apply_seal_manager_flag(doc, method=None):
	"""User validate hook: make the Seal Manager role follow the checkbox."""
	if not doc.meta.has_field(FIELD) or not frappe.db.exists("Role", ROLE):
		return
	has = ROLE in [r.role for r in doc.roles]
	flag = cint(doc.get(FIELD))
	if doc.role_profile_name:
		# Roles were just rebuilt from the profile; the checkbox decides (a profile
		# that itself carries the role keeps it).
		want = flag or has
	elif doc.is_new():
		want = flag or has
	elif doc.has_value_changed(FIELD):
		want = flag
	else:
		# No profile and the checkbox untouched: an edit in the roles editor wins.
		want = has

	if want and not has:
		doc.append("roles", {"role": ROLE})
	elif not want and has:
		doc.set("roles", [r for r in doc.roles if r.role != ROLE])
	doc.set(FIELD, 1 if want else 0)


# Listed as PCB Team Leader: of the users with the PCB Team Leader role (which
# also carries permissions, and comes with some Role Profiles), only the ticked
# ones are offered when Finance approves a booking / changes the Team Leader.
TEAM_LEADER_FIELD = "custom_listed_pcb_team_leader"
TEAM_LEADER_CUSTOM_FIELD = {
	"fieldname": TEAM_LEADER_FIELD,
	"fieldtype": "Check",
	"label": "Listed as PCB Team Leader",
	"insert_after": FIELD,
	"default": "0",
	"description": "Offered as a PCB Team Leader when Finance approves a tagging booking. Needs the PCB Team Leader role. If nobody is ticked, every PCB Team Leader is offered.",
}
