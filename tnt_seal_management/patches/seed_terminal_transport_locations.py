import frappe

from tnt_seal_management.seed_guard import seeding_allowed

# The old Journey Request Origin/Destination Select field had this fixed list
# of options. Journey Request.origin/destination are now Links to Transport
# Location, so existing documents need a matching Transport Location record
# (marked as a Terminal) to keep resolving correctly.
LEGACY_TERMINALS = [
	("Mombasa Port, Kenya", "Kenya", "Port"),
	("Nairobi ICD, Kenya", "Kenya", "Inland Container Depot"),
	("Eldoret, Kenya", "Kenya", "City/Town"),
	("Kisumu, Kenya", "Kenya", "City/Town"),
	("Malaba Border, Kenya/Uganda", "Kenya", "Border Post"),
	("Busia Border, Kenya/Uganda", "Kenya", "Border Post"),
	("Namanga Border, Kenya/Tanzania", "Kenya", "Border Post"),
	("Isebania Border, Kenya/Tanzania", "Kenya", "Border Post"),
	("Moyale Border, Kenya/Ethiopia", "Kenya", "Border Post"),
	("Kampala, Uganda", "Uganda", "City/Town"),
	("Mbarara, Uganda", "Uganda", "City/Town"),
	("Mutukula Border, Uganda/Tanzania", "Uganda", "Border Post"),
	("Nimule Border, Uganda/South Sudan", "Uganda", "Border Post"),
	("Dar es Salaam Port, Tanzania", "Tanzania", "Port"),
	("Dar es Salaam ICD, Tanzania", "Tanzania", "Inland Container Depot"),
	("Arusha, Tanzania", "Tanzania", "City/Town"),
	("Kigali, Rwanda", "Rwanda", "City/Town"),
	("Rusumo Border, Rwanda/Tanzania", "Rwanda", "Border Post"),
	("Juba, South Sudan", "South Sudan", "City/Town"),
	("Addis Ababa, Ethiopia", "Ethiopia", "City/Town"),
]


def execute():
	# Seed data — never runs on production. See tnt_seal_management.seed_guard.
	if not seeding_allowed():
		return

	for location_name, country, location_type in LEGACY_TERMINALS:
		if frappe.db.exists("Transport Location", location_name):
			continue

		frappe.get_doc(
			{
				"doctype": "Transport Location",
				"location_name": location_name,
				"location_role": "Terminal",
				"country": country,
				"location_type": location_type,
			}
		).insert(ignore_permissions=True)

	frappe.db.commit()
