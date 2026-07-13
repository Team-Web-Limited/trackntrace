import frappe
from frappe import _


def get_users_with_role(role):
	"""Return [(user, email)] for enabled users holding role, excluding Administrator."""
	users = set(
		frappe.get_all(
			"Has Role", filters={"role": role, "parenttype": "User"}, pluck="parent"
		)
	)
	users -= {"Administrator"}
	if not users:
		return []
	rows = frappe.get_all(
		"User",
		filters={"name": ["in", list(users)], "enabled": 1},
		fields=["name", "email"],
	)
	return [(r.name, r.email or r.name) for r in rows]


def notify_users(
	recipients,
	subject,
	message,
	document_type=None,
	document_name=None,
	link=None,
	notification_type="Alert",
):
	"""Push a desk Notification Log (bell icon) to each recipient, plus a
	best-effort email via the site's default outgoing account.

	``recipients`` is a list of (user, email) tuples, e.g. from
	``get_users_with_role``. Failures are logged, never raised, so a
	notification glitch can never break the workflow action that triggered it.
	"""
	if not recipients:
		return

	for user, _email in recipients:
		try:
			frappe.get_doc(
				{
					"doctype": "Notification Log",
					"subject": subject,
					"email_content": message,
					"for_user": user,
					"type": notification_type,
					"document_type": document_type,
					"document_name": document_name,
					"link": link,
				}
			).insert(ignore_permissions=True)
		except Exception as exc:
			frappe.log_error(f"Desk notification failed for {user}: {exc}", "TNT Notify")

	emails = [email for _user, email in recipients if email and "@" in email]
	if emails:
		try:
			frappe.sendmail(recipients=emails, subject=subject, message=message, now=False)
		except Exception as exc:
			frappe.log_error(f"Email notification failed: {exc}", "TNT Notify")
