"""Stamp every pre-existing Seal Billing Rate as the Local rate set.

Per-journey-type rates (see current_customers.JOURNEY_TYPE_BUCKETS) split a
customer's pricing into a Local rule and an Import/Export sibling. Every rule
that existed before that split was the customer's only rate set, which is
exactly what Local now means, so they all carry over as Local.

The field's own `default` only applies to newly inserted docs, leaving existing
rows with an empty journey_type — hence this backfill. Idempotent: re-running
only touches rows still missing a value.
"""

import frappe


def execute():
	if not frappe.db.has_column("Seal Billing Rate", "journey_type"):
		return

	frappe.db.sql(
		"""
		update `tabSeal Billing Rate`
		set journey_type = 'Local'
		where ifnull(journey_type, '') = ''
		"""
	)
