import frappe

def execute():
    employees = [
        # Management (2)
        {"first": "James", "last": "Karanja", "email": "james.karanja@tnt-seal.co.ke", "roles": ["Management"]},
        {"first": "Grace", "last": "Wanjiku", "email": "grace.wanjiku@tnt-seal.co.ke", "roles": ["Management"]},

        # Finance PCB (2)
        {"first": "Peter", "last": "Odhiambo", "email": "peter.odhiambo@tnt-seal.co.ke", "roles": ["Finance PCB"]},
        {"first": "Mercy", "last": "Chebet", "email": "mercy.chebet@tnt-seal.co.ke", "roles": ["Finance PCB"]},

        # Operations Control Room (3)
        {"first": "Daniel", "last": "Mwangi", "email": "daniel.mwangi@tnt-seal.co.ke", "roles": ["Operations Control Room"]},
        {"first": "Faith", "last": "Akinyi", "email": "faith.akinyi@tnt-seal.co.ke", "roles": ["Operations Control Room"]},
        {"first": "Brian", "last": "Kipchoge", "email": "brian.kipchoge@tnt-seal.co.ke", "roles": ["Operations Control Room"]},

        # PCB Team Leader (3)
        {"first": "Samuel", "last": "Njoroge", "email": "samuel.njoroge@tnt-seal.co.ke", "roles": ["PCB Team Leader"]},
        {"first": "Alice", "last": "Mutua", "email": "alice.mutua@tnt-seal.co.ke", "roles": ["PCB Team Leader"]},
        {"first": "Joseph", "last": "Otieno", "email": "joseph.otieno@tnt-seal.co.ke", "roles": ["PCB Team Leader"]},

        # Field Technician (4)
        {"first": "Kevin", "last": "Kamau", "email": "kevin.kamau@tnt-seal.co.ke", "roles": ["Field Technician"]},
        {"first": "Sarah", "last": "Wambui", "email": "sarah.wambui@tnt-seal.co.ke", "roles": ["Field Technician"]},
        {"first": "Patrick", "last": "Kibet", "email": "patrick.kibet@tnt-seal.co.ke", "roles": ["Field Technician"]},
        {"first": "Diana", "last": "Nyambura", "email": "diana.nyambura@tnt-seal.co.ke", "roles": ["Field Technician"]},

        {"first": "Martin", "last": "Kiptoo", "email": "martin.kiptoo@tnt-seal.co.ke", "roles": ["Operations Control Room"]},
    ]

    for emp in employees:
        email = emp["email"]
        if frappe.db.exists("User", email):
            print(f"User already exists: {email}")
            continue

        user = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": emp["first"],
            "last_name": emp["last"],
            "enabled": 1,
            "user_type": "System User",
            "send_welcome_email": 0,
            "new_password": "Tnt@2026!"
        })

        for role_name in emp["roles"]:
            user.append("roles", {"role": role_name})

        user.insert(ignore_permissions=True)
        print(f"Created: {emp['first']} {emp['last']} ({email}) — {', '.join(emp['roles'])}")

    frappe.db.commit()
    print("\nDone! 15 users created.")
