import frappe

def execute():
    actions = [
        "Submit for Approval",
        "Approve",
        "Reject",
        "Assign Team Lead",
        "Assign Technician",
        "Start Pre-Tagging",
        "Book Tagging Request",
        "Start Tagging",
        "Complete Tagging",
        "Start Post-Tagging",
        "Mark Ready for Journey",
        "Start Journey",
        "Mark Arrived",
        "Start Untagging",
        "Complete Untagging",
        "Complete Journey"
    ]
    
    for a in actions:
        if not frappe.db.exists("Workflow Action Master", a):
            frappe.get_doc({
                "doctype": "Workflow Action Master",
                "workflow_action_name": a
            }).insert(ignore_permissions=True)
            print(f"Created Workflow Action Master: {a}")

    if not frappe.db.exists("Workflow", "Seal Journey Workflow"):
        workflow = frappe.get_doc({
            "doctype": "Workflow",
            "workflow_name": "Seal Journey Workflow",
            "document_type": "Seal Journey",
            "is_active": 1,
            "send_email_alert": 0,
            "states": [
                {"state": "Draft", "doc_status": 0, "allow_edit": "All"},
                {"state": "Pending Finance PCB Approval", "doc_status": 0, "allow_edit": "Finance PCB"},
                {"state": "Finance PCB Approved", "doc_status": 1, "allow_edit": "PCB Team Leader"},
                {"state": "Finance PCB Rejected", "doc_status": 0, "allow_edit": "All"},
                {"state": "Team Lead Assigned", "doc_status": 1, "allow_edit": "PCB Team Leader"},
                {"state": "Technician Assigned", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "Pre-Tagging", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "Tagging Request Booked", "doc_status": 1, "allow_edit": "Field Technician"},
                {"state": "Tagging In Progress", "doc_status": 1, "allow_edit": "Field Technician"},
                {"state": "Tagged", "doc_status": 1, "allow_edit": "Field Technician"},
                {"state": "Post-Tagging", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "Ready for Journey", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "In Transit", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "Arrived", "doc_status": 1, "allow_edit": "Field Technician"},
                {"state": "Untagging In Progress", "doc_status": 1, "allow_edit": "Field Technician"},
                {"state": "Untagged", "doc_status": 1, "allow_edit": "Operations Control Room"},
                {"state": "Completed", "doc_status": 1, "allow_edit": "Management"},
                {"state": "Cancelled", "doc_status": 2, "allow_edit": "Management"}
            ],
            "transitions": [
                {"state": "Draft", "action": "Submit for Approval", "next_state": "Pending Finance PCB Approval", "allowed": "All"},
                {"state": "Pending Finance PCB Approval", "action": "Approve", "next_state": "Finance PCB Approved", "allowed": "Finance PCB"},
                {"state": "Pending Finance PCB Approval", "action": "Reject", "next_state": "Finance PCB Rejected", "allowed": "Finance PCB"},
                {"state": "Finance PCB Approved", "action": "Assign Team Lead", "next_state": "Team Lead Assigned", "allowed": "Finance PCB"},
                {"state": "Team Lead Assigned", "action": "Assign Technician", "next_state": "Technician Assigned", "allowed": "PCB Team Leader"},
                {"state": "Technician Assigned", "action": "Start Pre-Tagging", "next_state": "Pre-Tagging", "allowed": "Operations Control Room"},
                {"state": "Pre-Tagging", "action": "Book Tagging Request", "next_state": "Tagging Request Booked", "allowed": "Operations Control Room"},
                {"state": "Tagging Request Booked", "action": "Start Tagging", "next_state": "Tagging In Progress", "allowed": "Field Technician"},
                {"state": "Tagging In Progress", "action": "Complete Tagging", "next_state": "Tagged", "allowed": "Field Technician"},
                {"state": "Tagged", "action": "Start Post-Tagging", "next_state": "Post-Tagging", "allowed": "Field Technician"},
                {"state": "Post-Tagging", "action": "Mark Ready for Journey", "next_state": "Ready for Journey", "allowed": "Operations Control Room"},
                {"state": "Ready for Journey", "action": "Start Journey", "next_state": "In Transit", "allowed": "Operations Control Room"},
                {"state": "In Transit", "action": "Mark Arrived", "next_state": "Arrived", "allowed": "Operations Control Room"},
                {"state": "Arrived", "action": "Start Untagging", "next_state": "Untagging In Progress", "allowed": "Field Technician"},
                {"state": "Untagging In Progress", "action": "Complete Untagging", "next_state": "Untagged", "allowed": "Field Technician"},
                {"state": "Untagged", "action": "Complete Journey", "next_state": "Completed", "allowed": "Operations Control Room"}
            ]
        })
        workflow.insert(ignore_permissions=True)
        print("Created Seal Journey Workflow")
    
    frappe.db.commit()
