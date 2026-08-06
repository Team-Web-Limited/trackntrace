import frappe


def execute():
	"""The single "warehouse" column on Seal Status History has been split into
	"start_warehouse" (where the journey began) and "return_warehouse" (where the
	seal came back to).

	The old column held whichever of the two was written last: the start
	warehouse until the seal was returned, then the return warehouse overwrote
	it. So an existing value belongs to return_warehouse once its journey is
	Completed, and to start_warehouse otherwise.
	"""
	if not frappe.db.has_column("Seal Status History", "warehouse"):
		return

	frappe.db.sql(
		"""
		update `tabSeal Status History` h
		left join `tabSeal Journey` j on j.name = h.journey
		set
			h.return_warehouse = case when j.journey_status = 'Completed' then h.warehouse end,
			h.start_warehouse = case when j.journey_status = 'Completed' then null else h.warehouse end
		where ifnull(h.warehouse, '') != ''
		"""
	)
	frappe.db.commit()

	# The renamed column is now dead weight; keep the data around under its new
	# homes only.
	frappe.db.sql("alter table `tabSeal Status History` drop column `warehouse`")
