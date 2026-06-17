# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
)


class PCBAssignment(Document):
	def validate(self):
		if not self.assigned_field_technician:
			return

		if not frappe.db.exists(
			"Has Role",
			{
				"parent": self.assigned_field_technician,
				"parenttype": "User",
				"role": "Field Technician",
			},
		):
			frappe.throw(
				_("{0} is not a Field Technician (Tag Operator).").format(
					self.assigned_field_technician
				),
				title=_("Invalid Tag Operator"),
			)


def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB"}:
		return ""

	if "PCB Team Leader" in roles:
		return f"`tabPCB Assignment`.pcb_team_leader = {frappe.db.escape(user)}"

	return ""


def has_permission(doc, user=None, permission_type=None):
	if not user:
		user = frappe.session.user

	roles = set(frappe.get_roles(user))
	if roles & {"System Manager", "Management", "Finance PCB"}:
		return True

	if "PCB Team Leader" in roles and doc.pcb_team_leader == user:
		return True

	return False


def _seal_journey_for_job_order(job_order_name):
	booking = frappe.db.get_value("PCB Job Order", job_order_name, "tagging_booking")
	if not booking:
		return None
	return frappe.db.get_value("Tagging Booking", booking, "seal_journey_reference")


def _ensure_journey_request(assignment):
	if frappe.db.exists("Journey Request", {"job_order": assignment.pcb_job_order}):
		return

	seal_journey = _seal_journey_for_job_order(assignment.pcb_job_order)

	frappe.get_doc(
		{
			"doctype": "Journey Request",
			"job_order": assignment.pcb_job_order,
			"client_name": assignment.client_name,
			"assigned_technician": assignment.assigned_field_technician,
			"journey_reference": seal_journey,
		}
	).insert(ignore_permissions=True, ignore_mandatory=True)

	if seal_journey:
		set_journey_status(
			seal_journey,
			"Technician Assigned",
			{"assigned_technician": assignment.assigned_field_technician},
		)


def _ensure_assignment_status_permission(assignment):
	roles = set(frappe.get_roles())
	if "System Manager" in roles:
		return
	if assignment.pcb_team_leader != frappe.session.user:
		frappe.throw(
			_("Only the assigned PCB Team Leader can update this assignment's status."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def update_assignment_status(assignment_name, status):
	if status not in ("Assigned", "Cancelled"):
		frappe.throw(_("Invalid status {0}.").format(status), title=_("Invalid Status"))

	assignment = frappe.get_doc("PCB Assignment", assignment_name)
	assignment.check_permission("write")
	_ensure_assignment_status_permission(assignment)

	if assignment.assignment_status == "Cancelled":
		frappe.throw(
			_("This assignment is already Cancelled."),
			title=_("Invalid Status"),
		)

	if status == "Assigned" and not assignment.assigned_field_technician:
		frappe.throw(
			_("Cannot mark this assignment as Assigned before a Field Technician is assigned."),
			title=_("Field Technician Not Assigned"),
		)

	assignment.assignment_status = status
	assignment.save(ignore_permissions=True)

	if status == "Assigned":
		_ensure_journey_request(assignment)

	frappe.db.commit()

	return {"assignment_status": assignment.assignment_status}


@frappe.whitelist()
def get_assignment_list(
	search=None,
	status=None,
	field_technician=None,
	from_date=None,
	to_date=None,
	page=1,
	page_length=25,
):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	if from_date and to_date and getdate(from_date) > getdate(to_date):
		frappe.throw(_("From Date cannot be after To Date."))

	base_filters = []
	if field_technician:
		base_filters.append(["assigned_field_technician", "=", field_technician])
	if from_date:
		base_filters.append(["scheduled_date_time", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["scheduled_date_time", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["pcb_job_order", "like", search_text],
			["tagging_booking", "like", search_text],
			["client_name", "like", search_text],
			["location", "like", search_text],
			["contact_person_name", "like", search_text],
			["contact_person_phone", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["assignment_status", "=", status])

	assignments = frappe.get_list(
		"PCB Assignment",
		fields=[
			"name",
			"pcb_job_order",
			"tagging_booking",
			"client_name",
			"location",
			"scheduled_date_time",
			"contact_person_name",
			"contact_person_phone",
			"pcb_team_leader",
			"assigned_field_technician",
			"assignment_date_time",
			"assignment_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="scheduled_date_time desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_rows = frappe.get_list(
		"PCB Assignment",
		fields=[{"COUNT": "*", "as": "count"}],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_rows[0].count) if total_rows else 0

	summary = {"All": 0, "Pending": 0, "Assigned": 0, "Cancelled": 0}
	summary_rows = frappe.get_list(
		"PCB Assignment",
		fields=["assignment_status", {"COUNT": "*", "as": "count"}],
		filters=base_filters,
		or_filters=or_filters,
		group_by="assignment_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.assignment_status in summary:
			summary[row.assignment_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"assignments": assignments,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}
