import frappe

# Managing Director approval is a new gate on Seal Billing Rate going forward
# (see doctype/seal_billing_rate/seal_billing_rate.py). Rules that already
# existed before this patch are already trusted/in production — grandfather
# them as Approved rather than retroactively blocking billing that already
# works. Only rules created/edited after this patch runs default to (or reset
# to) Pending Approval.


def execute():
	if not frappe.db.has_column("Seal Billing Rate", "approval_status"):
		return

	frappe.db.sql(
		"""
		update `tabSeal Billing Rate`
		set approval_status = 'Approved'
		where ifnull(approval_status, '') != 'Approved'
		"""
	)
	frappe.db.commit()
