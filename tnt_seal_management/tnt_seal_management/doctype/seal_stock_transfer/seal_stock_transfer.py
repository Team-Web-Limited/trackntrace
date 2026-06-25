# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime, nowdate

from tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device import (
	set_seal_custody,
)


RESTING_STATUSES = {"Available", "Returned", "Quality Check", "Untagged"}


class SealStockTransfer(Document):
	def validate(self):
		self._set_totals()
		self._validate_header()
		self._validate_duplicate_rows()
		if self.docstatus == 0:
			self._validate_transferable_seals()

	def before_submit(self):
		self.transfer_status = "In Transit"
		self.sent_by = self.sent_by or frappe.session.user
		self.transfer_date = self.transfer_date or nowdate()

	def on_submit(self):
		self._log_dispatch()

	def before_cancel(self):
		if self.transfer_status == "Received":
			frappe.throw(_("Received transfers cannot be cancelled."))

	def on_cancel(self):
		self.db_set("transfer_status", "Cancelled", update_modified=False)

	def _set_totals(self):
		self.total_seals = len([row for row in self.seals if row.seal_device])

	def _validate_header(self):
		if not self.seals:
			frappe.throw(_("Add at least one seal to transfer."))
		if self.source_warehouse == self.target_warehouse:
			frappe.throw(_("Source and target warehouses must be different."))

	def _validate_duplicate_rows(self):
		seen = set()
		for row in self.seals:
			if not row.seal_device:
				frappe.throw(_("Seal Device is required on every transfer row."))
			if row.seal_device in seen:
				frappe.throw(_("Seal {0} appears more than once in this transfer.").format(row.seal_device))
			seen.add(row.seal_device)

	def _validate_transferable_seals(self):
		for row in self.seals:
			_validate_transferable_seal(row.seal_device, self.source_warehouse)

	def _log_dispatch(self):
		for row in self.seals:
			_append_inventory_note(
				row.seal_device,
				f"Dispatched from {self.source_warehouse} to {self.target_warehouse}",
				f"Seal Stock Transfer {self.name}",
			)


def _validate_transferable_seal(seal_device, source_warehouse):
	seal = frappe.db.get_value(
		"Seal Device",
		seal_device,
		[
			"current_status",
			"current_journey",
			"current_custody_type",
			"current_custodian",
		],
		as_dict=True,
	)
	if not seal:
		frappe.throw(_("Seal Device {0} does not exist.").format(seal_device))
	if seal.current_journey:
		frappe.throw(_("Seal {0} is linked to active journey {1}.").format(seal_device, seal.current_journey))
	if seal.current_status not in RESTING_STATUSES:
		frappe.throw(
			_("Seal {0} has status {1}; only resting seals can be transferred.").format(
				seal_device, seal.current_status
			)
		)
	if seal.current_custody_type and seal.current_custody_type != "Custody Point":
		frappe.throw(_("Seal {0} is not currently in warehouse custody.").format(seal_device))
	if seal.current_custodian and seal.current_custodian != source_warehouse:
		frappe.throw(
			_("Seal {0} is currently at {1}, not {2}.").format(
				seal_device, seal.current_custodian, source_warehouse
			)
		)


def _append_inventory_note(seal_device, new_status, remarks):
	seal = frappe.get_doc("Seal Device", seal_device)
	seal.append(
		"status_history",
		{
			"seal": seal_device,
			"previous_status": seal.current_custody_label or seal.current_status,
			"new_status": new_status,
			"status_date_time": now_datetime(),
			"updated_by": frappe.session.user,
			"remarks": remarks,
		},
	)
	seal.save(ignore_permissions=True)


@frappe.whitelist()
def receive_transfer(docname):
	doc = frappe.get_doc("Seal Stock Transfer", docname)
	doc.check_permission("write")
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted transfers can be received."))
	if doc.transfer_status != "In Transit":
		frappe.throw(_("Only in-transit transfers can be received."))

	for row in doc.seals:
		_validate_transferable_seal(row.seal_device, doc.source_warehouse)

	for row in doc.seals:
		set_seal_custody(
			row.seal_device,
			"Custody Point",
			doc.target_warehouse,
			remarks=f"Received via Seal Stock Transfer {doc.name}",
		)

	doc.db_set("transfer_status", "Received")
	doc.db_set("received_by", frappe.session.user)
	doc.db_set("received_date", nowdate())
	return {"status": "Received"}
