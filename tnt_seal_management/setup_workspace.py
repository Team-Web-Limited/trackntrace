import frappe
import json

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
                "shortcut_name": "Seal API Settings",
                "col": 4
            }
        }
    ]

    if not frappe.db.exists("Workspace", "TNT Seal Management"):
        workspace = frappe.get_doc({
            "doctype": "Workspace",
            "name": "TNT Seal Management",
            "label": "TNT Seal Management",
            "title": "TNT Seal Management",
            "module": "TNT Seal Management",
            "type": "Workspace",
            "public": 1,
            "icon": "shield-check",
            "indicator_color": "blue",
            "content": json.dumps(content_blocks)
        })
        workspace.insert(ignore_permissions=True)
        print("Created TNT Seal Management Workspace")
    else:
        workspace = frappe.get_doc("Workspace", "TNT Seal Management")
        workspace.indicator_color = "blue"
        workspace.icon = "shield-check"
        workspace.content = json.dumps(content_blocks)
        workspace.save(ignore_permissions=True)
        print("Updated TNT Seal Management Workspace")
        
    frappe.db.commit()
