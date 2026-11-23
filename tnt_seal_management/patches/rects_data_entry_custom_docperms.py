import frappe

ROLE = "RECTs Data Entry"
PERM_FIELDS = (
	"permlevel", "if_owner", "select", "read", "write", "create", "delete", "submit",
	"cancel", "amend", "report", "export", "import", "share", "print", "email",
)


def execute():
	"""Once a doctype has Custom DocPerm rows (Role Permission Manager), Frappe
	ignores its standard DocPerms. Journey Request, Seal Device and Vehicle have
	such rows on prod, so the RECTs Data Entry rights shipped in their JSON
	never applied. Copy the role's standard rows into Custom DocPerm wherever a
	doctype has custom rows but lacks the role."""
	for perm in frappe.get_all("DocPerm", filters={"role": ROLE}, fields=["parent", *PERM_FIELDS]):
		doctype = perm.pop("parent")
		if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
			continue  # standard DocPerms apply
		if frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": ROLE, "permlevel": perm.permlevel}):
			continue
		frappe.get_doc(
			{"doctype": "Custom DocPerm", "parent": doctype, "parenttype": "DocType", "parentfield": "permissions", "role": ROLE, **perm}
		).insert(ignore_permissions=True)
	frappe.clear_cache()
