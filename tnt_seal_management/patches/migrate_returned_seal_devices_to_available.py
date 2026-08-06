import frappe


def execute():
	"""The "Returned" Seal Device status has been dropped — a returned seal is
	immediately Available again. Move any device still parked on "Returned" to
	"Available", unless it came back in a bad condition."""
	if not frappe.db.has_column("Seal Device", "current_status"):
		return

	frappe.db.sql(
		"""
		update `tabSeal Device`
		set current_status = case
			when `condition` in ('Damaged', 'Lost') then `condition`
			else 'Available'
		end
		where current_status = 'Returned'
		"""
	)
	frappe.db.commit()
