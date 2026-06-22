# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class SealDevice(Document):
	pass


# Custody types allowed on the dynamic pointer. Each maps to the field on the
# target doctype that yields a human-friendly label for the custodian.
_CUSTODY_LABEL_FIELD = {
	"Custody Point": "custody_point_name",
	"PCB Job Order": "name",
	"User": "full_name",
	"Customer": "customer_name",
}

_CUSTODY_TYPE_PREFIX = {
	"Custody Point": "Warehouse",
	"PCB Job Order": "Job Order",
	"User": "Person",
	"Customer": "Customer",
}


def _custody_label(custody_type, custodian):
	"""Build a readable label like 'Warehouse: Nairobi Depot - Donholm'."""
	if not custody_type or not custodian:
		return ""
	label_field = _CUSTODY_LABEL_FIELD.get(custody_type, "name")
	value = (
		custodian
		if label_field == "name"
		else (frappe.db.get_value(custody_type, custodian, label_field) or custodian)
	)
	prefix = _CUSTODY_TYPE_PREFIX.get(custody_type, custody_type)
	return f"{prefix}: {value}"


def set_seal_custody(seal_device, custody_type, custodian, remarks=None, journey=None):
	"""
	Move a seal into the custody of a new holder (its current "warehouse").

	``custody_type`` is one of the Select options on Seal Device
	(Custody Point / PCB Job Order / User / Customer) and ``custodian`` is the
	name of a record of that doctype. No-ops if the seal is already in this
	exact custody. Records every handoff in the Seal Device status history.
	"""
	if not seal_device or not custody_type or not custodian:
		return

	current = frappe.db.get_value(
		"Seal Device",
		seal_device,
		["current_custody_type", "current_custodian", "current_custody_label"],
		as_dict=True,
	)
	if not current:
		return

	if current.current_custody_type == custody_type and current.current_custodian == custodian:
		return  # already here

	new_label = _custody_label(custody_type, custodian)
	previous_label = current.current_custody_label or ""

	frappe.db.set_value(
		"Seal Device",
		seal_device,
		{
			"current_custody_type": custody_type,
			"current_custodian": custodian,
			"current_custody_label": new_label,
			"current_custody_since": now_datetime(),
		},
	)

	# Append a custody-handoff row to the seal's status history.
	doc = frappe.get_doc("Seal Device", seal_device)
	doc.append(
		"status_history",
		{
			"seal": seal_device,
			"journey": journey,
			"previous_status": previous_label or None,
			"new_status": new_label,
			"status_date_time": now_datetime(),
			"updated_by": frappe.session.user,
			"remarks": remarks or "Custody handoff",
		},
	)
	doc.save(ignore_permissions=True)


@frappe.whitelist()
def assign_custody(seal_device, custody_type, custodian, remarks=None):
	"""Whitelisted wrapper so custody can be set from a form button or client call."""
	set_seal_custody(seal_device, custody_type, custodian, remarks=remarks)
	return frappe.db.get_value("Seal Device", seal_device, "current_custody_label")
