"""Give existing vehicles an owner (Vehicle.customer).

Vehicle.customer is new and mandatory, and bookings only offer the client's own
vehicles. Sources, in order:

1. The legacy party_type/party_name custom fields (from ERPNext's Vehicle),
   where the party is a Customer — the owner already on record.
2. Booking history: a vehicle only ever booked (Tagging Booking) or requested
   (Journey Request) for a single client gets that client.

Anything else is left blank for the team to assign.
"""

import frappe


def execute():
	if frappe.db.has_column("Vehicle", "party_name") and frappe.db.has_column("Vehicle", "party_type"):
		frappe.db.sql(
			"""
			update `tabVehicle` v
			inner join `tabCustomer` c on c.name = v.party_name
			set v.customer = v.party_name
			where v.party_type = 'Customer' and ifnull(v.customer, '') = ''
			"""
		)

	clients_by_vehicle = {}
	for vehicle, client in frappe.db.sql(
		"""
		select tbv.vehicle, tb.client_name
		from `tabTagging Booking Vehicle` tbv
		inner join `tabTagging Booking` tb on tb.name = tbv.parent
		where tbv.parenttype = 'Tagging Booking' and ifnull(tb.client_name, '') != ''
		union
		select jrv.vehicle, jr.client_name
		from `tabJourney Request Vehicle` jrv
		inner join `tabJourney Request` jr on jr.name = jrv.parent
		where jrv.parenttype = 'Journey Request' and ifnull(jr.client_name, '') != ''
		"""
	):
		if vehicle:
			clients_by_vehicle.setdefault(vehicle, set()).add(client)

	for vehicle, clients in clients_by_vehicle.items():
		if len(clients) != 1:
			continue
		if frappe.db.exists("Vehicle", vehicle) and not frappe.db.get_value("Vehicle", vehicle, "customer"):
			frappe.db.set_value("Vehicle", vehicle, "customer", clients.pop(), update_modified=False)
