import frappe

def execute():
    # Roles
    roles = [
        "Finance PCB", "Account Manager", "PCB Team Leader", "Field Technician",
        "Operations Control Room", "Management"
    ]
    for r in roles:
        if not frappe.db.exists("Role", r):
            frappe.get_doc({
                "doctype": "Role",
                "role_name": r,
                "desk_access": 1
            }).insert(ignore_permissions=True)
            print(f"Created role {r}")

    # Seal Trip Photo (Child Table)
    if not frappe.db.exists("DocType", "Seal Trip Photo"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal Trip Photo",
            "module": "TNT Seal Management",
            "custom": 0,
            "istable": 1,
            "fields": [
                {"fieldname": "photo_type", "label": "Photo Type", "fieldtype": "Select", "options": "Pre-Tagging\nTagging\nPost-Tagging\nArrival\nUntagging\nDamage\nOther", "in_list_view": 1, "reqd": 1},
                {"fieldname": "photo_attachment", "label": "Photo Attachment", "fieldtype": "Attach Image", "in_list_view": 1, "reqd": 1},
                {"fieldname": "uploaded_by", "label": "Uploaded By", "fieldtype": "Link", "options": "User", "default": "Administrator", "read_only": 1},
                {"fieldname": "upload_date_time", "label": "Upload Date and Time", "fieldtype": "Datetime", "default": "Now", "read_only": 1},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Small Text"},
                {"fieldname": "related_seal", "label": "Related Seal", "fieldtype": "Data"}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal Trip Photo")
        
    # Tagging Request
    if not frappe.db.exists("DocType", "Tagging Request"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Tagging Request",
            "module": "TNT Seal Management",
            "custom": 0,
            "autoname": "format:TR-{YYYY}-{MM}-{#####}",
            "fields": [
                {"fieldname": "journey_reference", "label": "Journey Reference", "fieldtype": "Data"},
                {"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
                {"fieldname": "vehicle_plate_number", "label": "Vehicle Plate Number", "fieldtype": "Data"},
                {"fieldname": "container_number", "label": "Container Number", "fieldtype": "Data"},
                {"fieldname": "origin", "label": "Origin", "fieldtype": "Data"},
                {"fieldname": "destination", "label": "Destination", "fieldtype": "Data"},
                {"fieldname": "seal", "label": "Seal", "fieldtype": "Data"},
                {"fieldname": "technician", "label": "Technician", "fieldtype": "Link", "options": "User"},
                {"fieldname": "requested_tagging_date_time", "label": "Requested Tagging Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "actual_tagging_date_time", "label": "Actual Tagging Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "tagging_location", "label": "Tagging Location", "fieldtype": "Data"},
                {"fieldname": "booking_status", "label": "Booking Status", "fieldtype": "Select", "options": "Pending\nIn Progress\nCompleted\nCancelled"},
                {"fieldname": "tagging_status", "label": "Tagging Status", "fieldtype": "Select", "options": "Pending\nCompleted"},
                {"fieldname": "photos", "label": "Photos", "fieldtype": "Table", "options": "Seal Trip Photo"},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Text"}
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "Operations Control Room", "read": 1, "write": 1, "create": 1},
                {"role": "Field Technician", "read": 1, "write": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Tagging Request")

    # Seal Journey
    if not frappe.db.exists("DocType", "Seal Journey"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Seal Journey",
            "module": "TNT Seal Management",
            "custom": 0,
            "autoname": "format:SJ-{YYYY}-{MM}-{#####}",
            "fields": [
                {"fieldname": "journey_details_tab", "label": "Journey Details", "fieldtype": "Tab Break"},
                {"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer", "reqd": 1, "in_list_view": 1},
                {"fieldname": "sales_order_reference", "label": "Sales Order Reference", "fieldtype": "Data"},
                {"fieldname": "journey_status", "label": "Journey Status", "fieldtype": "Select", "options": "Draft\nPending Finance PCB Approval\nFinance PCB Approved\nFinance PCB Rejected\nTeam Lead Assigned\nTechnician Assigned\nPre-Tagging\nTagging Request Booked\nTagging In Progress\nTagged\nPost-Tagging\nReady for Journey\nIn Transit\nArrived\nUntagging In Progress\nUntagged\nCompleted\nCancelled", "default": "Draft", "in_list_view": 1},
                {"fieldname": "workflow_state", "label": "Workflow State", "fieldtype": "Data", "read_only": 1},
                
                {"fieldname": "client_and_transport_details_tab", "label": "Transport Details", "fieldtype": "Tab Break"},
                {"fieldname": "vehicle_plate_number", "label": "Vehicle Plate Number", "fieldtype": "Data", "in_list_view": 1},
                {"fieldname": "container_number", "label": "Container Number", "fieldtype": "Data", "in_list_view": 1},
                {"fieldname": "origin", "label": "Origin", "fieldtype": "Data"},
                {"fieldname": "destination", "label": "Destination", "fieldtype": "Data"},
                {"fieldname": "driver_name", "label": "Driver Name", "fieldtype": "Data"},
                {"fieldname": "driver_phone", "label": "Driver Phone", "fieldtype": "Data"},
                {"fieldname": "transporter", "label": "Transporter", "fieldtype": "Data"},
                {"fieldname": "cargo_description", "label": "Cargo Description", "fieldtype": "Small Text"},
                
                {"fieldname": "approval_tab", "label": "Approval", "fieldtype": "Tab Break"},
                {"fieldname": "finance_pcb_approval_status", "label": "Finance PCB Approval Status", "fieldtype": "Select", "options": "Pending\nApproved\nRejected", "default": "Pending"},
                {"fieldname": "finance_pcb_approver", "label": "Finance PCB Approver", "fieldtype": "Link", "options": "User", "read_only": 1},
                {"fieldname": "finance_pcb_approval_date_time", "label": "Finance PCB Approval Date and Time", "fieldtype": "Datetime", "read_only": 1},
                {"fieldname": "finance_pcb_remarks", "label": "Finance PCB Remarks", "fieldtype": "Small Text"},
                
                {"fieldname": "assignment_tab", "label": "Assignment", "fieldtype": "Tab Break"},
                {"fieldname": "assigned_team_lead", "label": "Assigned Team Lead", "fieldtype": "Link", "options": "User"},
                {"fieldname": "team_lead_assignment_date_time", "label": "Team Lead Assignment Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "assigned_technician", "label": "Assigned Technician", "fieldtype": "Link", "options": "User"},
                {"fieldname": "technician_assignment_date_time", "label": "Technician Assignment Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "technician_status", "label": "Technician Status", "fieldtype": "Data"},
                
                {"fieldname": "pre_tagging_tab", "label": "Pre-Tagging", "fieldtype": "Tab Break"},
                {"fieldname": "proposed_seal", "label": "Proposed Seal", "fieldtype": "Data"},
                {"fieldname": "expected_tagging_location", "label": "Expected Tagging Location", "fieldtype": "Data"},
                {"fieldname": "expected_tagging_date_time", "label": "Expected Tagging Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "pre_tagging_checklist", "label": "Pre-Tagging Checklist", "fieldtype": "Table", "options": "Pre Tagging Checklist Item"},
                {"fieldname": "pre_tagging_status", "label": "Pre-Tagging Status", "fieldtype": "Select", "options": "Pending\nCompleted", "default": "Pending"},
                {"fieldname": "pre_tagging_remarks", "label": "Pre-Tagging Remarks", "fieldtype": "Small Text"},
                
                {"fieldname": "tagging_request_tab", "label": "Tagging Request", "fieldtype": "Tab Break"},
                {"fieldname": "tagging_request_reference", "label": "Tagging Request Reference", "fieldtype": "Link", "options": "Tagging Request"},
                {"fieldname": "assigned_seal", "label": "Assigned Seal", "fieldtype": "Data"},
                
                {"fieldname": "tagging_details_tab", "label": "Tagging Details", "fieldtype": "Tab Break"},
                {"fieldname": "tagging_status", "label": "Tagging Status", "fieldtype": "Select", "options": "Pending\nIn Progress\nCompleted", "default": "Pending"},
                {"fieldname": "tagging_date_time", "label": "Tagging Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "tagging_remarks", "label": "Tagging Remarks", "fieldtype": "Small Text"},
                
                {"fieldname": "photo_evidence_tab", "label": "Photo Evidence", "fieldtype": "Tab Break"},
                {"fieldname": "photos", "label": "Seal Trip Photos", "fieldtype": "Table", "options": "Seal Trip Photo"},
                
                {"fieldname": "post_tagging_tab", "label": "Post-Tagging", "fieldtype": "Tab Break"},
                {"fieldname": "seal_attached_confirmation", "label": "Seal Attached Confirmation", "fieldtype": "Check"},
                {"fieldname": "post_tagging_status", "label": "Post-Tagging Status", "fieldtype": "Select", "options": "Pending\nCompleted", "default": "Pending"},
                {"fieldname": "post_tagging_date_time", "label": "Post-Tagging Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "journey_readiness", "label": "Journey Readiness", "fieldtype": "Check"},
                {"fieldname": "departure_readiness_remarks", "label": "Departure Readiness Remarks", "fieldtype": "Small Text"},
                
                {"fieldname": "transit_tracking_tab", "label": "Transit / API Tracking", "fieldtype": "Tab Break"},
                {"fieldname": "journey_start_date_time", "label": "Journey Start Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "departure_confirmation", "label": "Departure Confirmation", "fieldtype": "Check"},
                {"fieldname": "in_transit_status", "label": "In Transit Status", "fieldtype": "Data"},
                {"fieldname": "current_seal_status", "label": "Current Seal Status", "fieldtype": "Data"},
                {"fieldname": "control_room_remarks", "label": "Control Room Remarks", "fieldtype": "Small Text"},
                
                {"fieldname": "api_device_status", "label": "API Device Status", "fieldtype": "Data"},
                {"fieldname": "api_device_location", "label": "API Device Location", "fieldtype": "Data"},
                {"fieldname": "api_latitude", "label": "API Latitude", "fieldtype": "Data"},
                {"fieldname": "api_longitude", "label": "API Longitude", "fieldtype": "Data"},
                {"fieldname": "api_last_update_time", "label": "API Last Update Time", "fieldtype": "Datetime"},
                {"fieldname": "api_battery_level", "label": "API Battery Level", "fieldtype": "Data"},
                
                {"fieldname": "arrival_tab", "label": "Arrival", "fieldtype": "Tab Break"},
                {"fieldname": "arrival_date_time", "label": "Arrival Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "arrival_location", "label": "Arrival Location", "fieldtype": "Data"},
                {"fieldname": "arrival_remarks", "label": "Arrival Remarks", "fieldtype": "Small Text"},
                {"fieldname": "untagging_started_date_time", "label": "Untagging Started Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "untagging_status", "label": "Untagging Status", "fieldtype": "Select", "options": "Pending\nIn Progress\nCompleted", "default": "Pending"},
                {"fieldname": "untagging_completed_date_time", "label": "Untagging Completed Date and Time", "fieldtype": "Datetime"},
                {"fieldname": "untagging_confirmation", "label": "Untagging Confirmation", "fieldtype": "Check"},
                {"fieldname": "seal_unlocked_confirmation", "label": "Seal Unlocked Confirmation", "fieldtype": "Check"},
                
                {"fieldname": "seal_return_tab", "label": "Seal Return", "fieldtype": "Tab Break"},
                {"fieldname": "seal_condition_after_journey", "label": "Seal Condition After Journey", "fieldtype": "Select", "options": "Good\nDamaged\nLost"},
                {"fieldname": "completion_date_time", "label": "Completion Date and Time", "fieldtype": "Datetime"},
                
                {"fieldname": "billing_tab", "label": "Billing", "fieldtype": "Tab Break"},
                {"fieldname": "billing_status", "label": "Billing Status", "fieldtype": "Select", "options": "Not Billed\nPending Billing\nBilled\nCancelled"},
                {"fieldname": "total_charge", "label": "Total Charge", "fieldtype": "Currency"},
                
                {"fieldname": "logs_attachments_tab", "label": "Logs and Attachments", "fieldtype": "Tab Break"},
                {"fieldname": "remarks", "label": "Remarks", "fieldtype": "Text"}
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "Finance PCB", "read": 1, "write": 1},
                {"role": "PCB Team Leader", "read": 1, "write": 1},
                {"role": "Operations Control Room", "read": 1, "write": 1, "create": 1},
                {"role": "Field Technician", "read": 1, "write": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created Seal Journey")

    # Update Tagging Request to link to Seal Journey
    if frappe.db.exists("DocType", "Tagging Request") and frappe.db.exists("DocType", "Seal Journey"):
        doc = frappe.get_doc("DocType", "Tagging Request")
        for f in doc.fields:
            if f.fieldname == "journey_reference":
                f.fieldtype = "Link"
                f.options = "Seal Journey"
        doc.save(ignore_permissions=True)
        print("Updated Tagging Request with Seal Journey Link")
        
    frappe.db.commit()
