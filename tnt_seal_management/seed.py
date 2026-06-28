"""Development seed data for the TNT Seal Management app.

Currently seeds the ``Transport Location`` master with potential truck stops
along the Northern and Central Corridors (Kenya, Uganda, Tanzania, DR Congo,
Rwanda and Burundi). Used as the source list for journey checkpoints.

The seeding is idempotent: each location is only created if it does not
already exist, so it is safe to run on every ``bench migrate``.
"""

import frappe

# (location_name, country, location_type)
TRANSPORT_LOCATIONS = [
	# --- Kenya ---
	("Mombasa Port", "Kenya", "Port"),
	("Mariakani Weighbridge", "Kenya", "Weighbridge"),
	("Mtito Andei", "Kenya", "City/Town"),
	("Voi", "Kenya", "City/Town"),
	("Nairobi ICD (Embakasi)", "Kenya", "Inland Container Depot"),
	("Athi River Weighbridge", "Kenya", "Weighbridge"),
	("Nairobi", "Kenya", "City/Town"),
	("Naivasha ICD", "Kenya", "Inland Container Depot"),
	("Nakuru", "Kenya", "City/Town"),
	("Eldoret", "Kenya", "City/Town"),
	("Kisumu", "Kenya", "City/Town"),
	("Webuye", "Kenya", "City/Town"),
	("Malaba Border (Kenya)", "Kenya", "Border Post"),
	("Busia Border (Kenya)", "Kenya", "Border Post"),
	("Namanga Border (Kenya)", "Kenya", "Border Post"),
	("Isebania Border (Kenya)", "Kenya", "Border Post"),
	# --- Uganda ---
	("Malaba Border (Uganda)", "Uganda", "Border Post"),
	("Busia Border (Uganda)", "Uganda", "Border Post"),
	("Tororo", "Uganda", "City/Town"),
	("Jinja", "Uganda", "City/Town"),
	("Kampala", "Uganda", "City/Town"),
	("Kampala ICD", "Uganda", "Inland Container Depot"),
	("Mbarara", "Uganda", "City/Town"),
	("Katuna Border (Uganda)", "Uganda", "Border Post"),
	("Mirama Hills Border (Uganda)", "Uganda", "Border Post"),
	("Mutukula Border (Uganda)", "Uganda", "Border Post"),
	("Elegu/Nimule Border (Uganda)", "Uganda", "Border Post"),
	("Mpondwe Border (Uganda)", "Uganda", "Border Post"),
	("Bunagana Border (Uganda)", "Uganda", "Border Post"),
	# --- Tanzania ---
	("Dar es Salaam Port", "Tanzania", "Port"),
	("Dar es Salaam ICD", "Tanzania", "Inland Container Depot"),
	("Vigwaza Weighbridge", "Tanzania", "Weighbridge"),
	("Morogoro", "Tanzania", "City/Town"),
	("Dodoma", "Tanzania", "City/Town"),
	("Singida", "Tanzania", "City/Town"),
	("Nzega", "Tanzania", "City/Town"),
	("Isaka Dry Port", "Tanzania", "Inland Container Depot"),
	("Kahama", "Tanzania", "City/Town"),
	("Arusha", "Tanzania", "City/Town"),
	("Rusumo Border (Tanzania)", "Tanzania", "Border Post"),
	("Kabanga Border (Tanzania)", "Tanzania", "Border Post"),
	("Mutukula Border (Tanzania)", "Tanzania", "Border Post"),
	("Namanga Border (Tanzania)", "Tanzania", "Border Post"),
	# --- Rwanda ---
	("Rusumo Border (Rwanda)", "Rwanda", "Border Post"),
	("Kigali", "Rwanda", "City/Town"),
	("Kigali Logistics Platform (Masaka)", "Rwanda", "Inland Container Depot"),
	("Gatuna Border (Rwanda)", "Rwanda", "Border Post"),
	("Kagitumba Border (Rwanda)", "Rwanda", "Border Post"),
	("Rubavu/Gisenyi Border (Rwanda)", "Rwanda", "Border Post"),
	# --- Burundi ---
	("Kobero Border (Burundi)", "Burundi", "Border Post"),
	("Muyinga", "Burundi", "City/Town"),
	("Ngozi", "Burundi", "City/Town"),
	("Gitega", "Burundi", "City/Town"),
	("Bujumbura", "Burundi", "City/Town"),
	# --- DR Congo ---
	("Goma", "DR Congo", "City/Town"),
	("Bukavu", "DR Congo", "City/Town"),
	("Uvira", "DR Congo", "City/Town"),
	("Lubumbashi", "DR Congo", "City/Town"),
]


def seed_transport_locations():
	"""Create any missing Transport Location records. Idempotent."""
	if not frappe.db.table_exists("Transport Location"):
		return

	created = 0
	for location_name, country, location_type in TRANSPORT_LOCATIONS:
		if frappe.db.exists("Transport Location", location_name):
			continue
		frappe.get_doc(
			{
				"doctype": "Transport Location",
				"location_name": location_name,
				"country": country,
				"location_type": location_type,
				"is_active": 1,
			}
		).insert(ignore_permissions=True)
		created += 1

	if created:
		frappe.db.commit()
