# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class Vehicle(Document):
	def validate(self):
		self.registration_number = _normalize_registration(self.registration_number)
		if self.seating_capacity is not None and cint(self.seating_capacity) < 1:
			frappe.throw(_("Seating Capacity must be at least 1."))
		if self.year_of_manufacture is not None and cint(self.year_of_manufacture) < 1900:
			frappe.throw(_("Year of Manufacture must be 1900 or later."))


def _normalize_registration(value):
	return re.sub(r"\s+", " ", (value or "").strip()).upper()


@frappe.whitelist()
def get_vehicle_list(search=None, status=None, page=1, page_length=25):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	filters = []
	if status and status != "All":
		filters.append(["vehicle_status", "=", status])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["registration_number", "like", search_text],
			["vehicle_make", "like", search_text],
			["vehicle_model", "like", search_text],
			["color", "like", search_text],
		]

	vehicles = frappe.get_list(
		"Vehicle",
		fields=[
			"name",
			"registration_number",
			"vehicle_make",
			"vehicle_model",
			"color",
			"year_of_manufacture",
			"seating_capacity",
			"vehicle_status",
		],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc, creation desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	total_rows = frappe.get_list(
		"Vehicle",
		fields=["count(*) as count"],
		filters=filters,
		or_filters=or_filters,
		limit_page_length=1,
	)
	total = cint(total_rows[0].count) if total_rows else 0

	summary = {"All": 0, "Active": 0, "Maintenance": 0, "Inactive": 0}
	summary_rows = frappe.get_list(
		"Vehicle",
		fields=["vehicle_status", "count(*) as count"],
		filters=[],
		or_filters=or_filters,
		group_by="vehicle_status",
		limit_page_length=0,
	)
	for row in summary_rows:
		if row.vehicle_status in summary:
			summary[row.vehicle_status] = cint(row.count)
			summary["All"] += cint(row.count)

	return {
		"vehicles": vehicles,
		"total": total,
		"page": page,
		"page_length": page_length,
		"summary": summary,
	}
