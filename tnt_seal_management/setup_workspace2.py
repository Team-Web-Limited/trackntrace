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

    try:
        # Check if any workspace with this route exists
        ws_list = frappe.get_all("Workspace", filters={"name": WORKSPACE_NAME})
        if ws_list:
            ws_name = ws_list[0].name
            print(f"Found existing workspace: {ws_name}")
            workspace = frappe.get_doc("Workspace", ws_name)
        else:
            print(f"Creating new workspace {WORKSPACE_NAME}")
            workspace = frappe.new_doc("Workspace")
            workspace.name = WORKSPACE_NAME
            workspace.label = WORKSPACE_TITLE
            workspace.title = WORKSPACE_TITLE
            workspace.module = "TNT Seal Management"
            workspace.is_standard = 1
            workspace.public = 1
            workspace.type = "Workspace"
            workspace.icon = "shield-check"
            workspace.indicator_color = "blue"

        workspace.content = json.dumps(content_blocks)
        workspace.icon = "shield-check"
        workspace.indicator_color = "blue" # subtle blue theme
        _apply_workspace_items(workspace)
        workspace.save(ignore_permissions=True)
        print("Workspace saved successfully!")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

    frappe.db.commit()
