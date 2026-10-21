import frappe


def execute():
	"""Seal Category was introduced with Lease as the default: every existing
	seal without one is a leased seal."""
	frappe.db.sql(
		"""update `tabSeal Device` set seal_category = 'Lease'
		where ifnull(seal_category, '') = ''"""
	)
