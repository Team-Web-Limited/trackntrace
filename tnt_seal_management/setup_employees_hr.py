import frappe

def execute():
    employees = [
        {"first": "James", "last": "Karanja", "email": "james.karanja@tnt-seal.co.ke", "gender": "Male", "dob": "1985-03-15", "doj": "2022-01-10", "designation": "General Manager"},
        {"first": "Grace", "last": "Wanjiku", "email": "grace.wanjiku@tnt-seal.co.ke", "gender": "Female", "dob": "1988-07-22", "doj": "2022-03-01", "designation": "Operations Director"},

        {"first": "Peter", "last": "Odhiambo", "email": "peter.odhiambo@tnt-seal.co.ke", "gender": "Male", "dob": "1990-11-05", "doj": "2023-02-15", "designation": "Finance Officer"},
        {"first": "Mercy", "last": "Chebet", "email": "mercy.chebet@tnt-seal.co.ke", "gender": "Female", "dob": "1992-04-18", "doj": "2023-06-01", "designation": "Finance Officer"},

        {"first": "Daniel", "last": "Mwangi", "email": "daniel.mwangi@tnt-seal.co.ke", "gender": "Male", "dob": "1991-09-12", "doj": "2023-01-20", "designation": "Control Room Operator"},
        {"first": "Faith", "last": "Akinyi", "email": "faith.akinyi@tnt-seal.co.ke", "gender": "Female", "dob": "1993-01-30", "doj": "2023-04-10", "designation": "Control Room Operator"},
        {"first": "Brian", "last": "Kipchoge", "email": "brian.kipchoge@tnt-seal.co.ke", "gender": "Male", "dob": "1989-06-25", "doj": "2022-11-05", "designation": "Control Room Supervisor"},

        {"first": "Samuel", "last": "Njoroge", "email": "samuel.njoroge@tnt-seal.co.ke", "gender": "Male", "dob": "1987-02-14", "doj": "2022-05-15", "designation": "PCB Team Leader"},
        {"first": "Alice", "last": "Mutua", "email": "alice.mutua@tnt-seal.co.ke", "gender": "Female", "dob": "1990-08-08", "doj": "2023-01-08", "designation": "PCB Team Leader"},
        {"first": "Joseph", "last": "Otieno", "email": "joseph.otieno@tnt-seal.co.ke", "gender": "Male", "dob": "1986-12-20", "doj": "2022-07-01", "designation": "PCB Team Leader"},

        {"first": "Kevin", "last": "Kamau", "email": "kevin.kamau@tnt-seal.co.ke", "gender": "Male", "dob": "1995-05-10", "doj": "2024-01-15", "designation": "Field Technician"},
        {"first": "Sarah", "last": "Wambui", "email": "sarah.wambui@tnt-seal.co.ke", "gender": "Female", "dob": "1996-10-03", "doj": "2024-03-01", "designation": "Field Technician"},
        {"first": "Patrick", "last": "Kibet", "email": "patrick.kibet@tnt-seal.co.ke", "gender": "Male", "dob": "1994-07-17", "doj": "2023-09-20", "designation": "Field Technician"},
        {"first": "Diana", "last": "Nyambura", "email": "diana.nyambura@tnt-seal.co.ke", "gender": "Female", "dob": "1997-03-28", "doj": "2024-06-01", "designation": "Field Technician"},

        {"first": "Martin", "last": "Kiptoo", "email": "martin.kiptoo@tnt-seal.co.ke", "gender": "Male", "dob": "1988-11-11", "doj": "2022-02-01", "designation": "System Administrator"},
    ]

    company = "TNT"

    # Ensure Gender records exist
    for g in ["Male", "Female"]:
        if not frappe.db.exists("Gender", g):
            frappe.get_doc({"doctype": "Gender", "gender": g}).insert(ignore_permissions=True)

    # Ensure Designation records exist
    designations = set(e["designation"] for e in employees)
    for d in designations:
        if not frappe.db.exists("Designation", d):
            frappe.get_doc({"doctype": "Designation", "designation_name": d}).insert(ignore_permissions=True)
            print(f"Created Designation: {d}")

    for emp in employees:
        email = emp["email"]
        if frappe.db.exists("Employee", {"user_id": email}):
            print(f"Employee already exists for: {email}")
            continue

        doc = frappe.get_doc({
            "doctype": "Employee",
            "first_name": emp["first"],
            "last_name": emp["last"],
            "employee_name": f"{emp['first']} {emp['last']}",
            "user_id": email,
            "gender": emp["gender"],
            "date_of_birth": emp["dob"],
            "date_of_joining": emp["doj"],
            "designation": emp["designation"],
            "company": company,
            "status": "Active"
        })
        doc.insert(ignore_permissions=True)
        print(f"Created Employee: {emp['first']} {emp['last']} — {emp['designation']}")

    frappe.db.commit()
    print("\nDone! Employee records created.")
