# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, now_datetime

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	set_journey_status,
)


class TaggingBooking(Document):
	def validate(self):
		self._enforce_finance_only_approval_controls()
		self._sync_approval_status()

	def after_insert(self):
		self._ensure_seal_journey()

	def _ensure_seal_journey(self):
		"""Create the Seal Journey mirror the first time a booking is saved, so
		the whole flow is monitored from Draft onwards."""
		if self.seal_journey_reference:
			return

		journey = frappe.get_doc(
			{
				"doctype": "Seal Journey",
				"customer": self.client_name,
				"tagging_booking": self.name,
				"journey_status": "Draft",
				"origin": self.location,
			}
		).insert(ignore_permissions=True, ignore_mandatory=True)

		self.db_set("seal_journey_reference", journey.name)

	def _sync_approval_status(self):
		status_map = {
			"Draft": "Pending",
			"Pending Finance PCB Approval": "Pending",
			"Finance PCB Approved": "Approved",
			"Finance PCB Rejected": "Rejected",
		}
		self.finance_pcb_approval_status = status_map.get(
			self.booking_status or "Draft",
			"Pending",
		)

	def _enforce_finance_only_approval_controls(self):
		if _can_manage_finance_approval():
			return

		protected_statuses = {"Finance PCB Approved", "Finance PCB Rejected"}
		protected_fields = (
			"finance_pcb_approval_status",
			"finance_pcb_approver",
			"finance_pcb_approval_date_time",
			"finance_pcb_remarks",
		)

		if self.is_new():
			if self.booking_status in protected_statuses:
				self._throw_finance_only_change()
			if any(self.get(fieldname) for fieldname in protected_fields[1:]):
				self._throw_finance_only_change()
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		if (
			self.booking_status != previous.booking_status
			and (
				self.booking_status in protected_statuses
				or previous.booking_status in protected_statuses
			)
		):
			self._throw_finance_only_change()

		for fieldname in protected_fields:
			if self.get(fieldname) != previous.get(fieldname):
				self._throw_finance_only_change()

	def _throw_finance_only_change(self):
		frappe.throw(
			_("Only Finance PCB can approve/reject a tagging booking or update finance approval details."),
			title=_("Insufficient Permission"),
		)


@frappe.whitelist()
def get_booking_list(
	search=None,
	status=None,
	customer=None,
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
	if customer:
		base_filters.append(["client_name", "=", customer])
	if from_date:
		base_filters.append(["booking_date_time", ">=", f"{from_date} 00:00:00"])
	if to_date:
		base_filters.append(["booking_date_time", "<=", f"{to_date} 23:59:59"])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["client_name", "like", search_text],
			["location", "like", search_text],
			["contact_person_name", "like", search_text],
			["contact_person_phone", "like", search_text],
		]

	filters = list(base_filters)
	if status and status != "All":
		filters.append(["booking_status", "=", status])

	bookings = frappe.get_list(
		"Tagging Booking",
		fields=[
			"name",
			"client_name",
			"location",
			"booking_date_time",
			"contact_person_name",
			"contact_person_phone",
			"booking_status",
			"finance_pcb_approval_status",
			"creation",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="booking_date_time desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_result = frappe.get_list(
		"Tagging Booking",
		fields=[{"COUNT": "*", "as": "count"}],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_result[0].count) if total_result else 0

	summary = {
		"All": 0,
		"Draft": 0,
		"Pending Finance PCB Approval": 0,
		"Finance PCB Approved": 0,
		"Finance PCB Rejected": 0,
	}
	summary_rows = frappe.get_list(
		"Tagging Booking",
		fields=["booking_status", {"COUNT": "*", "as": "count"}],
		filters=base_filters,
		or_filters=or_filters,
		group_by="booking_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.booking_status in summary:
			summary[row.booking_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"bookings": bookings,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}


def _get_tagging_booking(docname):
	doc = frappe.get_doc("Tagging Booking", docname)
	doc.check_permission("write")
	return doc


def _ensure_finance_role():
	if not _can_manage_finance_approval():
		frappe.throw(
			_("Only users with the Finance PCB role can perform this action."),
			title=_("Insufficient Permission"),
		)


def _can_manage_finance_approval(user=None):
	roles = frappe.get_roles(user or frappe.session.user)
	return "Finance PCB" in roles or "System Manager" in roles


@frappe.whitelist()
def submit_to_finance(docname):
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Draft":
		frappe.throw(
			_("Only draft tagging bookings can be submitted to Finance."),
			title=_("Invalid Status"),
		)

	doc.booking_status = "Pending Finance PCB Approval"
	doc.save()
	set_journey_status(doc.seal_journey_reference, "Pending Finance PCB Approval")
	frappe.db.commit()


@frappe.whitelist()
def approve_booking(docname, remarks=None):
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Finance PCB Approval":
		frappe.throw(
			_("Only tagging bookings pending Finance approval can be approved."),
			title=_("Invalid Status"),
		)

	doc.booking_status = "Finance PCB Approved"
	doc.finance_pcb_approver = frappe.session.user
	doc.finance_pcb_approval_date_time = now_datetime()
	doc.finance_pcb_remarks = remarks or doc.finance_pcb_remarks
	job_order = _get_or_create_pcb_job_order(doc)
	doc.pcb_job_order_reference = job_order.name
	doc.save()
	set_journey_status(
		doc.seal_journey_reference,
		"Finance PCB Approved",
		{"sales_order_reference": job_order.name},
	)
	frappe.db.commit()
	return {"pcb_job_order": job_order.name}


@frappe.whitelist()
def reject_booking(docname, remarks=None):
	_ensure_finance_role()
	doc = _get_tagging_booking(docname)
	if doc.booking_status != "Pending Finance PCB Approval":
		frappe.throw(
			_("Only tagging bookings pending Finance approval can be rejected."),
			title=_("Invalid Status"),
		)

	doc.booking_status = "Finance PCB Rejected"
	doc.finance_pcb_approver = frappe.session.user
	doc.finance_pcb_approval_date_time = now_datetime()
	doc.finance_pcb_remarks = remarks or doc.finance_pcb_remarks
	doc.save()
	set_journey_status(doc.seal_journey_reference, "Finance PCB Rejected")
	frappe.db.commit()


def _get_or_create_pcb_job_order(booking):
	existing = booking.pcb_job_order_reference or frappe.db.get_value(
		"PCB Job Order",
		{"tagging_booking": booking.name},
		"name",
	)
	if existing:
		return frappe.get_doc("PCB Job Order", existing)

	return frappe.get_doc(
		{
			"doctype": "PCB Job Order",
			"tagging_booking": booking.name,
			"client_name": booking.client_name,
			"location": booking.location,
			"scheduled_date_time": booking.booking_date_time,
			"contact_person_name": booking.contact_person_name,
			"contact_person_phone": booking.contact_person_phone,
			"job_order_status": "Unassigned",
		}
	).insert(ignore_permissions=True)
