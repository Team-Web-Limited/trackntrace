import frappe

def execute():
    # Seal Status History (Child Table)
    if not frappe.db.exists("DocType", "Seal Status History"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal Status History",
            "module": "TNT Seal Management",
            "custom": 0,
            "istable": 1,
            "fields": [
                {"fieldname": "seal", "label": "Seal", "fieldtype": "Data", "in_list_view": 1},
                {"fieldname": "journey", "label": "Journey", "fieldtype": "Link", "options": "Seal Journey", "in_list_view": 1},
                {"fieldname": "previous_status", "label": "Previous Status", "fieldtype": "Data"},
                {"fieldname": "new_status", "label": "New Status", "fieldtype": "Data", "in_list_view": 1},
                {"fieldname": "status_date_time", "label": "Status Date and Time", "fieldtype": "Datetime", "in_list_view": 1},
                {"fieldname": "updated_by", "label": "Updated By", "fieldtype": "Link", "options": "User"},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal Status History")

    # Seal Device
    if not frappe.db.exists("DocType", "Seal Device"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal Device",
            "module": "TNT Seal Management",
            "custom": 0,
            "autoname": "field:seal_number",
            "fields": [
                {"fieldname": "seal_number", "label": "Seal Number", "fieldtype": "Data", "reqd": 1, "unique": 1},
                {"fieldname": "device_id", "label": "Device ID", "fieldtype": "Data", "reqd": 1},
                {"fieldname": "seal_type", "label": "Seal Type", "fieldtype": "Data"},
                {"fieldname": "serial_number", "label": "Serial Number", "fieldtype": "Data"},
                {"fieldname": "current_status", "label": "Current Status", "fieldtype": "Select", "options": "Quality Check\nAvailable\nAssigned\nIn Journey\nArrived\nUntagged\nReturned\nDamaged\nLost\nInactive", "default": "Quality Check", "in_list_view": 1},
                {"fieldname": "condition", "label": "Condition", "fieldtype": "Select", "options": "Good\nDamaged\nLost"},
                
                {"fieldname": "assignment_tab", "label": "Assignment", "fieldtype": "Tab Break"},
                {"fieldname": "current_journey", "label": "Current Journey", "fieldtype": "Link", "options": "Seal Journey", "in_list_view": 1},
                {"fieldname": "current_customer", "label": "Current Customer", "fieldtype": "Link", "options": "Customer"},
                {"fieldname": "current_technician", "label": "Current Technician", "fieldtype": "Link", "options": "User", "in_list_view": 1},
                {"fieldname": "current_vehicle", "label": "Current Vehicle", "fieldtype": "Data"},
                {"fieldname": "current_container", "label": "Current Container", "fieldtype": "Data"},
                {"fieldname": "warehouse_location", "label": "Warehouse/Location", "fieldtype": "Data"},
                
                {"fieldname": "api_tab", "label": "API / Location", "fieldtype": "Tab Break"},
                {"fieldname": "current_location", "label": "Current Location", "fieldtype": "Data"},
                {"fieldname": "last_known_api_location", "label": "Last Known API Location", "fieldtype": "Data"},
                {"fieldname": "last_api_status", "label": "Last API Status", "fieldtype": "Data"},
                {"fieldname": "last_api_sync_time", "label": "Last API Sync Time", "fieldtype": "Datetime"},
                {"fieldname": "battery_level", "label": "Battery Level", "fieldtype": "Data"},
                {"fieldname": "transmission_status", "label": "Transmission Status", "fieldtype": "Data"},
                
                {"fieldname": "lifecycle_tab", "label": "Lifecycle", "fieldtype": "Tab Break"},
                {"fieldname": "date_received", "label": "Date Received", "fieldtype": "Date"},
                {"fieldname": "date_activated", "label": "Date Activated", "fieldtype": "Date"},
                {"fieldname": "date_deactivated", "label": "Date Deactivated", "fieldtype": "Date"},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Text"},
                {"fieldname": "attachments", "label": "Attachments", "fieldtype": "Attach Image"},
                
                {"fieldname": "history_tab", "label": "Status History", "fieldtype": "Tab Break"},
                {"fieldname": "status_history", "label": "Status History", "fieldtype": "Table", "options": "Seal Status History"}
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "Operations Control Room", "read": 1, "write": 1, "create": 1},
                {"role": "Management", "read": 1},
                {"role": "Field Technician", "read": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal Device")

    # Seal API Settings (Single)
    if not frappe.db.exists("DocType", "Seal API Settings"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal API Settings",
            "module": "TNT Seal Management",
            "custom": 0,
            "issingle": 1,
            "fields": [
                {"fieldname": "enabled", "label": "Enabled", "fieldtype": "Check", "default": "0"},
                {"fieldname": "api_base_url", "label": "API Base URL", "fieldtype": "Data"},
                {"fieldname": "authentication_type", "label": "Authentication Type", "fieldtype": "Select", "options": "Token\nBasic Auth\nOAuth"},
                {"fieldname": "api_key_token", "label": "API Key / Token", "fieldtype": "Password"},
                {"fieldname": "username", "label": "Username", "fieldtype": "Data"},
                {"fieldname": "password", "label": "Password", "fieldtype": "Password"},
                {"fieldname": "sync_frequency", "label": "Sync Frequency", "fieldtype": "Data"},
                {"fieldname": "last_sync_date_time", "label": "Last Sync Date and Time", "fieldtype": "Datetime", "read_only": 1},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"}
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1},
                {"role": "Seal System Administrator", "read": 1, "write": 1, "create": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal API Settings")

    # Seal Billing Rate
    if not frappe.db.exists("DocType", "Seal Billing Rate"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal Billing Rate",
            "module": "TNT Seal Management",
            "custom": 0,
            "fields": [
                {"fieldname": "billing_rule_name", "label": "Billing Rule Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
                {"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
                {"fieldname": "first_period_days", "label": "First Period Days", "fieldtype": "Int", "default": "5"},
                {"fieldname": "first_period_amount", "label": "First Period Amount", "fieldtype": "Currency", "default": "1000"},
                {"fieldname": "extra_day_rate", "label": "Extra Day Rate", "fieldtype": "Currency", "default": "500"},
                {"fieldname": "currency", "label": "Currency", "fieldtype": "Link", "options": "Currency", "default": "KES"},
                {"fieldname": "effective_from", "label": "Effective From Date", "fieldtype": "Date"},
                {"fieldname": "effective_to", "label": "Effective To Date", "fieldtype": "Date"},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"}
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "Finance PCB", "read": 1, "write": 1, "create": 1},
                {"role": "Management", "read": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal Billing Rate")
        
    frappe.db.commit()
