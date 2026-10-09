# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
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
JOURNEY_CUSTODY_COLUMNS = (
	"start_warehouse",
	"tagging_to",
	"customer",
	"untagging_to",
	"seal_return_to",
	"return_warehouse",
)

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
	The most recent return warehouse recorded for this seal across its past
	journeys — i.e. where it was last returned to. Used as the start warehouse
	for a new journey's custody row. Returns None if the seal has no prior
	journey with a recorded return warehouse (e.g. its first cycle) — the caller
	should leave the column blank in that case; it will start getting logged from
	the next cycle onward.
	"""
	if not seal_device:
		return None
	filters = {
		"seal": seal_device,
		"entry_type": _ENTRY_TYPE_JOURNEY_SUMMARY,
		"return_warehouse": ["!=", ""],
	}
	if exclude_journey:
		filters["journey"] = ["!=", exclude_journey]
	rows = frappe.get_all(
		"Seal Status History",
		filters=filters,
		fields=["return_warehouse"],
		order_by="modified desc",
		limit=1,
	)
	return rows[0].return_warehouse if rows else None


def journey_start_custody(seal_device, exclude_journey=None):
	"""Where the seal is starting its next journey from, for the start_warehouse
	column on that journey's custody row.

	Normally that is the warehouse it was last returned to. But a seal whose
	previous journey ended with a remote unlock at a far destination never came
	back to a warehouse — it stayed on the vehicle with the customer (see
	journey_request.close_for_retained_seal), and the live custody pointer still
	says so. In that case the customer is the true origin of this cycle, and the
	warehouse flow picks up again when the seal is eventually returned."""
	if not seal_device:
		return None
	custody = frappe.db.get_value(
		_DOCTYPE, seal_device, ["current_custody_type", "current_custodian"], as_dict=True
	)
	if custody and custody.current_custody_type == "Customer" and custody.current_custodian:
		return _custodian_name("Customer", custody.current_custodian)
	return last_known_warehouse(seal_device, exclude_journey=exclude_journey)


def record_journey_custody(seal_device, journey, column, values=None, remarks=None):
	"""
	Upsert the single "Journey Summary" row for (seal, journey) in the seal's
	status history and set one or more custody columns on it inline.

	Instead of a row per handoff, one row per journey accumulates the whole
	custody path across its columns (start_warehouse -> tagging_to -> customer ->
	untagging_to / seal_return_to -> return_warehouse) as the seal changes hands.

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
	# Remarks describe the hop just recorded, like status_date_time and
	# updated_by — a hop without one clears the previous hop's text rather than
	# leaving stale remarks attached to a newer handoff.
	row.remarks = remarks or None
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


_TRANSFER_TARGET_TYPES = ("Custody Point", "User")
# Roles that may hand over ANY seal (a Field Technician may only hand over
# seals they are currently holding).
_TRANSFER_SUPERVISOR_ROLES = ("System Manager", "Operations Control Room", "PCB Team Leader")


