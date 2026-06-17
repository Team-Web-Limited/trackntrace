import json

import frappe


SHORTCUT_LABEL = "Current Customers"
CARD_LABEL = "Customers"
PAGE_NAME = "current-customer-list"
WORKSPACE_NAME = "TNT Operations Hub"


def execute():
	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return

	workspace = frappe.get_doc("Workspace", WORKSPACE_NAME)
	_ensure_shortcut(workspace)
	_ensure_link_card(workspace)
	workspace.content = json.dumps(_merge_content_blocks(workspace))
	workspace.save(ignore_permissions=True)
	frappe.db.commit()


def _ensure_shortcut(workspace):
	for shortcut in workspace.shortcuts:
		if shortcut.label == SHORTCUT_LABEL:
			shortcut.type = "Page"
			shortcut.link_to = PAGE_NAME
			shortcut.color = shortcut.color or "#059669"
			return

	workspace.append(
		"shortcuts",
		{
			"label": SHORTCUT_LABEL,
			"type": "Page",
			"link_to": PAGE_NAME,
			"color": "#059669",
		},
	)


def _ensure_link_card(workspace):
	filtered_links = []
	skip_customer_links = False

	for link in workspace.links:
		if link.type == "Card Break":
			skip_customer_links = link.label == CARD_LABEL
			if skip_customer_links:
				continue

		if skip_customer_links:
			continue

		filtered_links.append(link.as_dict(no_default_fields=True))

	workspace.links = []
	for link in filtered_links:
		workspace.append("links", link)

	workspace.append(
		"links",
		{
			"type": "Card Break",
			"label": CARD_LABEL,
			"link_count": 1,
		},
	)
	workspace.append(
		"links",
		{
			"type": "Link",
			"label": SHORTCUT_LABEL,
			"link_type": "Page",
			"link_to": PAGE_NAME,
		},
	)


def _merge_content_blocks(workspace):
	try:
		content = json.loads(workspace.content or "[]")
	except Exception:
		content = []

	if not any(
		block.get("type") == "shortcut"
		and (block.get("data") or {}).get("shortcut_name") == SHORTCUT_LABEL
		for block in content
	):
		content.extend(
			[
				{
					"id": "header_customers",
					"type": "header",
					"data": {
						"text": "Customers",
						"col": 12,
					},
				},
				{
					"id": "sc_current_customers",
					"type": "shortcut",
					"data": {
						"shortcut_name": SHORTCUT_LABEL,
						"col": 4,
					},
				},
				{
					"id": "card_customers",
					"type": "card",
					"data": {
						"card_name": CARD_LABEL,
						"col": 4,
					},
				},
			]
		)

	return content
