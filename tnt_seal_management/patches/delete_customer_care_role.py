import frappe

ROLE = "Customer Care"


def execute():
	"""Customer Care approval has been removed from the sea journey workflow —
	Field Technicians now start the journey themselves via complete_tagging
	(Seal Journey goes straight to In Transit). The role has no remaining
	purpose in the app, so drop it and any Has Role assignments with it."""
	# Drop the role assignment rows first (User, Role Profile, Page "roles" child
	# tables all reuse the "Has Role" doctype) — force-deleting the Role below
	# does not cascade into these, and would otherwise leave orphaned rows
	# pointing at a Role that no longer exists.
	users = frappe.db.get_all("Has Role", filters={"role": ROLE}, pluck="parent", distinct=True)
	frappe.db.delete("Has Role", {"role": ROLE})
	for user in users:
		frappe.clear_cache(user=user)

	if not frappe.db.exists("Role", ROLE):
		return

	frappe.delete_doc(
		"Role",
		ROLE,
		force=True,
		ignore_permissions=True,
		ignore_missing=True,
	)
	frappe.db.commit()
