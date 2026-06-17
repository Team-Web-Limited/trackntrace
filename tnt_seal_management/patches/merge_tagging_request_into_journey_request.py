"""Merge Tagging Request into Journey Request.

Tagging Request was a thin Control Room duplicate of the tagging data now held
directly on Journey Request. This patch removes the obsolete DocType (and its
table) once the new flow is in place. The associated `tagging_request_reference`
field on Seal Journey is dropped by the schema sync.
"""

import frappe


def execute():
	if frappe.db.exists("DocType", "Tagging Request"):
		frappe.delete_doc("DocType", "Tagging Request", force=True, ignore_missing=True)
		frappe.db.commit()
