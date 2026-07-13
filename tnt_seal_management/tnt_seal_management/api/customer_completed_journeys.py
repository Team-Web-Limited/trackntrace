"""
Customer-facing Completed Journeys — the portal counterpart of the internal
``completed_journeys`` view (``/app/completed-journeys``).

Reuses the same journey fetching, grouping and per-customer billing summary
logic, but scopes everything to the Customer linked to the logged-in Website
User and strips internal-only billing references. There is no Customer filter
(the customer only ever sees their own account) and no Sales Order generation.
"""

import frappe
from frappe.utils import cint

from tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings import (
	get_customer_for_logged_in_user,
)
from tnt_seal_management.tnt_seal_management.api.completed_journeys import (
	_build_customer_groups,
	_fetch_journeys,
)

# Journey-level fields that reference internal billing artefacts the customer
# portal must not expose.
_INTERNAL_JOURNEY_FIELDS = ("sales_order_reference", "billing_status")

DEFAULT_PAGE_LENGTH = 15


@frappe.whitelist()
def get_customer_completed_journeys(from_date=None, to_date=None, page=1, page_length=DEFAULT_PAGE_LENGTH):
	"""Completed journeys for the logged-in customer, grouped and summarised
	exactly like the internal view but scoped to their own account.

	The billing summary (Normal/Extra/VAT/Total Payable, journey_count) always
	covers every matching journey — only the ``journeys`` table rows are
	paginated, ``page_length`` at a time, via ``pagination`` in the response.

	Shape: {"customers": [...], "grand_total": None, "pagination": {...}}.
	There is always at most one customer group (the caller's own), so
	``grand_total`` stays None."""
	customer = get_customer_for_logged_in_user()
	page = max(cint(page), 1)
	page_length = max(cint(page_length), 1)

	journeys = _fetch_journeys(from_date, to_date, customer)
	data = _build_customer_groups(journeys, customer)

	start = (page - 1) * page_length
	for c in data.get("customers", []):
		for j in c.get("journeys", []):
			for field in _INTERNAL_JOURNEY_FIELDS:
				j.pop(field, None)
		c["journeys"] = c["journeys"][start : start + page_length]

	data["pagination"] = {
		"page": page,
		"page_length": page_length,
		"total": len(journeys),
	}

	return data
