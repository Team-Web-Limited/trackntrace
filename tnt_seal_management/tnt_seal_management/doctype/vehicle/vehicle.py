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
		self._validate_plate_format()
		self._sync_legacy_party()
		if self.seating_capacity is not None and cint(self.seating_capacity) < 1:
			frappe.throw(_("Seating Capacity must be at least 1."))
		if self.year_of_manufacture is not None and cint(self.year_of_manufacture) < 1900:
			frappe.throw(_("Year of Manufacture must be 1900 or later."))

	def _validate_plate_format(self):
		"""Kenyan plates are stored as KAX 840K / KMGQ 479X / ZD 7072. Only checked
		when the plate is entered or changed, so older vehicles saved before this
		rule can still be edited."""
		if self.get("special_plate") or not self.registration_number:
			return
		before = None if self.is_new() else self.get_doc_before_save()
		if before and _normalize_registration(before.registration_number) == self.registration_number:
			return
		formatted = format_kenyan_plate(self.registration_number)
		if not formatted:
			frappe.throw(
				_(
					"{0} is not a valid Kenyan plate. Enter it as <b>KAX 840K</b> "
					"(motorbike <b>KMGQ 479X</b>, trailer <b>ZD 7072</b>), or tick "
					"<b>Foreign / Special Plate</b> for a foreign, government or diplomatic plate."
				).format(frappe.bold(frappe.utils.escape_html(self.registration_number))),
				title=_("Invalid Registration Number"),
			)
		self.registration_number = formatted

	def _sync_legacy_party(self):
		"""Some sites carry ERPNext's party_type/party_name custom fields on
		Vehicle. Customer (Owner) replaces them, so keep them in step rather
		than asking for the owner twice."""
		if not self.customer or not self.meta.has_field("party_name"):
			return
		if self.meta.has_field("party_type"):
			self.party_type = "Customer"
		self.party_name = self.customer


def _normalize_registration(value):
	return re.sub(r"\s+", " ", (value or "").strip()).upper()


# Car KAX 840K, motorbike KMGQ 479X, trailer ZD 7072 — matched with spaces and
# punctuation stripped, so "kax840k" or "KAX 840K." come out as "KAX 840K".
KENYAN_PLATE_PATTERNS = (
	re.compile(r"^(K[A-Z]{2}|KM[A-Z]{2})(\d{3})([A-Z])$"),
	re.compile(r"^(Z[A-Z])(\d{4})()$"),
)


def format_kenyan_plate(value):
	"""The plate in canonical Kenyan form, or None if it isn't one."""
	compact = re.sub(r"[^A-Z0-9]", "", (value or "").upper())
	for pattern in KENYAN_PLATE_PATTERNS:
		match = pattern.match(compact)
		if match:
			prefix, digits, suffix = match.groups()
			return f"{prefix} {digits}{suffix}"
	return None


@frappe.whitelist()
def get_vehicle_list(search=None, status=None, page=1, page_length=25):
	page = max(cint(page), 1)
	page_length = min(max(cint(page_length), 1), 100)

	# Only vehicles owned by the customers listed on Customer Billing.
	from tnt_seal_management.tnt_seal_management.api.current_customers import get_billing_customer_names

	customer_filter = ["customer", "in", get_billing_customer_names() or [""]]
	filters = [customer_filter]
	if status and status != "All":
		filters.append(["vehicle_status", "=", status])

	or_filters = []
	if search:
		search_text = f"%{search.strip()}%"
		or_filters = [
			["name", "like", search_text],
			["registration_number", "like", search_text],
			["customer", "like", search_text],
			["vehicle_make", "like", search_text],
			["vehicle_model", "like", search_text],
			["color", "like", search_text],
		]

	vehicles = frappe.get_list(
		"Vehicle",
		fields=[
			"name",
			"registration_number",
			"customer",
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
		filters=[customer_filter],
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
