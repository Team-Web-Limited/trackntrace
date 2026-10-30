import frappe
from frappe.utils import cint

BRANCH_FIELDS = ("custom_division_fms", "custom_division_ects", "custom_division_rects")


def normalize_branches(doc, method=None):
	"""Customer validate: "All" ticks every branch, and a customer that has every
	branch ticked is flagged "All" (unticking any branch clears it)."""
	if cint(doc.custom_division_all) and not all(cint(doc.get(f)) for f in BRANCH_FIELDS):
		previous = doc.get_doc_before_save()
		# "All" was just ticked -> tick the rest; otherwise a branch was unticked -> drop "All".
		if not previous or not cint(previous.get("custom_division_all")):
			for f in BRANCH_FIELDS:
				doc.set(f, 1)
		else:
			doc.custom_division_all = 0
	doc.custom_division_all = int(all(cint(doc.get(f)) for f in BRANCH_FIELDS))


def customer_filters(*branches):
	"""Filters matching customers ticked for any of ``branches`` (``custom_division_<x>`` suffixes)."""
	return [[f"custom_division_{b}", "=", 1] for b in branches]
