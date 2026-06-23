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
				"label": "Pending your approval",
				"filters": {"journey_request_status": "Pending Control Room Approval"},
			},
			{
				"roles": ["Customer Care"],
				"label": "Pending your approval",
				"filters": {"journey_request_status": "Pending CC Approval"},
			},
			{
				"roles": ["Field Technician"],
				"label": "Pending work",
				# Counts from Draft through Pending CC Approval — any stage before
				# the journey actually starts. Only "Journey Ready" (journey
				# started) or a dead end (Rejected/Cancelled) clears the count.
				"filters": {
					"journey_request_status": [
						"not in",
						["Journey Ready", "Rejected", "Cancelled"],
					]
				},
			},
			{
				"roles": ["System Manager", "Management"],
				"label": "Pending requests",
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
				"filters": {"assignment_status": "Pending"},
			},
		],
	},
	"current-customer-list": {
		"doctype": "Customer",
		"rules": [
			{
				"roles": [
					"System Manager",
					"Account Manager",
					"Customer Care",
					"Finance PCB",
					"Management",
					"Operations Control Room",
				],
				"label": "Active customers",
				"filters": {"disabled": 0},
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
