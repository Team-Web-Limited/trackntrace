import json

import frappe
from frappe import _
from frappe.utils import get_datetime


CUSTOMER_SAFE_FIELDS = [
	"name",
	"location",
	"booking_date_time",
	"contact_person_name",
	"contact_person_phone",
	"booking_status",
	"creation",
]

CUSTOMER_STATUS_LABELS = {
	"Draft": "Draft",
	"Pending Account Manager Review": "Submitted for Review",
	"Pending Finance PCB Approval": "Under Internal Review",
	"Finance PCB Approved": "Confirmed",
	"Finance PCB Rejected": "Not Approved",
	"Cancelled": "Cancelled",
}


def _ensure_customer_website_user():
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Login required"), frappe.AuthenticationError)

	user_type = frappe.db.get_value("User", user, "user_type")
	if user_type != "Website User" or "Customer" not in set(frappe.get_roles(user)):
		frappe.throw(_("Customer portal access is required."), frappe.PermissionError)

	return user


def _customers_from_contact(user):
	contact_names = set(frappe.get_all("Contact", filters={"email_id": user}, pluck="name"))
	contact_names.update(frappe.get_all("Contact Email", filters={"email_id": user}, pluck="parent"))
	if not contact_names:
		return []

	return frappe.get_all(
		"Dynamic Link",
		filters={
			"parenttype": "Contact",
			"parent": ["in", list(contact_names)],
			"link_doctype": "Customer",
		},
		pluck="link_name",
	)


def get_customer_for_logged_in_user():
	user = _ensure_customer_website_user()
	customers = set(
		frappe.get_all(
			"Portal User",
			filters={"user": user, "parenttype": "Customer"},
			pluck="parent",
		)
	)
	customers.update(_customers_from_contact(user))
	customers = sorted(customer for customer in customers if customer)

	if not customers:
		frappe.throw(_("User is not linked to a Customer account."), frappe.PermissionError)
	if len(customers) > 1:
		frappe.throw(
			_("User is linked to multiple Customer accounts. Contact support to select a primary account."),
			frappe.PermissionError,
		)

	return customers[0]


def _customer_safe_booking(row):
	data = {fieldname: row.get(fieldname) for fieldname in CUSTOMER_SAFE_FIELDS}
	data["status"] = CUSTOMER_STATUS_LABELS.get(row.booking_status, "Under Review")
	data["can_cancel"] = row.booking_status == "Pending Account Manager Review"
	data.pop("booking_status", None)
	return data


@frappe.whitelist()
def get_customer_tagging_bookings():
	customer = get_customer_for_logged_in_user()
	bookings = frappe.get_all(
		"Tagging Booking",
		filters={"client_name": customer, "booking_source": "Customer Portal"},
		fields=CUSTOMER_SAFE_FIELDS,
		order_by="modified desc",
		limit_page_length=200,
	)
	return {
		"customer": customer,
		"bookings": [_customer_safe_booking(row) for row in bookings],
	}


def _parse_booking_data(data):
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except (TypeError, ValueError):
			frappe.throw(_("Invalid booking data."))
	if not isinstance(data, dict):
		frappe.throw(_("Invalid booking data."))
	return data


def _required_text(data, fieldname, label, max_length=140):
	value = str(data.get(fieldname) or "").strip()
	if not value:
		frappe.throw(_("{0} is required.").format(_(label)))
	return value[:max_length]


def _get_eligible_account_managers():
	account_managers = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": "Account Manager"},
		pluck="parent",
	)
	if not account_managers:
		return []

	return frappe.get_all(
		"User",
		filters={"name": ["in", account_managers], "enabled": 1, "user_type": "System User"},
		fields=["name", "email"],
		order_by="name asc",
	)


@frappe.whitelist()
def create_customer_tagging_booking(data):
	user = _ensure_customer_website_user()
	customer = get_customer_for_logged_in_user()
	data = _parse_booking_data(data)

	account_managers = _get_eligible_account_managers()
	if not account_managers:
		frappe.throw(
			_("No Account Manager is configured for booking review. Contact support."),
			title=_("Account Manager Required"),
		)
	auto_assigned_account_manager = account_managers[0].name if len(account_managers) == 1 else None

	try:
		booking_date_time = get_datetime(data.get("booking_date_time"))
	except (TypeError, ValueError):
		frappe.throw(_("Enter a valid booking date and time."))
	if not booking_date_time or booking_date_time <= get_datetime():
		frappe.throw(_("Booking date and time must be in the future."))

	doc = frappe.get_doc(
		{
			"doctype": "Tagging Booking",
			"client_name": customer,
			"booking_status": "Pending Account Manager Review",
			"booking_source": "Customer Portal",
			"requested_by": user,
			"account_manager": auto_assigned_account_manager,
			"location": _required_text(data, "location", "Location"),
			"booking_date_time": booking_date_time,
			"contact_person_name": _required_text(data, "contact_person_name", "Name"),
			"contact_person_phone": _required_text(
				data, "contact_person_phone", "Phone Number", 30
			),
		}
	).insert(ignore_permissions=True)

	_notify_account_managers_new_booking(doc, account_managers)
	return _customer_safe_booking(doc)


def _notify_account_managers_new_booking(doc, account_managers):
	"""Tell the Account Manager(s) a customer booking needs review: the
	auto-assigned one, or every eligible Account Manager when it lands in the
	shared queue to be claimed."""
	from tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking import (
		notify_booking_approvers,
	)

	recipients = [
		(row.name, row.email or row.name)
		for row in account_managers
		if not doc.account_manager or row.name == doc.account_manager
	]
	intro = (
		_("A customer booking has been assigned to you for review.")
		if doc.account_manager
		else _("A customer booking is waiting in the shared queue. Assign it to yourself to review.")
	)
	notify_booking_approvers(
		doc,
		recipients,
		_("New Customer Tagging Booking: {0}").format(doc.name),
		intro,
	)


@frappe.whitelist()
def cancel_customer_tagging_booking(name):
	customer = get_customer_for_logged_in_user()
	doc = frappe.get_doc("Tagging Booking", name)
	if doc.client_name != customer or doc.booking_source != "Customer Portal":
		frappe.throw(_("Not permitted."), frappe.PermissionError)
	if doc.booking_status != "Pending Account Manager Review":
		frappe.throw(
			_("Only bookings awaiting Account Manager review can be cancelled."),
			title=_("Cannot Cancel Booking"),
		)

	doc.booking_status = "Cancelled"
	doc.save(ignore_permissions=True)
	return {"name": doc.name, "status": CUSTOMER_STATUS_LABELS["Cancelled"]}
