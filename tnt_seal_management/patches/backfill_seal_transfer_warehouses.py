import re

import frappe

# "<from> → <to> (<note>)", as _append_transfer_history writes a Seal Transfer row.
_REMARKS = re.compile(r"^(?P<src>.+?) → (?P<dst>.+?) \((?P<note>.*)\)$", re.S)
_PREFIX = "Warehouse: "


def execute():
	"""Fill Start Warehouse (from) and Return Warehouse (to) on existing "Seal
	Transfer" history rows from their remarks, where each end is a Warehouse
	(by name, or a "Warehouse: <name>" custody label)."""
	warehouses = set(frappe.get_all("Warehouse", pluck="name"))

	def as_warehouse(text):
		text = (text or "").strip()
		if text.startswith(_PREFIX):
			text = text[len(_PREFIX):]
		return text if text in warehouses else None

	rows = frappe.db.sql(
		"""select name, remarks from `tabSeal Status History`
		where entry_type = 'Seal Transfer'
			and ifnull(start_warehouse, '') = '' and ifnull(return_warehouse, '') = ''""",
		as_dict=True,
	)
	for row in rows:
		match = _REMARKS.match((row.remarks or "").strip())
		if not match:
			continue
		values = {"start_warehouse": as_warehouse(match["src"]), "return_warehouse": as_warehouse(match["dst"])}
		if any(values.values()):
			frappe.db.set_value("Seal Status History", row.name, values, update_modified=False)
