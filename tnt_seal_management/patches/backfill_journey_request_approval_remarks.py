import frappe


def execute():
	rows = frappe.get_all(
		"Journey Request Approval",
		filters={"remarks": ["is", "set"]},
		fields=["parent", "action_by", "action_date_time", "remarks"],
		order_by="action_date_time asc",
	)
	for row in rows:
		if frappe.db.exists(
			"Journey Request Remark",
			{
				"parent": row.parent,
				"parentfield": "remarks_log",
				"remarked_by": row.action_by,
				"remark_date_time": row.action_date_time,
				"remarks": row.remarks,
			},
		):
			continue

		idx = frappe.db.count(
			"Journey Request Remark",
			filters={"parent": row.parent, "parentfield": "remarks_log"},
		) + 1
		frappe.get_doc(
			{
				"doctype": "Journey Request Remark",
				"parent": row.parent,
				"parenttype": "Journey Request",
				"parentfield": "remarks_log",
				"idx": idx,
				"remark_date_time": row.action_date_time,
				"remarked_by": row.action_by,
				"remarks": row.remarks,
			}
		).db_insert()
