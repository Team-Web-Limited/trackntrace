import frappe


PHOTO_TABLE_TYPES = {
	"entry_document": "Pre-Tagging",
	"tagging_photos": "Tagging",
	"untagging_entry_document": "Untagging",
	"untagging_photos": "Untagging",
	"seal_return_entry_document": "Seal Return",
	"seal_return_photos": "Seal Return",
}


def execute():
	for parentfield, photo_type in PHOTO_TABLE_TYPES.items():
		frappe.db.sql(
			"""
			update `tabSeal Trip Photo`
			set photo_type = %s
			where parenttype = 'Journey Request'
				and parentfield = %s
				and ifnull(photo_type, '') != %s
			""",
			(photo_type, parentfield, photo_type),
		)
