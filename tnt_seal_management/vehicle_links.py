# Vehicle rows on Quotation / Sales Order / Delivery Note / Sales Invoice must
# name an existing Vehicle. Frappe's own link check misses them: those vehicle
# tables fetch make/model/color from the Vehicle, and when a link has fetch_from
# fields a missing record is silently accepted (BaseDocument.get_invalid_links
# only flags it when the lookup returns a row). Free-typed registrations then
# get saved, copied forward month to month, and print as "None".

import frappe
from frappe import _


def _key(value):
	# MariaDB matching is case-insensitive and ignores trailing spaces.
	return value.rstrip().casefold()


def validate_vehicle_links(doc, method=None):
	if doc.flags.ignore_links:
		return

	rows = []  # (row, fieldname, table label)
	for table_df in doc.meta.get_table_fields():
		child_meta = frappe.get_meta(table_df.options)
		vehicle_fields = [df.fieldname for df in child_meta.get_link_fields() if df.options == "Vehicle"]
		if not vehicle_fields:
			continue
		for row in doc.get(table_df.fieldname) or []:
			for fieldname in vehicle_fields:
				if row.get(fieldname):
					rows.append((row, fieldname, _(table_df.label)))

	if not rows:
		return

	values = list({row.get(fieldname) for row, fieldname, _label in rows})
	existing = {
		_key(name): name for name in frappe.get_all("Vehicle", filters={"name": ["in", values]}, pluck="name")
	}

	missing = []
	for row, fieldname, label in rows:
		name = existing.get(_key(row.get(fieldname)))
		if name:
			# Store the Vehicle's exact name, as Frappe's link check normally does.
			row.set(fieldname, name)
		else:
			missing.append(
				_("{0} row {1}: {2}").format(label, row.idx, frappe.bold(frappe.utils.escape_html(row.get(fieldname))))
			)

	if missing:
		frappe.throw(
			_("These vehicles are not registered. Pick an existing Vehicle or create it first:")
			+ "<br><br>"
			+ "<br>".join(missing),
			title=_("Unknown Vehicle"),
		)
