import frappe
from frappe import _
from frappe.utils import format_datetime, get_datetime


def notify_customer_on_journey_event(doc, method=None):
	"""Seal Journey on_update hook: email the customer when a journey starts
	(status moves to In Transit) and when it arrives (arrival_date_time is
	stamped by SealJourney.confirm_arrival). Fires once per transition because it
	keys off value changes. Never raises — a mail glitch must not break the
	workflow action that saved the journey."""
	try:
		if doc.journey_status == "In Transit" and doc.has_value_changed("journey_status"):
			_send(doc, "has started its journey", doc.journey_start_date_time)
		if doc.arrival_date_time and doc.has_value_changed("arrival_date_time"):
			_send(doc, "has arrived at its destination", doc.arrival_date_time)
	except Exception:
		frappe.log_error(title="TNT customer journey email", message=frappe.get_traceback())


def _send(doc, event, when):
	recipients = customer_emails(doc.customer)
	if not recipients:
		return

	vehicle = doc.vehicle_plate_number or _("Vehicle")
	origin = doc.origin or "-"
	destination = doc.destination or "-"
	subject = _("Vehicle {0} {1}").format(vehicle, event)
	lines = [
		_("Vehicle {0} from {1} to {2} {3}.").format(
			frappe.bold(vehicle), frappe.bold(origin), frappe.bold(destination), event
		)
	]
	if when:
		lines.append(_("Time: {0}").format(format_datetime(get_datetime(when))))
	if doc.container_number:
		lines.append(_("Container: {0}").format(doc.container_number))
	lines.append(_("Journey Reference: {0}").format(doc.name))

	frappe.sendmail(
		recipients=recipients,
		subject=subject,
		message="<br>".join(lines),
		reference_doctype=doc.doctype,
		reference_name=doc.name,
		now=False,
	)


def customer_emails(customer):
	"""Customer's email: its own email_id, else its primary contact's, else the
	first linked Contact that has one."""
	if not customer:
		return []
	email_id, primary = frappe.db.get_value(
		"Customer", customer, ["email_id", "customer_primary_contact"]
	) or (None, None)
	if email_id:
		return [email_id]
	if primary:
		email = frappe.db.get_value("Contact", primary, "email_id")
		if email:
			return [email]
	rows = frappe.db.sql(
		"""select ce.email_id from `tabContact Email` ce
		join `tabDynamic Link` dl on dl.parent = ce.parent and dl.parenttype = 'Contact'
		where dl.link_doctype = 'Customer' and dl.link_name = %s
		order by ce.is_primary desc, ce.creation asc limit 1""",
		customer,
	)
	return [rows[0][0]] if rows and rows[0][0] else []
