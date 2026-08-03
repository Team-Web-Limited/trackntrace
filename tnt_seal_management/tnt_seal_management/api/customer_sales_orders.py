"""
Customer-facing Sales Orders — portal summary of the Sales Orders generated
for the logged-in customer's completed journeys (see
completed_journeys.generate_sales_order, called from Current Customer List /
Completed Journeys on the desk side). Read-only, scoped to the Customer
linked to the logged-in Website User — the same scoping as
customer_completed_journeys.get_customer_completed_journeys.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings import (
	get_customer_for_logged_in_user,
)
from tnt_seal_management.tnt_seal_management.api.completed_journeys import (
	_get_seals_by_journey,
)

DOCTYPE = "Sales Order"
CUSTOMER_RESPONSE_OPTIONS = ("Accepted", "Rejected")

FIELDS = [
	"name",
	"transaction_date",
	"currency",
	"grand_total",
	"status",
	"per_billed",
	"custom_customer_response",
]

# Seal Journey fields for the "View" modal — same shape as the portal's own
# Completed Journeys table (customer_completed_journeys.py), minus the
# internal-only sales_order_reference/billing_status (every journey shown
# here already belongs to the one Sales Order the caller asked for, so
# neither adds anything — see get_sales_order_journeys).
JOURNEY_FIELDS = [
	"name", "container_number", "vehicle_plate_number", "origin", "destination",
	"tagging_date_time", "arrival_date_time", "untagging_completed_date_time",
	"assigned_seal", "file_number", "days_taken_display", "contact_person_name",
	"departure_card_number", "retrieval_card_number", "total_charge", "currency",
]


@frappe.whitelist()
def get_customer_sales_orders():
	"""Every Sales Order belonging to the logged-in customer, newest first —
	a flat summary table (Order #, Date, Amount, Currency, Status), not
	grouped/paginated like Completed Journeys since Sales Orders are already
	one row per invoiceable batch."""
	customer = get_customer_for_logged_in_user()
	# Portal ("Customer" role) users have no direct Sales Order read
	# permission — ignore_permissions is safe here since the filter is scoped
	# server-side to the caller's own Customer, never client-supplied.
	orders = frappe.get_all(
		DOCTYPE,
		filters={"customer": customer},
		fields=FIELDS,
		order_by="transaction_date desc, creation desc",
		ignore_permissions=True,
	)
	return {"sales_orders": orders}


def _verify_customer_owns_sales_order(sales_order):
	"""Returns the logged-in customer, having confirmed ``sales_order``
	actually belongs to them — shared guard for every portal Sales Order
	action so a portal user can never read/act on another customer's order
	by guessing its name."""
	customer = get_customer_for_logged_in_user()
	if not sales_order or frappe.db.get_value(DOCTYPE, sales_order, "customer") != customer:
		frappe.throw(_("Sales Order not found."), frappe.PermissionError)
	return customer


@frappe.whitelist()
def get_sales_order_journeys(sales_order):
	"""Seal Journeys billed onto ``sales_order`` (the "View" action on the
	portal's Sales Orders tab) — same table shape as Completed Journeys, plus
	the order's own customer-response fields (see set_sales_order_response)
	so the modal can prefill the Accept/Reject state on open."""
	_verify_customer_owns_sales_order(sales_order)

	journeys = frappe.get_all(
		"Seal Journey",
		filters={"sales_order_reference": sales_order},
		fields=JOURNEY_FIELDS,
		order_by="completion_date_time asc",
		ignore_permissions=True,
	)

	seals_by_journey = _get_seals_by_journey([j["name"] for j in journeys])
	for j in journeys:
		j["container_number"] = j.get("container_number") or j.get("vehicle_plate_number")
		j["seal_number"] = seals_by_journey.get(j["name"]) or j.get("assigned_seal")

	response = frappe.db.get_value(
		DOCTYPE,
		sales_order,
		[
			"custom_customer_response",
			"custom_customer_response_remarks",
			"custom_customer_response_by",
			"custom_customer_response_date",
		],
		as_dict=True,
	)

	return {"journeys": journeys, "response": response}


@frappe.whitelist()
def set_sales_order_response(sales_order, response, remarks=None):
	"""Persist the logged-in customer's Accept/Reject decision (+ remarks) on
	``sales_order`` — the modal's Accept/Reject buttons + textarea. A
	rejection must carry a reason; acceptance's remarks are optional. One-shot
	— once a response is set it's final, the customer can't call this again
	to change it (the buttons/textarea are removed client-side once
	responded; this is the server-side backstop)."""
	_verify_customer_owns_sales_order(sales_order)

	if frappe.db.get_value(DOCTYPE, sales_order, "custom_customer_response"):
		frappe.throw(_("You have already responded to this Sales Order."))
	if response not in CUSTOMER_RESPONSE_OPTIONS:
		frappe.throw(_("Invalid response."))
	if response == "Rejected" and not (remarks or "").strip():
		frappe.throw(_("Enter a reason for rejecting this Sales Order."))

	frappe.db.set_value(
		DOCTYPE,
		sales_order,
		{
			"custom_customer_response": response,
			"custom_customer_response_remarks": remarks,
			"custom_customer_response_by": frappe.session.user,
			"custom_customer_response_date": now_datetime(),
		},
	)
	frappe.db.commit()

	return {
		"custom_customer_response": response,
		"custom_customer_response_remarks": remarks,
		"custom_customer_response_by": frappe.session.user,
		"custom_customer_response_date": now_datetime(),
	}
