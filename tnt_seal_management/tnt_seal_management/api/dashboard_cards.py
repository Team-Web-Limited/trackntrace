import frappe

# Role-aware count rules for the TNT Seal Management landing page cards.
#
# Each card (keyed by its dashboard route) maps to a DocType and an ordered
# list of rules. For the logged-in user we pick the FIRST rule whose `roles`
# intersect the user's roles, then count the matching documents. This is what
# makes a card mean different things to different people, e.g. a Tagging
# Bookings card shows "pending your approval" to Finance PCB but "your drafts"
# to an Account Manager.
#
# Order matters: put specific operational roles first and the broad
# oversight roles (Management / System Manager) last as a fallback.

CARD_COUNT_RULES = {
	"seal-journey-list": {
		"doctype": "Seal Journey",
		"rules": [
			{
				"roles": [
					"Finance PCB",
					"Operations Control Room",
					"System Manager",
					"Management",
					"Managing Director",
				],
				"label": "Not completed",
				"filters": {"journey_status": ["!=", "Completed"]},
			},
		],
	},
	"journey-request-list": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Operations Control Room"],
				"label": "Tagging approvals",
				"filters": {"journey_request_status": "Pending Control Room Approval"},
			},
			{
				"roles": ["Field Technician"],
				"label": "Tagging work",
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Draft",
							"Pending Control Room Approval",
							"Tagging",
						],
					]
				},
			},
			{
				"roles": ["System Manager", "Management", "Managing Director", "PCB Team Leader"],
				"label": "Tagging requests",
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Draft",
							"Pending Control Room Approval",
							"Tagging",
						],
					]
				},
			},
		],
	},
	"journey-request-untagging": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Field Technician"],
				"label": "Untagging work",
				"filters": {"journey_request_status": "Untagging"},
			},
			{
				"roles": ["System Manager", "Management", "Managing Director", "PCB Team Leader"],
				"label": "Untagging requests",
				"filters": {
					"journey_request_status": [
						"in",
						["Untagging"],
					]
				},
			},
		],
	},
	# Second badge on the journey-request card — the seal-return work the FT owns
	# after untagging is confirmed (see journey_request.confirm_seal_return).
	"journey-request-seal-return": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Field Technician"],
				"label": "Seal return work",
				"filters": {
					"journey_request_status": [
						"in",
						["Awaiting Seal Return"],
					]
				},
			},
			{
				# The PCB Team Leader's own queue: returns the FT has confirmed and
				# that are waiting on their approval (see approve_seal_return), plus
				# the returns still out in the field.
				"roles": ["System Manager", "Management", "Managing Director", "PCB Team Leader"],
				"label": "Seal return requests",
				"filters": {
					"journey_request_status": [
						"in",
						["Awaiting Seal Return", "Pending Seal Return Approval"],
					]
				},
			},
		],
	},
	"control-room": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Operations Control Room", "System Manager", "Management", "Managing Director"],
				"label": "Pending your approval",
				# Covers the tagging-stage approval gate.
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Pending Control Room Approval",
						],
					]
				},
			},
		],
	},
	# Not a real route — a second, independent badge rendered on the Control
	# Room card alongside the approval count above (see tnt_seal_management.js
	# get_card_html). Kept in this same generic rules system since the count
	# logic (role match -> doctype count) is identical, just a different
	# doctype/filter.
	"control-room-alerts": {
		"doctype": "Seal Alert Log",
		"rules": [
			{
				"roles": ["Operations Control Room", "System Manager", "Management", "Managing Director"],
				"label": "Open alerts",
				# Only alerts on journeys still In Transit; alerts on idle seals or
				# ended journeys aren't the Control Room's live concern.
				"filters": lambda: {"is_resolved": 0, "seal_journey": ["in", _in_transit_journeys() or [""]]},
			},
		],
	},
	# Third badge on the Control Room card — the Arrivals section of the Approve
	# tab (get_arrival_queue): In Transit journeys whose seal has entered the
	# destination geofence. Same generic rules system, different doctype/filter.
	"control-room-arrivals": {
		"doctype": "Seal Journey",
		"rules": [
			{
				"roles": ["Operations Control Room", "System Manager", "Management", "Managing Director"],
				"label": "Awaiting arrival confirmation",
				"filters": lambda: {"name": ["in", _arrival_queue() or [""]]},
			},
		],
	},
	"tagging-booking-list": {
		"doctype": "Tagging Booking",
		"rules": [
			{
				"roles": ["Finance PCB"],
				"label": "Pending your approval",
				"filters": {"system": "PCB", "booking_status": "Pending Finance PCB Approval"},
			},
			{
				"roles": ["Account Manager"],
				"label": "Pending your review",
				"filters": {"system": "PCB", "booking_status": "Pending Account Manager Review"},
			},
			{
				"roles": ["System Manager", "Management", "Managing Director"],
				"label": "Pending approval",
				"filters": {
					"system": "PCB",
					"booking_status": [
						"in",
						["Pending Account Manager Review", "Pending Finance PCB Approval"],
					]
				},
			},
		],
	},
	"tagging-booking-list/rects": {
		"doctype": "Tagging Booking",
		"rules": [
			{
				"roles": ["Finance PCB"],
				"label": "Pending your approval",
				"filters": {"system": "RECTs", "booking_status": "Pending Finance PCB Approval"},
			},
			{
				"roles": ["Account Manager"],
				"label": "Pending your review",
				"filters": {"system": "RECTs", "booking_status": "Pending Account Manager Review"},
			},
			{
				"roles": ["System Manager", "Management", "Managing Director"],
				"label": "Pending approval",
				"filters": {
					"system": "RECTs",
					"booking_status": [
						"in",
						["Pending Account Manager Review", "Pending Finance PCB Approval"],
					]
				},
			},
		],
	},
	"assignment-list": {
		"doctype": "PCB Assignment",
		"rules": [
			{
				"roles": ["PCB Team Leader", "System Manager", "Management", "Managing Director"],
				"label": "Pending assignments",
				"filters": {"request_type": "Tagging", "assignment_status": "Pending"},
			},
		],
	},
	# Second badge on the Assignments card — untagging requests raised on arrival
	# (see pcb_assignment.create_untagging_request). Same generic rules system,
	# scoped to request_type "Untagging".
	"assignment-untagging": {
		"doctype": "PCB Assignment",
		"rules": [
			{
				"roles": ["PCB Team Leader", "System Manager", "Management", "Managing Director"],
				"label": "Awaiting untagging assignment",
				"filters": {
					"request_type": "Untagging",
					"assignment_status": "Pending Untagging Assignment",
				},
			},
		],
	},
	# Third badge on the Assignments card — seal retrieval requests raised when a
	# seal is unlocked remotely at arrival (see
	# pcb_assignment.create_seal_return_request). Untagging is skipped, so the
	# seal still has to be collected from the client. Scoped to request_type
	# "Seal Return".
	"assignment-seal-return": {
		"doctype": "PCB Assignment",
		"rules": [
			{
				"roles": ["PCB Team Leader", "System Manager", "Management", "Managing Director"],
				"label": "Awaiting retrieval assignment",
				"filters": {
					"request_type": "Seal Return",
					"assignment_status": "Pending Seal Return Assignment",
				},
			},
		],
	},
	"vehicle-list": {
		"doctype": "Vehicle",
		"rules": [
			{
				"roles": ["Field Technician", "System Manager", "Management", "Managing Director"],
				"label": "Active vehicles",
				# Only vehicles owned by the customers listed on Customer Billing.
				"filters": lambda: {
					"vehicle_status": "Active",
					"customer": ["in", _billing_customers() or [""]],
				},
			},
		],
	},
	"customer-billing": {
		"doctype": "Customer",
		"rules": [
			{
				"roles": [
					"System Manager",
					"Account Manager",
					"Finance PCB",
					"Management",
					"Managing Director",
				],
				"label": "Customers",
				"filters": lambda: {"name": ["in", _billing_customers() or [""]]},
			},
		],
	},
	# The Warehouses page lists the seal warehouses (Branch ECTS Division or Both)
	# plus live seal holders, so the card counts the active warehouses.
	"warehouse-list": {
		"doctype": "Warehouse",
		"rules": [
			{
				"roles": [
					"Operations Control Room",
					"System Manager",
					"Management",
					"Managing Director",
					"PCB Team Leader",
					"Account Manager",
				],
				"label": "Active warehouses",
				"filters": {"custom_division": ["in", ["ECTS Division", "Both"]], "is_group": 0, "disabled": 0},
			},
			# A tag operator only sees the seals in their own custody.
			{
				"roles": ["Field Technician"],
				"doctype": "Seal Device",
				"label": "Seals I hold",
				"filters": lambda: {
					"current_custody_type": "User",
					"current_custodian": frappe.session.user,
					"in_uffizio": 1,
					"belongs_to": ["!=", "RECTs"],
				},
			},
		],
	},
	# The RECTS dashboard's Warehouses card: same as above for RECTS Division.
	"warehouse-list/rects": {
		"doctype": "Warehouse",
		"rules": [
			{
				"roles": [
					"Operations Control Room",
					"System Manager",
					"Management",
					"Managing Director",
					"PCB Team Leader",
					"Account Manager",
				],
				"label": "Active warehouses",
				"filters": {"custom_division": "RECTS Division", "is_group": 0, "disabled": 0},
			},
			{
				"roles": ["Field Technician"],
				"doctype": "Seal Device",
				"label": "Seals I hold",
				"filters": lambda: {
					"current_custody_type": "User",
					"current_custodian": frappe.session.user,
					"in_uffizio": 1,
					"belongs_to": "RECTs",
				},
			},
		],
	},
	"seal-device-dashboard": {
		"doctype": "Seal Device",
		"rules": [
			{
				"roles": [
					"Operations Control Room",
					"System Manager",
					"Management",
					"Managing Director",
					"PCB Team Leader",
				],
				"label": "Total devices",
				"filters": {"in_uffizio": 1, "belongs_to": ["!=", "RECTs"]},
			},
		],
	},
	# The RECTs dashboard's Seal Device card: only the seals that belong to RECTs.
	"seal-device-dashboard/rects": {
		"doctype": "Seal Device",
		"rules": [
			{
				"roles": [
					"Operations Control Room",
					"System Manager",
					"Management",
					"Managing Director",
					"PCB Team Leader",
				],
				"label": "Total devices",
				"filters": {"in_uffizio": 1, "belongs_to": "RECTs"},
			},
		],
	},
}


