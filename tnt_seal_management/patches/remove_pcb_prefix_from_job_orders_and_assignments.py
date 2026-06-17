import frappe
from frappe.model.rename_doc import rename_doc


def execute():
	_rename_docs("PCB Job Order", "PCB-JO-", "JO-")
	_rename_docs("PCB Assignment", "PCB-ASG-", "ASG-")


def _rename_docs(doctype, old_prefix, new_prefix):
	for current_name in frappe.get_all(doctype, filters={"name": ["like", f"{old_prefix}%"]}, pluck="name"):
		new_name = current_name.replace(old_prefix, new_prefix, 1)
		if current_name == new_name or frappe.db.exists(doctype, new_name):
			continue
		rename_doc(doctype, current_name, new_name, force=True, merge=False)
