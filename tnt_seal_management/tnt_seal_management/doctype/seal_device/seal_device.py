# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class SealDevice(Document):
	pass


_DOCTYPE = "Seal Device"

# Custody types allowed on the dynamic pointer. Each maps to the field on the
# target doctype that yields a human-friendly name for the custodian.
_CUSTODY_LABEL_FIELD = {
	"Custody Point": "custody_point_name",
	"Warehouse": "warehouse_name",
	"PCB Job Order": "name",
	"User": "full_name",
	"Customer": "customer_name",
}

_CUSTODY_TYPE_PREFIX = {
	"Custody Point": "Warehouse",
	"Warehouse": "Warehouse",
	"PCB Job Order": "Job Order",
	"User": "Person",
	"Customer": "Customer",
}

# The custody columns on the single per-journey Seal Status History row, in the
# order a seal moves through them. Callers pass one of these as ``column`` so the
# handoff is recorded inline against the journey's one row instead of a row per
# hop. See set_seal_custody / record_journey_custody.
JOURNEY_CUSTODY_COLUMNS = ("warehouse", "tagging_to", "customer", "untagging_to", "seal_return_to")

_ENTRY_TYPE_JOURNEY_SUMMARY = "Journey Summary"


def _custodian_name(custody_type, custodian):
	"""Plain human name for a custodian, e.g. 'Diana Nyambura' / 'ACME Ltd' /
	'Nairobi Depot' — no role prefix, since the column name already conveys the
	role."""
	if not custody_type or not custodian:
		return ""
	label_field = _CUSTODY_LABEL_FIELD.get(custody_type, "name")
	if label_field == "name":
		return custodian
	return frappe.db.get_value(custody_type, custodian, label_field) or custodian


def _custody_label(custody_type, custodian):
	"""Prefixed label for the live pointer field, e.g. 'Warehouse: Nairobi Depot'."""
	name = _custodian_name(custody_type, custodian)
	if not name:
		return ""
	prefix = _CUSTODY_TYPE_PREFIX.get(custody_type, custody_type)
	return f"{prefix}: {name}"


def main_warehouse_name():
	"""Name of the configured main warehouse Custody Point, if any."""
	return frappe.db.get_value(
		"Custody Point", {"is_main_warehouse": 1, "active": 1}, "custody_point_name"
	)


def last_known_warehouse(seal_device, exclude_journey=None):
	"""
	The most recent "warehouse" value recorded for this seal across its past
	journeys — i.e. where it was last returned to. Used as the origin warehouse
	for a new journey's custody row. Returns None if the seal has no prior
	journey with a recorded warehouse (e.g. its first cycle) — the caller should
	leave the column blank in that case; it will start getting logged from the
	next cycle onward.
	"""
	if not seal_device:
		return None
	filters = {"seal": seal_device, "entry_type": _ENTRY_TYPE_JOURNEY_SUMMARY, "warehouse": ["!=", ""]}
	if exclude_journey:
		filters["journey"] = ["!=", exclude_journey]
	rows = frappe.get_all(
		"Seal Status History", filters=filters, fields=["warehouse"], order_by="modified desc", limit=1
	)
	return rows[0].warehouse if rows else None


def record_journey_custody(seal_device, journey, column, values=None, remarks=None):
	"""
	Upsert the single "Journey Summary" row for (seal, journey) in the seal's
	status history and set one or more custody columns on it inline.

	Instead of a row per handoff, one row per journey accumulates the whole
	custody path across its columns (warehouse -> tagging_to -> customer ->
	untagging_to / seal_return_to -> warehouse) as the seal changes hands.

	``column``/``values``: pass a single ``column`` name with the value supplied
	positionally via ``values`` (a string), or pass ``column=None`` and a dict of
	{column: value} in ``values`` to set several at once.
	"""
	if not seal_device or not journey:
		return

	if column:
		values = {column: values}
	if not values:
		return
	values = {k: v for k, v in values.items() if k in JOURNEY_CUSTODY_COLUMNS and v}
	if not values:
		return

	doc = frappe.get_doc(_DOCTYPE, seal_device)
	row = next(
		(
			r
			for r in doc.status_history
			if r.journey == journey and r.entry_type == _ENTRY_TYPE_JOURNEY_SUMMARY
		),
		None,
	)
	if row is None:
		row = doc.append(
			"status_history",
			{"seal": seal_device, "journey": journey, "entry_type": _ENTRY_TYPE_JOURNEY_SUMMARY},
		)
	for key, value in values.items():
		row.set(key, value)
	row.status_date_time = now_datetime()
	row.updated_by = frappe.session.user
	if remarks:
		row.remarks = remarks
	doc.save(ignore_permissions=True)


def set_seal_custody(seal_device, custody_type, custodian, remarks=None, journey=None, column=None):
	"""
	Move a seal into the custody of a new holder (its current "warehouse").

	Two responsibilities:
	  1. Update the live custody pointer on Seal Device (current_custody_type /
	     current_custodian / current_custody_label / current_custody_since) — this
	     is "who holds it right now" and is a no-op if unchanged.
	  2. If ``journey`` and ``column`` are given, record this handoff inline into
	     the journey's single Seal Status History row (see record_journey_custody).

	``custody_type`` is one of the Select options on Seal Device (Custody Point /
	Warehouse / PCB Job Order / User / Customer) and ``custodian`` is the name of a
	record of that doctype.
	"""
	if not seal_device or not custody_type or not custodian:
		return

	current = frappe.db.get_value(
		_DOCTYPE,
		seal_device,
		["current_custody_type", "current_custodian"],
		as_dict=True,
	)
	if not current:
		return

	changed = not (
		current.current_custody_type == custody_type
		and current.current_custodian == custodian
	)
	if changed:
		frappe.db.set_value(
			_DOCTYPE,
			seal_device,
			{
				"current_custody_type": custody_type,
				"current_custodian": custodian,
				"current_custody_label": _custody_label(custody_type, custodian),
				"current_custody_since": now_datetime(),
			},
		)

	if journey and column:
		record_journey_custody(
			seal_device,
			journey,
			column,
			_custodian_name(custody_type, custodian),
			remarks=remarks,
		)


@frappe.whitelist()
def assign_custody(seal_device, custody_type, custodian, remarks=None):
	"""Whitelisted wrapper so custody can be set from a form button or client call."""
	set_seal_custody(seal_device, custody_type, custodian, remarks=remarks)
	return frappe.db.get_value(_DOCTYPE, seal_device, "current_custody_label")
