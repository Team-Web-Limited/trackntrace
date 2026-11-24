# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class SeatFeeChange(Document):
	"""A new seat count / rate for a customer's recurring seat fee, waiting for
	their paid-through date. Seat fees are paid in advance, so a change never
	applies mid-period: it starts the day after the period already paid for (see
	api.seal_lease_billing.apply_due_seat_fee_changes)."""