@frappe.whitelist()
def transfer_custody(seals, to_custody_type, to_custodian, remarks=None):
	"""Hand seals over to a live person (User) or a location (Custody Point such as
	the main store). One step: custody moves as soon as this is submitted, and a
	Seal Custody Transfer record keeps who moved what from whom to whom.

	Seals held by a Customer move only through the journey workflow, and a seal on
	a journey that is In Transit can't be handed over."""
	seals = frappe.parse_json(seals) if isinstance(seals, str) else seals
	seals = list(dict.fromkeys(seals or []))
	if not seals:
		frappe.throw(_("Select at least one seal to transfer."))
	if to_custody_type not in _TRANSFER_TARGET_TYPES:
		frappe.throw(_("Seals can only be handed to a person or a location (Custody Point)."))
	if not to_custodian or not frappe.db.exists(to_custody_type, to_custodian):
		frappe.throw(_("Select who is receiving the seals."))
	if to_custody_type == "User" and not frappe.db.get_value("User", to_custodian, "enabled"):
		frappe.throw(_("{0} is not an active user.").format(to_custodian))
	if to_custody_type == "Custody Point" and not frappe.db.get_value("Custody Point", to_custodian, "active"):
		frappe.throw(_("Custody Point {0} is not active.").format(to_custodian))

	user = frappe.session.user
	supervisor = user == "Administrator" or bool(set(frappe.get_roles(user)) & set(_TRANSFER_SUPERVISOR_ROLES))

	rows = []
	for seal in seals:
		info = frappe.db.get_value(
			_DOCTYPE,
			seal,
			["current_custody_type", "current_custodian", "current_custody_label", "current_journey"],
			as_dict=True,
		)
		if not info:
			frappe.throw(_("Seal {0} not found.").format(seal))
		if not supervisor and not (info.current_custody_type == "User" and info.current_custodian == user):
			frappe.throw(
				_("You can only hand over seals you are currently holding ({0} is not with you).").format(seal),
				frappe.PermissionError,
			)
		if info.current_custody_type == "Customer":
			frappe.throw(_("Seal {0} is with a customer; it moves back through the journey workflow.").format(seal))
		if info.current_custody_type == to_custody_type and info.current_custodian == to_custodian:
			frappe.throw(_("Seal {0} is already with {1}.").format(seal, to_custodian))
		if info.current_journey and frappe.db.get_value("Seal Journey", info.current_journey, "journey_status") == "In Transit":
			frappe.throw(_("Seal {0} is on a journey in transit and can't be handed over.").format(seal))
		rows.append(
			{
				"seal_device": seal,
				"from_custody_type": info.current_custody_type,
				"from_custodian": info.current_custodian,
				"from_label": info.current_custody_label,
			}
		)

	for row in rows:
		set_seal_custody(
			row["seal_device"],
			to_custody_type,
			to_custodian,
			remarks=remarks or _("Handed over by {0}").format(user),
		)
	to_label = _custody_label(to_custody_type, to_custodian)
	transfer = frappe.get_doc(
		{
			"doctype": "Seal Custody Transfer",
			"transfer_date_time": now_datetime(),
			"transferred_by": user,
			"to_custody_type": to_custody_type,
			"to_custodian": to_custodian,
			"to_label": to_label,
			"remarks": remarks,
			"seals": rows,
		}
	).insert(ignore_permissions=True)
	for row in rows:
		_append_transfer_history(
			row["seal_device"],
			row["from_label"] or _("(no custodian)"),
			to_label,
			_("{0}{1}").format(transfer.name, f" — {remarks}" if remarks else ""),
		)
	return {"transfer": transfer.name, "transferred": len(rows)}


def _append_transfer_history(seal_device, from_label, to_label, note):
	"""A "Seal Transfer" row in the seal's Status History: any movement outside a
	journey's own custody path (handover, custody to custody, stock distribution)."""
	# Inserted directly rather than via a Seal Device save: older seals can carry
	# legacy history rows (e.g. entry_type "Handoff") that would fail validation
	# on a full save.
	idx = frappe.db.sql(
		"select ifnull(max(idx), 0) from `tabSeal Status History` where parent = %s and parenttype = %s",
		(seal_device, _DOCTYPE),
	)[0][0]
	frappe.get_doc(
		{
			"doctype": "Seal Status History",
			"parent": seal_device,
			"parenttype": _DOCTYPE,
			"parentfield": "status_history",
			"idx": idx + 1,
			"seal": seal_device,
			"entry_type": "Seal Transfer",
			"status_date_time": now_datetime(),
			"updated_by": frappe.session.user,
			"remarks": f"{from_label} → {to_label} ({note})",
		}
	).db_insert()


@frappe.whitelist()
def get_custody_seals(custody_type, custodian):
	"""Seals whose live custody pointer is the given location right now
	(set_seal_custody moves a seal in on return and away on dispatch). Used by
	the "Seals in this ..." tables on the Custody Point and Warehouse forms."""
	if not custody_type or not custodian:
		return []
	return frappe.get_list(
		_DOCTYPE,
		filters={"current_custody_type": custody_type, "current_custodian": custodian},
		fields=[
			"name",
			"seal_number",
			"device_id",
			"current_status",
			"lock_status",
			"condition",
			"current_custody_since",
		],
		order_by="current_custody_since desc, seal_number asc",
		limit_page_length=0,
	)


@frappe.whitelist()
def get_warehouse_seals(warehouse):
	"""ERPNext Warehouse variant of get_custody_seals."""
	return get_custody_seals("Warehouse", warehouse)