def _scoped_to_system(config, system):
	"""Copy of a count config whose every rule only counts ``system`` records."""
	scoped = {**config, "rules": []}
	for rule in config["rules"]:
		filters = rule["filters"]
		if callable(filters):
			scoped["rules"].append({**rule, "filters": lambda f=filters: {**f(), "system": system}})
		else:
			scoped["rules"].append({**rule, "filters": {**filters, "system": system}})
	return scoped


# The Assignments and Journey Request counts are per system: the plain route
# counts PCB, "<route>/rects" counts RECTs (their System is copied from the
# Tagging Booking they came from).
for _route in (
	"assignment-list",
	"assignment-untagging",
	"assignment-seal-return",
	"journey-request-list",
	"journey-request-untagging",
	"journey-request-seal-return",
	"control-room",
	"seal-journey-list",
):
	CARD_COUNT_RULES[f"{_route}/rects"] = _scoped_to_system(CARD_COUNT_RULES[_route], "RECTs")
	CARD_COUNT_RULES[_route] = _scoped_to_system(CARD_COUNT_RULES[_route], "PCB")

# Vehicles are those of the customers on the system's Branch.
CARD_COUNT_RULES["vehicle-list/rects"] = {
	**CARD_COUNT_RULES["vehicle-list"],
	"rules": [
		{**rule, "filters": lambda: {"vehicle_status": "Active", "customer": ["in", _billing_customers("RECTS") or [""]]}}
		for rule in CARD_COUNT_RULES["vehicle-list"]["rules"]
	],
}

