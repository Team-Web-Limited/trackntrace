import frappe


def execute():
	if not frappe.db.has_column("Journey Request", "remarks"):
		return

	rows = frappe.db.sql(
		"""
		select name, remarks, modified, modified_by, owner
		from `tabJourney Request`
		where ifnull(remarks, '') != ''
		""",
		as_dict=True,
	)
	for row in rows:
		if frappe.db.exists(
			"Journey Request Remark",
			{
				"parent": row.name,
				"parentfield": "remarks_log",
				"remarks": row.remarks,
			},
		):
			continue

		frappe.get_doc(
			{
				"doctype": "Journey Request Remark",
				"parent": row.name,
				"parenttype": "Journey Request",
				"parentfield": "remarks_log",
				"idx": 1,
				"remark_date_time": row.modified,
				"remarked_by": row.modified_by or row.owner,
				"remarks": row.remarks,
			}
		).db_insert()
