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
				"roles": ["Finance PCB"],
				"label": "Pending your approval",
				"filters": {"journey_status": "Pending Finance PCB Approval"},
			},
			{
				"roles": ["Operations Control Room"],
				"label": "In transit",
				"filters": {"journey_status": "In Transit"},
			},
			{
				"roles": ["System Manager", "Management", "Seal System Administrator"],
				"label": "Active journeys",
				"filters": {
					"journey_status": [
						"not in",
						["Completed", "Cancelled", "Finance PCB Rejected"],
					]
				},
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
				"roles": ["Customer Care"],
				"label": "Tagging approvals",
				"filters": {"journey_request_status": "Pending CC Approval"},
			},
			{
				"roles": ["Field Technician"],
				"label": "Tagging work",
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Pending Control Room Approval",
							"Tagging",
							"Pending CC Approval",
						],
					]
				},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Tagging requests",
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Pending Control Room Approval",
							"Tagging",
							"Pending CC Approval",
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
				"roles": ["Operations Control Room"],
				"label": "Untagging approvals",
				"filters": {"journey_request_status": "Pending Untagging Approval"},
			},
			{
				"roles": ["Field Technician"],
				"label": "Untagging work",
				"filters": {"journey_request_status": "Untagging"},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Untagging requests",
				"filters": {
					"journey_request_status": [
						"in",
						["Untagging", "Pending Untagging Approval"],
					]
				},
			},
		],
	},
	# Second badge on the journey-request card — the seal-return work the FT owns
	# after untagging is approved (see journey_request.submit_seal_return_to_control_room).
	"journey-request-seal-return": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Operations Control Room"],
				"label": "Seal return approvals",
				"filters": {"journey_request_status": "Pending Seal Return Approval"},
			},
			{
				"roles": ["Field Technician"],
				"label": "Seal return work",
				"filters": {
					"journey_request_status": [
						"in",
						["Untagging Approved", "Pending Seal Return Approval"],
					]
				},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Seal return requests",
				"filters": {
					"journey_request_status": [
						"in",
						["Untagging Approved", "Pending Seal Return Approval"],
					]
				},
			},
		],
	},
	"control-room": {
		"doctype": "Journey Request",
		"rules": [
			{
				"roles": ["Operations Control Room", "System Manager", "Management"],
				"label": "Pending your approval",
				# Covers all three gates Control Room owns: the original tagging-stage
				# approval, the untagging-stage approval and the seal-return approval.
				"filters": {
					"journey_request_status": [
						"in",
						[
							"Pending Control Room Approval",
							"Pending Untagging Approval",
							"Pending Seal Return Approval",
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
				"roles": ["Operations Control Room", "System Manager", "Management"],
				"label": "Open alerts",
				"filters": {"is_resolved": 0},
			},
		],
	},
	# Third badge on the Control Room card — Seal Journeys sitting at
	# "In Transit", i.e. the Arrivals section of the Approve tab
	# (get_arrival_queue). Same generic rules system, different doctype/filter.
	"control-room-arrivals": {
		"doctype": "Seal Journey",
		"rules": [
			{
				"roles": ["Operations Control Room", "System Manager", "Management"],
				"label": "Awaiting arrival confirmation",
				"filters": {"journey_status": "In Transit"},
			},
		],
	},
	# Completed-but-unsettled journeys (billing_status "Pending Billing") for
	# Finance PCB to follow up on — opens the Billing Follow-up list page.
	"billing-followup-list": {
		"doctype": "Seal Journey",
		"rules": [
			{
				"roles": ["Finance PCB", "System Manager", "Management"],
				"label": "Unsettled bills",
				"filters": {"billing_status": "Pending Billing"},
			},
		],
	},
	"tagging-booking-list": {
		"doctype": "Tagging Booking",
		"rules": [
			{
				"roles": ["Finance PCB"],
				"label": "Pending your approval",
				"filters": {"booking_status": "Pending Finance PCB Approval"},
			},
			{
				"roles": ["Account Manager"],
				"label": "Your drafts",
				"filters": {"booking_status": "Draft"},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Pending approval",
				"filters": {"booking_status": "Pending Finance PCB Approval"},
			},
		],
	},
	"pcb-job-order-list": {
		"doctype": "PCB Job Order",
		"rules": [
			{
				"roles": ["Finance PCB"],
				"label": "Unassigned",
				"filters": {"job_order_status": "Unassigned"},
			},
			{
				"roles": ["PCB Team Leader"],
				"label": "Assigned to your team",
				"filters": {"job_order_status": "Team Leader Assigned"},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Open job orders",
				"filters": {
					"job_order_status": ["not in", ["Completed", "Cancelled"]]
				},
			},
		],
	},
	"assignment-list": {
		"doctype": "PCB Assignment",
		"rules": [
			{
				"roles": ["PCB Team Leader", "System Manager", "Management"],
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
				"roles": ["PCB Team Leader", "System Manager", "Management"],
				"label": "Awaiting untagging assignment",
				"filters": {
					"request_type": "Untagging",
					"assignment_status": "Awaiting Untagging Assignment",
				},
			},
		],
	},
	"vehicle-list": {
		"doctype": "Vehicle",
		"rules": [
			{
				"roles": ["System Manager", "Management"],
				"label": "Active vehicles",
				"filters": {"vehicle_status": "Active"},
			},
		],
	},
	"List/Physical Warehouse/List": {
		"doctype": "Physical Warehouse",
		"rules": [
			{
				"roles": ["Operations Control Room", "Seal System Administrator", "System Manager", "Management"],
				"label": "Total warehouses",
				"filters": {},
			},
		],
	},
	"seal-device-dashboard": {
		"doctype": "Seal Device",
		"rules": [
			{
				"roles": ["Operations Control Room", "Seal System Administrator"],
				"label": "In journey",
				"filters": {"current_status": "In Journey"},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Available devices",
				"filters": {"current_status": "Available"},
			},
		],
	},
	"seal-acquisition-list": {
		"doctype": "Seal Acquisition",
		"rules": [
			{
				"roles": ["Operations Control Room", "Seal System Administrator", "System Manager", "Management"],
				"label": "Received batches",
				"filters": {"acquisition_status": "Received"},
			},
		],
	},
	"seal-stock-transfer-list": {
		"doctype": "Seal Stock Transfer",
		"rules": [
			{
				"roles": ["Operations Control Room", "Seal System Administrator", "System Manager", "Management"],
				"label": "Pending receipt",
				"filters": {"transfer_status": "In Transit"},
			},
		],
	},
	"seal-billing-rate-list": {
		"doctype": "Seal Billing Rate",
		"rules": [
			{
				"roles": ["System Manager", "Finance PCB", "Management"],
				"label": "Active rates",
				"filters": {"active": 1},
			},
		],
	},
}


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
			count = frappe.db.count(config["doctype"], rule["filters"])
		except Exception:
			# A missing doctype/field should never break the whole dashboard.
			frappe.log_error(
				title="TNT dashboard card count failed",
				message=f"route={route} doctype={config['doctype']}",
			)
			continue

		result[route] = {"count": count, "label": rule["label"]}

	return result


def _first_matching_rule(rules, user_roles):
	for rule in rules:
		if user_roles.intersection(rule["roles"]):
			return rule
	return None
