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

    try:
        # Check if any workspace with this route exists
        ws_list = frappe.get_all("Workspace", filters={"name": ("like", "%Seal%")})
        if ws_list:
            ws_name = ws_list[0].name
            print(f"Found existing workspace: {ws_name}")
            workspace = frappe.get_doc("Workspace", ws_name)
        else:
            print("Creating new workspace TNT Seal Management")
            workspace = frappe.new_doc("Workspace")
            workspace.name = "TNT Seal Management"
            workspace.title = "TNT Seal Management"
            workspace.module = "TNT Seal Management"
            workspace.is_standard = 1
            workspace.public = 1
            workspace.type = "Workspace"
            workspace.icon = "shield-check"
            workspace.indicator_color = "blue"

        workspace.content = json.dumps(content_blocks)
        workspace.icon = "shield-check"
        workspace.indicator_color = "blue" # subtle blue theme
        workspace.save(ignore_permissions=True)
        print("Workspace saved successfully!")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

    frappe.db.commit()
