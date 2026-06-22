import frappe
import json

WORKSPACE_NAME = "TNT Operations Hub"
WORKSPACE_TITLE = "TNT Operations Hub"


def _apply_workspace_items(workspace):
    workspace.shortcuts = []
    workspace.links = []

    workspace.append("shortcuts", {
        "label": "Seal Journey",
        "type": "DocType",
        "link_to": "Seal Journey",
        "doc_view": "List",
    })
    workspace.append("shortcuts", {
        "label": "Control Room",
        "type": "Page",
        "link_to": "control-room",
        "color": "#0284c7",
    })
    workspace.append("shortcuts", {
        "label": "Tagging Request",
        "type": "DocType",
        "link_to": "Tagging Request",
        "doc_view": "List",
    })
    workspace.append("shortcuts", {
        "label": "Seal Device",
        "type": "DocType",
        "link_to": "Seal Device",
        "doc_view": "List",
    })
    workspace.append("shortcuts", {
        "label": "Seal Billing Rate",
        "type": "DocType",
        "link_to": "Seal Billing Rate",
        "doc_view": "List",
    })
    workspace.append("shortcuts", {
        "label": "Current Customers",
        "type": "Page",
        "link_to": "current-customer-list",
        "color": "#059669",
    })
    workspace.append("shortcuts", {
        "label": "Seal Settings",
        "type": "DocType",
        "link_to": "Seal API Settings",
        "doc_view": "List",
    })

    workspace.append("links", {
        "type": "Card Break",
        "label": "Customers",
        "link_count": 1,
    })
    workspace.append("links", {
        "type": "Link",
        "label": "Current Customers",
        "link_type": "Page",
        "link_to": "current-customer-list",
    })

def execute():
    content_blocks = [
        {
            "id": "header_operations",
            "type": "header",
            "data": {
                "text": "Operations",
                "col": 12
            }
        },
        {
            "id": "sc_seal_journey",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Seal Journey",
                "col": 4
            }
        },
        {
            "id": "sc_control_room",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Control Room",
                "col": 4
            }
        },
        {
            "id": "sc_tagging_request",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Tagging Request",
                "col": 4
            }
        },
        {
            "id": "header_inventory",
            "type": "header",
            "data": {
                "text": "Inventory & Billing",
                "col": 12
            }
        },
        {
            "id": "sc_seal_device",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Seal Device",
                "col": 4
            }
        },
        {
            "id": "sc_seal_billing_rate",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Seal Billing Rate",
                "col": 4
            }
        },
        {
            "id": "header_customers",
            "type": "header",
            "data": {
                "text": "Customers",
                "col": 12
            }
        },
        {
            "id": "sc_current_customers",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Current Customers",
                "col": 4
            }
        },
        {
            "id": "card_customers",
            "type": "card",
            "data": {
                "card_name": "Customers",
                "col": 4
            }
        },
        {
            "id": "header_settings",
            "type": "header",
            "data": {
                "text": "Settings",
                "col": 12
            }
        },
        {
            "id": "sc_seal_api_settings",
            "type": "shortcut",
            "data": {
                "shortcut_name": "Seal Settings",
                "col": 4
            }
        }
    ]

    if not frappe.db.exists("Workspace", WORKSPACE_NAME):
        workspace = frappe.get_doc({
            "doctype": "Workspace",
            "name": WORKSPACE_NAME,
            "label": WORKSPACE_TITLE,
            "title": WORKSPACE_TITLE,
            "module": "TNT Seal Management",
            "type": "Workspace",
            "public": 1,
            "icon": "shield-check",
            "indicator_color": "blue",
            "content": json.dumps(content_blocks)
        })
        _apply_workspace_items(workspace)
        workspace.insert(ignore_permissions=True)
        print(f"Created {WORKSPACE_NAME} Workspace")
    else:
        workspace = frappe.get_doc("Workspace", WORKSPACE_NAME)
        workspace.indicator_color = "blue"
        workspace.icon = "shield-check"
        workspace.content = json.dumps(content_blocks)
        _apply_workspace_items(workspace)
        workspace.save(ignore_permissions=True)
        print(f"Updated {WORKSPACE_NAME} Workspace")
        
    frappe.db.commit()
