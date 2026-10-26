import frappe


def execute():
	"""Belongs To (TNT / RECTs) was introduced with TNT as the default: every
	existing seal without one belongs to TNT."""
	frappe.db.sql(
		"""update `tabSeal Device` set belongs_to = 'TNT'
		where ifnull(belongs_to, '') = ''"""
	)
