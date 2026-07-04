# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import nowdate

from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	set_seal_custody,
)


class SealAcquisition(Document):
	def validate(self):
		self._set_totals()
		self._validate_required_rows()
		self._validate_duplicate_rows()

	def before_submit(self):
		self.acquisition_status = "Received"

	def on_submit(self):
		self._receive_seals()

	def on_cancel(self):
		self.db_set("acquisition_status", "Cancelled", update_modified=False)

	def _set_totals(self):
		self.total_seals = len([row for row in self.seals if row.seal_number])

	def _validate_required_rows(self):
		if not self.seals:
			frappe.throw(_("Add at least one seal to receive."))
		for row in self.seals:
			if not row.seal_number:
				frappe.throw(_("Seal Number is required on every acquisition row."))
			if not row.device_id:
				frappe.throw(_("Device ID is required for seal {0}.").format(row.seal_number))

	def _validate_duplicate_rows(self):
		seen = set()
		for row in self.seals:
			key = row.seal_number
			if key in seen:
				frappe.throw(_("Seal {0} appears more than once in this acquisition.").format(key))
			seen.add(key)

	def _receive_seals(self):
		for row in self.seals:
			seal_device = _upsert_seal_device(self, row)
			row.db_set("seal_device", seal_device, update_modified=False)
			set_seal_custody(
				seal_device,
				"Warehouse",
				self.target_warehouse,
				remarks=f"Received via Seal Acquisition {self.name}",
			)


def _upsert_seal_device(doc, row):
	existing = frappe.db.exists("Seal Device", {"seal_number": row.seal_number})
	values = {
		"seal_number": row.seal_number,
		"device_id": row.device_id,
		"imei_number": row.imei_number,
		"serial_number": row.serial_number,
		"seal_type": row.seal_type,
		"current_status": doc.default_status,
		"condition": "Good",
		"date_received": doc.received_date or nowdate(),
		"acquisition_reference": doc.name,
		"acquisition_supplier": doc.supplier,
		"acquisition_invoice_reference": doc.invoice_reference,
		"acquisition_cost": row.purchase_cost,
	}

	if existing:
		current = frappe.db.get_value(
			"Seal Device",
			existing,
			["current_journey", "current_status"],
			as_dict=True,
		)
		if current and current.current_journey:
			frappe.throw(
				_("Seal {0} is already linked to active journey {1}.").format(
					row.seal_number, current.current_journey
				)
			)
		frappe.db.set_value("Seal Device", existing, values)
		return existing

	seal = frappe.get_doc({"doctype": "Seal Device", **values})
	seal.insert(ignore_permissions=True)
	return seal.name