# Customer Billing lists the customers ticked for the system's branch.
CARD_COUNT_RULES["customer-billing/rects"] = {
	**CARD_COUNT_RULES["customer-billing"],
	"rules": [
		{**rule, "filters": lambda: {"name": ["in", _billing_customers("RECTS") or [""]]}}
		for rule in CARD_COUNT_RULES["customer-billing"]["rules"]
	],
}

# Arrivals are detected from the seal API's geofence entries, so only PCB has them
# (RECTs confirms arrival by hand from Active Journeys).
CARD_COUNT_RULES["control-room-arrivals"] = _scoped_to_system(CARD_COUNT_RULES["control-room-arrivals"], "PCB")


@frappe.whitelist()
def get_card_counts():
	"""Return {route: {"count": int, "label": str}} for the current user.

	Only routes whose rules match one of the user's roles are returned, so the
	front-end simply renders a badge for whatever it gets back."""
	user_roles = set(frappe.get_roles(frappe.session.user))
	result = {}

	for route, config in CARD_COUNT_RULES.items():
		rule = _first_matching_rule(config["rules"], user_roles)
		if not rule:
			continue

		try:
			filters = rule["filters"]() if callable(rule["filters"]) else rule["filters"]
			count = frappe.db.count(rule.get("doctype") or config["doctype"], filters)
		except Exception:
			# A missing doctype/field should never break the whole dashboard.
			frappe.log_error(
				title="TNT dashboard card count failed",
				message=f"route={route} doctype={rule.get('doctype') or config['doctype']}",
			)
			continue

		result[route] = {"count": count, "label": rule["label"]}

	return result


def _billing_customers(system="TNT"):
	from tnt_seal_management.tnt_seal_management.api.current_customers import get_billing_customer_names

	return get_billing_customer_names(system)


def _in_transit_journeys():
	return frappe.get_all("Seal Journey", filters={"journey_status": "In Transit"}, pluck="name")


def _arrival_queue():
	from tnt_seal_management.tnt_seal_management.api.geofence_arrivals import arrival_queue_journey_names

	return arrival_queue_journey_names()


def _first_matching_rule(rules, user_roles):
	for rule in rules:
		if user_roles.intersection(rule["roles"]):
			return rule
	return None
