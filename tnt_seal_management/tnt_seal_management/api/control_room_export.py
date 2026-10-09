# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt
"""Excel export for the Control Room's tab lists.

The page builds the rows (columns + values as shown in the tab's table) and
posts them here; the PDF counterpart reuses ``seal_alert_log.export_pdf``.
"""

import frappe
from frappe import _
from frappe.utils import cstr, today


@frappe.whitelist()
def export_excel(title, columns, rows, filename=None):
	from frappe.utils.xlsxutils import make_xlsx

	from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
		_ensure_control_room_role,
	)

	_ensure_control_room_role(include_read_only=True)

	columns = frappe.parse_json(columns) or []
	rows = frappe.parse_json(rows) or []
	if not rows:
		frappe.throw(_("Nothing to export for the current filters."))

	data = [[cstr(c) for c in columns]] + [[cstr(v) for v in row] for row in rows]
	widths = [
		min(max(len(cell) for cell in col) + 2, 40) for col in zip(*data)
	]
	xlsx_file = make_xlsx(data, cstr(title)[:31], column_widths=widths)

	frappe.local.response.filename = f"{filename or f'{title} - {today()}'}.xlsx"
	frappe.local.response.filecontent = xlsx_file.getvalue()
	frappe.local.response.type = "binary"
