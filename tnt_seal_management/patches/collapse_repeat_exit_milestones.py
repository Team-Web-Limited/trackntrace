import frappe

from tnt_seal_management.tnt_seal_management.api.journey_milestones import collapse_repeat_exits


def execute():
	"""Fold geofence-edge bounce exits recorded before collapsing existed."""
	journeys = frappe.db.sql_list(
		"""select distinct parent from `tabSeal Journey Milestone`
		where parenttype = 'Seal Journey' and event_type in ('Exited', 'Departed')"""
	)
	for journey in journeys:
		collapse_repeat_exits(journey)
