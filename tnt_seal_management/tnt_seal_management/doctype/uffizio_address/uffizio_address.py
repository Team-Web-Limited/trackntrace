# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class UffizioAddress(Document):
	def on_update(self):
		"""Linking (or re-linking) an address back-fills the milestones already
		recorded for it, so earlier visits show the Transport Location too."""
		from tnt_seal_management.tnt_seal_management.api.journey_milestones import (
			backfill_milestones_for_address,
		)

		backfill_milestones_for_address(self.name, self.transport_location)


@frappe.whitelist()
def create_transport_location(address, location_role, country, location_type):
	"""Create a Transport Location named after this Uffizio address and link it."""
	if not frappe.has_permission("Transport Location", "create"):
		frappe.throw(_("You are not permitted to create Transport Locations."), frappe.PermissionError)
	doc = frappe.get_doc("Uffizio Address", address)
	if doc.transport_location:
		return doc.transport_location
	name = (doc.address_name or "").strip()
	if not name:
		frappe.throw(_("This address has no name."))
	if not frappe.db.exists("Transport Location", name):
		frappe.get_doc(
			{
				"doctype": "Transport Location",
				"location_name": name,
				"location_role": location_role,
				"country": country,
				"location_type": location_type,
				"is_active": 1,
			}
		).insert()
	doc.transport_location = name
	doc.save()
	return name
