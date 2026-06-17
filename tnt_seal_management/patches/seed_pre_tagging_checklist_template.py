import frappe

from tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey import (
	DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS,
)


def execute():
	settings = frappe.get_single("Seal API Settings")
	if settings.pre_tagging_checklist_template:
		return

	for item in DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS:
		settings.append("pre_tagging_checklist_template", {"checklist_item": item})

	settings.flags.ignore_permissions = True
	settings.flags.ignore_checklist_template_permission = True
	settings.save()
