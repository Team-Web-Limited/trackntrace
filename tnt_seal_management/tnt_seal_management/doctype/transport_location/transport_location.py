# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class TransportLocation(Document):
	def on_update(self):
		"""Keep the geofence's back-reference list in step when the link changes."""
		from tnt_seal_management.tnt_seal_management.api.geofence_sync import (
			refresh_geofence_backlinks,
		)

		before = self.get_doc_before_save()
		touched = {self.uffizio_geofence, before.uffizio_geofence if before else None} - {None, ""}
		if touched:
			refresh_geofence_backlinks(list(touched))
