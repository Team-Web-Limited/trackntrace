# Print formats show a Link's title instead of its name when the target doctype
# has "Show Title in Link Fields" on (Vehicle does: registration_number). Frappe
# stores the looked-up title as-is, so a link whose record is missing — or has a
# blank title — prints the literal "None". Fall back to the stored value instead.

import frappe.www.printview as printview

_original = printview.set_title_values_for_link_and_dynamic_link_fields


def _set_title_values_with_fallback(meta, doc, parent_doc=None):
	_original(meta, doc, parent_doc)
	titles = (parent_doc or doc).get("__link_titles") if (parent_doc or doc) else None
	if not titles:
		return
	for key, title in titles.items():
		if title in (None, ""):
			titles[key] = key.split("::", 1)[1]


def apply():
	"""Idempotent; run before each request and background job."""
	if printview.set_title_values_for_link_and_dynamic_link_fields is not _set_title_values_with_fallback:
		printview.set_title_values_for_link_and_dynamic_link_fields = _set_title_values_with_fallback
