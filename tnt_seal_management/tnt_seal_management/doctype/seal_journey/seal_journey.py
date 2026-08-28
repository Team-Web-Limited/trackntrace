# Copyright (c) 2026, teamweb and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt
from frappe.utils.data import cstr
from frappe.utils import get_datetime, getdate, now_datetime, today
from frappe.desk.search import validate_and_sanitize_search_inputs

from tnt_seal_management.tnt_seal_management.billing import (
	ACTIVE_JOURNEY_STATUSES,
	BILLABLE_JOURNEY_STATUSES,
	apply_billing_overrides,
	compute_billing_amount,
	resolve_customer_billing,
	resolve_customer_extra_billing,
)
from tnt_seal_management.tnt_seal_management.api.seal_lease_billing import (
	customer_has_seat_subscription,
)

# Statuses the billing engine must not overwrite — they are set by a human /
# finance action and represent a finalized state.
TERMINAL_BILLING_STATUSES = ("Billed", "Cancelled")

ARRIVAL_CONFIRMATION_FIELDS = ("untagging_confirmation", "seal_unlocked_confirmation", "arrival_remarks")
_ARRIVAL_FIELD_LABELS = {
	"untagging_confirmation": "Untagging Confirmation",
	"seal_unlocked_confirmation": "Seal Unlocked Confirmation",
	"arrival_remarks": "Arrival Remarks",
}

DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS = [
	"Confirm seal device is physically available",
	"Inspect seal body for visible damage",
	"Verify battery level is sufficient",
	"Confirm assigned vehicle details are correct",
	"Capture pre-tagging photo evidence",
]


def _format_duration(total_seconds):
	"""Human-readable elapsed time for days_taken_display: hours while under a
	full day, otherwise whole days plus any leftover hours."""
	hours = total_seconds / 3600
	if hours < 24:
		return _("{0} hrs").format(flt(hours, 1))

	days = int(hours // 24)
	remaining_hours = flt(hours % 24, 1)
	day_label = _("day") if days == 1 else _("days")
	if remaining_hours <= 0:
		return f"{days} {day_label}"
	return _("{0} {1} {2} hrs").format(days, day_label, remaining_hours)


class SealJourney(Document):
	def before_insert(self):
		self.ensure_pre_tagging_checklist()

	def onload(self):
		self.refresh_mirror_fields()
		self.refresh_pre_tagging_mirror()

	def validate(self):
		self.set_days_taken()
		self.set_billing()
		self.enforce_arrival_field_locks()
		self.enforce_untagging_irreversible()

	def refresh_mirror_fields(self):
		"""Re-pull the detail (mirror) fields from the source chain every time the
		journey is opened, so the form always reflects the latest source values even
		when no status transition has fired. Applies values to the in-memory doc
		(for display) and persists them without bumping ``modified`` so it never
		triggers a timestamp conflict on the next save. Never touches
		``journey_status`` or the child tables — same contract as
		``sync_seal_journey_mirror``."""
		if self.is_new():
			return

		values = resolve_seal_journey_mirror_values(self.name)
		if not values:
			return

		changed = {}
		for field, value in values.items():
			if self.get(field) != value:
				self.set(field, value)
				changed[field] = value

		if changed:
			frappe.db.set_value("Seal Journey", self.name, changed, update_modified=False)

	def refresh_pre_tagging_mirror(self):
		if not self.journey_request:
			return
		snapshot = resolve_pre_tagging_snapshot(self.journey_request)
		if snapshot:
			apply_pre_tagging_snapshot(self, snapshot)

	def ensure_pre_tagging_checklist(self):
		if self.pre_tagging_checklist:
			return

		for item in get_pre_tagging_checklist_items():
			self.append("pre_tagging_checklist", {"checklist_item": item, "completed": 0})

	def set_days_taken(self):
		"""Elapsed days from journey start to completion — or, before completion
		is known, to arrival. This lets the figure mean something as soon as the
		seal is confirmed unlocked at arrival (confirm_arrival sets
		arrival_date_time), rather than sitting at 0 until the journey fully
		closes out at seal return.

		days_taken stays a decimal-days Float — billing/overdue comparisons
		(see journey_monitoring._attach_longer_in_journey) read it as such.
		days_taken_display is a separate human-readable string that switches to
		hours while the journey hasn't filled a full day yet, e.g. "10.6 hrs"
		instead of an opaque "0.44"."""
		end = self.completion_date_time or self.arrival_date_time
		if not self.journey_start_date_time or not end:
			self.days_taken = 0
			self.days_taken_display = ""
			return

		start = get_datetime(self.journey_start_date_time)
		end_dt = get_datetime(end)
		if end_dt < start:
			self.days_taken = 0
			self.days_taken_display = ""
			return

		total_seconds = (end_dt - start).total_seconds()
		self.days_taken = flt(total_seconds / 86400, 2)
		self.days_taken_display = _format_duration(total_seconds)

	def set_billing(self):
		"""Resolve the customer's billing rule and compute the charge on every
		save, so the Billing tab always reflects the latest rate and dates.

		Dates default from the journey timeline (start -> completion). Billing is
		inclusive whole days (start..return). When the return date is unknown the
		charge is an estimate up to today and the status stays Pending Billing.
		Billed stays terminal; Cancelled mirrors the journey lifecycle itself."""
		if self.billing_status == "Billed":
			return

		if self.journey_status == "Cancelled":
			self._clear_billing(status="Cancelled")
			return

		# Default the billing dates from the journey timeline if not set by hand.
		if not self.billing_start_date and self.journey_start_date_time:
			self.billing_start_date = getdate(self.journey_start_date_time)
		if not self.billing_return_date and self.completion_date_time:
			self.billing_return_date = getdate(self.completion_date_time)

		if not self.customer or not self.billing_start_date:
			self._clear_billing(status="Not Billed")
			return

		# journey_type (mirrored from the Journey Request) picks which of the
		# customer's rate sets applies — Local, or the shared Import/Export set.
		# Journeys with no Journey Request have no type and bill as Local, which
		# is what they did before rates were split by journey type.
		resolved = resolve_customer_billing(
			self.customer, self.billing_start_date, self.journey_type
		)
		rule_name = resolved["billing_rule"]
		if not rule_name:
			self._clear_billing(status="Not Billed")
			return

		rule = frappe.db.get_value(
			"Seal Billing Rate",
			rule_name,
			[
				"name",
				"billing_type",
				"billing_period_type",
				"currency",
				"first_period_days",
				"first_period_amount",
				"extra_day_rate",
				"computation_method",
			],
			as_dict=True,
		)
		apply_billing_overrides(rule, resolved)

		# Final billing uses the return date; otherwise estimate to today.
		end_date = self.billing_return_date or getdate(today())
		if getdate(end_date) < getdate(self.billing_start_date):
			end_date = getdate(self.billing_start_date)

		total_days = (getdate(end_date) - getdate(self.billing_start_date)).days + 1
		seal_count = self._billable_seal_count()

		# Scenarios 4/5: a customer with a recurring Seal Lease Fee / Seal
		# Ownership Service Fee subscription is billed that flat recurring
		# amount instead — their per-journey base charge is zero (the picked
		# rule only supplies the billing cycle via billing_period_type, not a
		# per-journey rate). Their journeys still resolve a rule/total_days
		# above and still run set_extra_billing below — Scenario 6's overflow
		# charge is independent of the base being zeroed.
		#
		# Computation = Compound (Non-Flat Rate Subscription, Set Billing
		# modal): a customer whose day-tiered rate is meant to be batched —
		# total days summed across every journey billed together, divided by
		# first_period_days, rounded up to a whole period, times
		# first_period_amount — rather than charged per journey (which would
		# round up on *each* journey separately and overcharge). That batching
		# only makes sense in aggregate at Sales Order generation time (see
		# completed_journeys.generate_sales_order /
		# completed_journeys._billing_summary), so the per-journey charge here
		# is zeroed exactly like the seat-subscription case above —
		# billable_days still needs to survive so the aggregate total can be
		# computed later.
		if customer_has_seat_subscription(self.customer) or rule.computation_method == "Compound":
			result = {
				"billable_days": total_days, "first_period_days": 0, "first_period_amount": 0,
				"extra_days": 0, "extra_day_rate": 0, "extra_day_amount": 0,
				"seal_count": seal_count, "per_seal_amount": 0, "total_amount": 0,
			}
			billing_status = "No Per-Journey Charge"
		else:
			result = compute_billing_amount(rule, total_days, seal_count)
			billing_status = "Pending Billing"

		self.billing_rule = rule.name
		self.currency = rule.currency
		self.billable_days = result["billable_days"]
		self.first_period_days = result["first_period_days"]
		self.first_period_amount = result["first_period_amount"]
		self.extra_days = result["extra_days"]
		self.extra_day_rate = result["extra_day_rate"]
		self.extra_day_amount = result["extra_day_amount"]
		self.seal_count = result["seal_count"]
		self.per_seal_amount = result["per_seal_amount"]
		self.total_charge = result["total_amount"]
		self.billing_status = billing_status

		# Scenario 6: a customer with a committed base (owned or leased) may
		# also lease extra seals — bill those (seals beyond the base) on the
		# extra leasing rule, additively, once the journey is tagged and out
		# in field.
		self.set_extra_billing(rule.billing_type, total_days)

		# Scenario 6 edge case: if a journey has NO base charge because the customer
		# has a subscription, BUT it does have an extra billing charge (overflow seal),
		# then it functionally DOES have a per-journey charge.
		if self.billing_status == "No Per-Journey Charge" and flt(self.extra_billing_amount) > 0:
			self.billing_status = "Pending Billing"

	def set_extra_billing(self, primary_billing_type, total_days):
		"""Compute the additional Extra Billing (Scenario 6) leasing charge for
		this journey's *overflow* seals — those beyond the customer's committed
		base (owned seats for an outright-purchase customer, or their current
		Scenario 4 lease count otherwise — see billing.resolve_customer_extra_billing),
		counted across all of the customer's active journeys. Applies once the
		journey is tagged and keeps the computed charge through Untagged/
		Completed (BILLABLE_JOURNEY_STATUSES) so it survives long enough to
		actually be billed — only Draft/pre-tagging/Cancelled clear it. The
		customer must be Subscription-billed with an active extra agreement;
		otherwise the extra line is cleared. Reads sibling journeys (still
		ACTIVE_JOURNEY_STATUSES — a completed sibling has returned its seal and
		shouldn't count toward another journey's base) to find this one's
		cumulative position but writes only itself (no cascading saves)."""
		if primary_billing_type != "Subscription" or self.journey_status not in BILLABLE_JOURNEY_STATUSES:
			self._clear_extra_billing()
			return

		extra = resolve_customer_extra_billing(self.customer, self.billing_start_date)
		if not extra:
			self._clear_extra_billing()
			return

		leased_here = self._leased_seal_count(cint(extra["base_seal_count"]))
		if leased_here <= 0:
			self._clear_extra_billing()
			return

		rule = frappe.db.get_value(
			"Seal Billing Rate",
			extra["billing_rule"],
			["name", "billing_period_type", "currency", "first_period_days", "first_period_amount", "extra_day_rate"],
			as_dict=True,
		)
		if not rule:
			self._clear_extra_billing()
			return

		result = compute_billing_amount(rule, total_days, leased_here)
		self.extra_billing_rule = rule.name
		self.extra_billing_seal_count = result["seal_count"]
		self.extra_billing_first_period_amount = result["first_period_amount"]
		self.extra_billing_extra_days = result["extra_days"]
		self.extra_billing_extra_day_rate = result["extra_day_rate"]
		self.extra_billing_extra_day_amount = result["extra_day_amount"]
		self.extra_billing_amount = result["total_amount"]

	def _leased_seal_count(self, base_seal_count):
		"""How many of *this* journey's seals are overflow (billed on the extra
		rule). Orders the customer's active journeys by (billing_start_date,
		name); the first ``base_seal_count`` seals across them are covered by the
		committed base (owned or leased), and any beyond are overflow. Returns
		this journey's slice."""
		my_seals = self._billable_seal_count()
		if my_seals <= 0:
			return 0

		siblings = frappe.get_all(
			"Seal Journey",
			filters={
				"customer": self.customer,
				"journey_status": ["in", ACTIVE_JOURNEY_STATUSES],
				"name": ["!=", self.name],
			},
			fields=["name", "billing_start_date", "seal_count"],
		)
		rows = siblings + [
			frappe._dict(
				{"name": self.name, "billing_start_date": self.billing_start_date, "seal_count": my_seals}
			)
		]

		# Stable order: earliest billing start first, then journey name. Journeys
		# with no billing_start_date sort last (flagged with 1 so getdate(None)
		# is never called on them).
		def _sort_key(row):
			d = row.get("billing_start_date")
			return (0, getdate(d).isoformat()) if d else (1, ""), row.get("name") or ""

		rows.sort(key=_sort_key)

		cumulative_before = 0
		for row in rows:
			if row.get("name") == self.name:
				break
			cumulative_before += cint(row.get("seal_count")) or 0

		# Seals of this journey occupy global indices
		# [cumulative_before, cumulative_before + my_seals); overflow ones are
		# the indices >= base_seal_count.
		leased = (cumulative_before + my_seals) - max(cumulative_before, base_seal_count)
		return max(0, min(my_seals, leased))

	def _clear_extra_billing(self):
		self.extra_billing_rule = None
		self.extra_billing_seal_count = 0
		self.extra_billing_first_period_amount = 0
		self.extra_billing_extra_days = 0
		self.extra_billing_extra_day_rate = 0
		self.extra_billing_extra_day_amount = 0
		self.extra_billing_amount = 0

	def _billable_seal_count(self):
		"""Number of seals billed on this journey. Each seal in ``journey_seals``
		is charged; fall back to 1 when only the primary ``assigned_seal`` is set
		and the child table hasn't been populated yet."""
		count = len(self.get("journey_seals") or [])
		if count:
			return count
		return 1 if self.assigned_seal else 0

	def enforce_arrival_field_locks(self):
		"""Untagging Confirmation / Seal Unlocked Confirmation / Arrival Remarks may
		only be edited by hand while untagging is actually in progress — keeps a
		Control Room user from pre-ticking confirmations before the seal is
		physically untagged. The transition methods below set
		``ignore_field_locks`` since they drive these fields themselves."""
		if self.is_new() or self.flags.get("ignore_field_locks"):
			return
		if "System Manager" in set(frappe.get_roles()):
			return

		previous = self.get_doc_before_save()
		if not previous or self.journey_status == "Untagging In Progress":
			return

		for fieldname in ARRIVAL_CONFIRMATION_FIELDS:
			if self.get(fieldname) != previous.get(fieldname):
				frappe.throw(
					_("{0} can only be changed while Untagging is In Progress.").format(
						_(_ARRIVAL_FIELD_LABELS.get(fieldname, fieldname))
					),
					title=_("Not Permitted"),
				)

	def enforce_untagging_irreversible(self):
		if self.is_new():
			return
		previous = self.get_doc_before_save()
		if not previous:
			return
		for fieldname in ("untagging_confirmation", "seal_unlocked_confirmation"):
			if cint(previous.get(fieldname)) and not cint(self.get(fieldname)):
				frappe.throw(
					_("{0} cannot be unchecked once confirmed.").format(
						_(_ARRIVAL_FIELD_LABELS.get(fieldname, fieldname))
					),
					title=_("Not Permitted"),
				)

	def _clear_billing(self, status="Not Billed"):
		self.billing_rule = None
		self.currency = None
		self.billable_days = 0
		self.first_period_days = 0
		self.first_period_amount = 0
		self.extra_days = 0
		self.extra_day_rate = 0
		self.extra_day_amount = 0
		self.seal_count = 0
		self.per_seal_amount = 0
		self.total_charge = 0
		self.billing_status = status
		self._clear_extra_billing()


def set_journey_status(seal_journey, status, extra=None):
	"""Update the status (and optional extra fields) of a Seal Journey, if one is
	linked. Safe no-op when ``seal_journey`` is empty. Used to keep the Seal
	Journey mirror in step with the booking → job order → journey request flow."""
	if not seal_journey:
		return
	if not frappe.db.exists("Seal Journey", seal_journey):
		return
	values = {"journey_status": status}
	if extra:
		values.update(extra)
	frappe.db.set_value("Seal Journey", seal_journey, values)
	sync_seal_journey_pre_tagging(seal_journey)


# ----------------------------------------------------------------------
# Arrival / Untagging workflow actions (Operations Control Room)
# ----------------------------------------------------------------------
def _ensure_control_room_role(include_read_only=False):
	"""Gate Control Room actions to Operations Control Room (System Manager
	always passes). ``include_read_only`` also admits Account Manager, who
	may only view queues (e.g. get_arrival_queue) — never call this with
	include_read_only=True from a function that mutates a journey."""
	roles = set(frappe.get_roles())
	if "System Manager" in roles or frappe.session.user == "Administrator":
		return
	allowed_roles = {"Operations Control Room"}
	if include_read_only:
		allowed_roles.add("Account Manager")
	if not roles & allowed_roles:
		frappe.throw(
			_("Only the Operations Control Room can perform this action."),
			title=_("Insufficient Permission"),
		)


def _get_seal_journey(docname):
	doc = frappe.get_doc("Seal Journey", docname)
	doc.check_permission("write")
	return doc


def _pull_arrival_location(doc):
	"""Fetch live GPS for the journey's assigned seal at the moment of arrival.

	Mirrors the Journey Request tagging_location automation (see
	journey_request.py:_pull_tagging_location) — captured from the seal
	device's own GPS via sync_seal_device rather than typed in, so arrival
	location can't be skipped or fudged at the one moment it matters most
	for audit."""
	if not doc.assigned_seal:
		return None

	from tnt_seal_management.tnt_seal_management.api.seal_sync import sync_seal_device

	try:
		matched = sync_seal_device(doc.assigned_seal, sync_type="Manual Device Sync")
	except Exception as exc:
		frappe.log_error(
			f"Arrival location sync failed for {doc.assigned_seal}: {exc}",
			"Seal Journey Arrival Location Sync",
		)
		return None

	location = matched.get("location")
	return str(location)[:140] if location else None


@frappe.whitelist()
def confirm_arrival(docname, unlock_method="physical"):
	"""Driver calls Control Room on arrival and the seal is unlocked — this one
	action covers both arrival and seal-unlock. The Control Room picks how the
	seal was unlocked, which routes the rest of the workflow:

	  • ``physical`` (default) — a Field Technician must physically remove the
	    seal, so this kicks off the untagging phase: it raises an Untagging
	    request to the PCB Team Leader and the journey moves to "Arrived".

	  • ``remote`` — the client called in and the seal was unlocked remotely, so
	    untagging is skipped entirely. The journey goes straight to "Awaiting Seal
	    Return" and a Seal Return request is raised so the PCB Team Leader can
	    assign a Tag Operator to collect the seal from the client.

	Captures location live from the seal's GPS and timestamps arrival, which also
	makes Days Taken non-zero immediately (see SealJourney.set_days_taken)."""
	_ensure_control_room_role()
	if unlock_method not in ("physical", "remote"):
		frappe.throw(_("Invalid unlock method {0}.").format(unlock_method), title=_("Invalid Request"))

	doc = _get_seal_journey(docname)
	if doc.journey_status != "In Transit":
		frappe.throw(
			_("Arrival can only be confirmed while the journey is In Transit."),
			title=_("Invalid Status"),
		)

	# Pull the live GPS location FIRST: sync_seal_device writes the journey's API
	# mirror fields (api_last_update_time, location, …) straight to the row and
	# commits (see seal_sync._apply_to_journey), which bumps this Seal Journey's
	# `modified`. Reload afterwards so our own save below compares against the
	# fresh timestamp instead of tripping a "Document has been modified" conflict.
	location = _pull_arrival_location(doc)
	doc.reload()

	doc.arrival_date_time = doc.arrival_date_time or now_datetime()
	doc.arrival_location = location or doc.arrival_location
	doc.seal_unlocked_confirmation = 1
	doc.flags.ignore_field_locks = True

	if unlock_method == "remote":
		_confirm_remote_unlock(doc)
	else:
		_confirm_physical_unlock(doc)

	frappe.db.commit()


def _confirm_physical_unlock(doc):
	"""Physical unlock: a Tag Operator must remove the seal, so kick off the
	untagging phase. Raising the untagging request is tolerated if it fails so a
	hiccup there never blocks the arrival confirmation itself."""
	doc.seal_unlock_method = "Physical"
	doc.journey_status = "Arrived"
	doc.save()

	try:
		from tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment import (
			create_untagging_request,
		)

		create_untagging_request(doc)
	except Exception as exc:
		frappe.log_error(
			f"Untagging request creation failed for {doc.name}: {exc}",
			"Untagging Request",
		)


def _confirm_remote_unlock(doc):
	"""Remote unlock: the seal was opened remotely at the client's request, so
	there is no physical untagging. Skip straight to the seal-return phase and
	raise a Seal Return request for the PCB Team Leader. Tolerated if it fails so
	a hiccup there never blocks the arrival confirmation itself."""
	doc.seal_unlock_method = "Remote"
	doc.untagging_status = "Not Required"
	doc.journey_status = "Awaiting Seal Return"
	doc.save()

	try:
		from tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment import (
			create_seal_return_request,
		)

		create_seal_return_request(doc)
	except Exception as exc:
		frappe.log_error(
			f"Seal return request creation failed for {doc.name}: {exc}",
			"Seal Return Request",
		)


@frappe.whitelist()
def get_arrival_queue():
	"""Seal Journeys currently In Transit, awaiting the Control Room's arrival /
	seal-unlock confirmation — for the Approve tab's Arrivals section."""
	_ensure_control_room_role(include_read_only=True)
	journeys = frappe.get_list(
		"Seal Journey",
		filters={"journey_status": "In Transit"},
		fields=[
			"name", "customer", "vehicle_plate_number", "container_number",
			"origin", "destination", "assigned_seal",
			"journey_start_date_time", "current_seal_status",
			"api_device_location", "api_last_update_time",
		],
		order_by="journey_start_date_time asc",
	)
	return {"journeys": journeys}


@frappe.whitelist()
def start_untagging(docname):
	_ensure_control_room_role()
	doc = _get_seal_journey(docname)
	if doc.journey_status != "Arrived":
		frappe.throw(
			_("Untagging can only start after arrival has been confirmed."),
			title=_("Invalid Status"),
		)

	doc.untagging_started_date_time = doc.untagging_started_date_time or now_datetime()
	doc.untagging_status = "In Progress"
	doc.journey_status = "Untagging In Progress"
	doc.flags.ignore_field_locks = True
	doc.save()
	frappe.db.commit()


@frappe.whitelist()
def complete_untagging(docname):
	_ensure_control_room_role()
	doc = _get_seal_journey(docname)
	if doc.journey_status != "Untagging In Progress":
		frappe.throw(
			_("Untagging can only be completed once it has started."),
			title=_("Invalid Status"),
		)
	if not cint(doc.untagging_confirmation):
		frappe.throw(
			_("Tick Untagging Confirmation to confirm the seal has been removed."),
			title=_("Confirmation Required"),
		)
	if not cint(doc.seal_unlocked_confirmation):
		frappe.throw(
			_("Tick Seal Unlocked Confirmation to confirm the seal has been unlocked."),
			title=_("Confirmation Required"),
		)

	doc.untagging_completed_date_time = doc.untagging_completed_date_time or now_datetime()
	doc.untagging_status = "Completed"
	doc.journey_status = "Untagged"
	doc.flags.ignore_field_locks = True
	doc.save()
	frappe.db.commit()



@frappe.whitelist()
def get_pending_billing_queue():
	"""Seal Journeys whose charge is computed but not yet settled — the
	completed-but-unbilled journeys that would otherwise be invisible once they
	leave the active monitoring views. Honours Seal Journey permissions."""
	journeys = frappe.get_list(
		"Seal Journey",
		filters={"billing_status": ["in", ["Pending Billing", "Processing Payment"]]},
		fields=[
			"name", "customer", "journey_status", "vehicle_plate_number",
			"container_number", "billing_start_date", "billing_return_date",
			"billable_days", "total_charge", "completion_date_time", "billing_status"
		],
		order_by="completion_date_time asc, modified asc",
		limit_page_length=0,
	)
	return {"journeys": journeys}


def sync_billing_from_sales_invoice(sales_invoice, method=None):
	"""Flip Seal Journeys to Billed once their Sales Order's invoice is fully paid.

	Hooked on Sales Invoice's on_change, which fires both on a normal save/submit
	and on the db_set-only status flip ERPNext does when a Payment Entry is
	reconciled against the invoice (set_status(update=True) never runs a full
	document save, only db_set, which still triggers on_change)."""
	if sales_invoice.docstatus != 1 or sales_invoice.status != "Paid":
		return

	sales_orders = frappe.get_all(
		"Sales Invoice Item",
		filters={"parent": sales_invoice.name, "sales_order": ["is", "set"]},
		pluck="sales_order",
		distinct=True,
	)
	if not sales_orders:
		return

	journeys = frappe.get_all(
		"Seal Journey",
		filters={
			"sales_order_reference": ["in", sales_orders],
			"billing_status": "Processing Payment",
		},
		pluck="name",
	)
	for name in journeys:
		frappe.db.set_value("Seal Journey", name, "billing_status", "Billed")


def resolve_pre_tagging_snapshot(journey_request):
	"""Return the Journey Request checklist and its derived completion status."""
	if not journey_request:
		return None

	jr = (
		frappe.get_doc("Journey Request", journey_request)
		if isinstance(journey_request, str)
		else journey_request
	)
	rows = [
		{
			"checklist_item": row.checklist_item,
			"completed": cint(row.completed),
		}
		for row in jr.pre_tagging_checklist
		if row.checklist_item
	]
	if not rows:
		return None

	return {
		"rows": rows,
		"status": "Completed" if all(row["completed"] for row in rows) else "Pending",
	}


def apply_pre_tagging_snapshot(journey, snapshot):
	"""Apply a resolved checklist snapshot to an in-memory Seal Journey."""
	source_signature = [
		(row["checklist_item"], cint(row["completed"])) for row in snapshot["rows"]
	]
	target_signature = [
		(row.checklist_item, cint(row.completed)) for row in journey.pre_tagging_checklist
	]
	rows_changed = source_signature != target_signature
	status_changed = journey.pre_tagging_status != snapshot["status"]

	if rows_changed:
		journey.set("pre_tagging_checklist", [])
		for row in snapshot["rows"]:
			journey.append("pre_tagging_checklist", row.copy())
	if status_changed:
		journey.pre_tagging_status = snapshot["status"]

	return rows_changed, status_changed


def sync_seal_journey_pre_tagging(seal_journey, journey_request=None):
	"""Persist the Journey Request checklist as the Seal Journey source of truth."""
	if not seal_journey or not frappe.db.exists("Seal Journey", seal_journey):
		return False

	journey_request = journey_request or frappe.db.get_value(
		"Seal Journey", seal_journey, "journey_request"
	)
	snapshot = resolve_pre_tagging_snapshot(journey_request)
	if not snapshot:
		return False

	journey = frappe.get_doc("Seal Journey", seal_journey)
	rows_changed, status_changed = apply_pre_tagging_snapshot(journey, snapshot)
	if rows_changed:
		frappe.db.delete(
			"Pre Tagging Checklist Item",
			{
				"parent": seal_journey,
				"parenttype": "Seal Journey",
				"parentfield": "pre_tagging_checklist",
			},
		)
		for index, row in enumerate(journey.pre_tagging_checklist, 1):
			row.idx = index
			row.db_insert()
	if status_changed:
		frappe.db.set_value(
			"Seal Journey",
			seal_journey,
			"pre_tagging_status",
			snapshot["status"],
			update_modified=False,
		)

	return rows_changed or status_changed

def sync_seal_journey_mirror(seal_journey):
	"""Idempotently rewrite the detail (mirror) fields on a Seal Journey from its
	source documents: Tagging Booking -> PCB Job Order -> PCB Assignment ->
	Journey Request.

	This NEVER writes ``journey_status`` — the transition methods retain status
	authority; this only fills detail so each tab is populated as the journey
	shifts stages. Safe no-op when ``seal_journey`` is empty/missing. Only
	non-empty resolved values are written, so a later-stage source doc that does
	not exist yet never clobbers detail captured at an earlier stage. Child
	tables (journey_seals, photos) are intentionally left to
	``_finalize_seal_journey_from_request`` which owns them at the In Transit step.
	"""
	if not seal_journey:
		return
	if not frappe.db.exists("Seal Journey", seal_journey):
		return

	values = resolve_seal_journey_mirror_values(seal_journey)
	if values:
		frappe.db.set_value("Seal Journey", seal_journey, values)
	sync_seal_journey_pre_tagging(seal_journey)


def resolve_seal_journey_mirror_values(seal_journey):
	"""Resolve (but do not write) the detail (mirror) field values for a Seal
	Journey from its source chain. Returns a dict of non-empty field -> value, or
	an empty dict when there is nothing to mirror yet. See
	``sync_seal_journey_mirror`` for the contract."""
	booking_name = frappe.db.get_value("Seal Journey", seal_journey, "tagging_booking")
	if not booking_name:
		return {}

	values = {}

	def put(field, value):
		if value not in (None, ""):
			values[field] = value

	# --- Tagging Booking -------------------------------------------------
	booking = frappe.db.get_value(
		"Tagging Booking",
		booking_name,
		[
			"client_name",
			"location",
			"contact_person_name",
			"contact_person_phone",
			"finance_pcb_approval_status",
			"finance_pcb_approver",
			"finance_pcb_approval_date_time",
			"finance_pcb_remarks",
			"pcb_job_order_reference",
		],
		as_dict=True,
	)
	if booking:
		put("customer", booking.client_name)
		put("origin", booking.location)
		put("contact_person_name", booking.contact_person_name)
		put("contact_person_phone", booking.contact_person_phone)
		put("finance_pcb_approval_status", booking.finance_pcb_approval_status)
		put("finance_pcb_approver", booking.finance_pcb_approver)
		put("finance_pcb_approval_date_time", booking.finance_pcb_approval_date_time)
		put("finance_pcb_remarks", booking.finance_pcb_remarks)
		put("pcb_job_order", booking.pcb_job_order_reference)

	job_order_name = booking.pcb_job_order_reference if booking else None

	# --- PCB Job Order ---------------------------------------------------
	assignment_name = None
	if job_order_name:
		job_order = frappe.db.get_value(
			"PCB Job Order",
			job_order_name,
			[
				"scheduled_date_time",
				"assigned_pcb_team_leader",
				"team_leader_assignment_date_time",
				"assignment_reference",
			],
			as_dict=True,
		)
		if job_order:
			put("scheduled_date_time", job_order.scheduled_date_time)
			put("assigned_team_lead", job_order.assigned_pcb_team_leader)
			put("team_lead_assignment_date_time", job_order.team_leader_assignment_date_time)
			# A Cancelled assignment belongs to a prior, unwound cycle (see
			# PCBAssignment._cancel_assignment) — never mirror it as "the" active
			# assignment for this job order.
			assignment_name = job_order.assignment_reference or frappe.db.get_value(
				"PCB Assignment",
				{"pcb_job_order": job_order_name, "assignment_status": ["!=", "Cancelled"]},
				"name",
			)

	# --- PCB Assignment --------------------------------------------------
	if assignment_name:
		assignment = frappe.db.get_value(
			"PCB Assignment",
			assignment_name,
			["assigned_field_technician", "assignment_date_time"],
			as_dict=True,
		)
		if assignment:
			put("pcb_assignment", assignment_name)
			put("assigned_technician", assignment.assigned_field_technician)
			put("technician_assignment_date_time", assignment.assignment_date_time)

	# --- Journey Request -------------------------------------------------
	# A Cancelled Journey Request belongs to a prior, unwound assignment cycle —
	# never mirror its (now stale) technician/route data onto the journey.
	jr_name = frappe.db.get_value(
		"Journey Request",
		{"job_order": job_order_name, "journey_request_status": ["!=", "Cancelled"]},
		"name",
	) if job_order_name else None
	if jr_name:
		jr = frappe.db.get_value(
			"Journey Request",
			jr_name,
			[
				"vehicle",
				"container_number",
				"file_number",
				"departure_card_number",
				"origin",
				"destination",
				"assigned_technician",
				"control_room_approver",
				"control_room_approval_date_time",
				"control_room_remarks",
				"actual_tagging_date_time",
				"tagging_location",
				"tagging_remarks",
				"approval_date_time",
				"seal_returned",
				"seal_return_confirmed_by_technician",
				"seal_return_condition",
				"seal_return_location",
				"retrieval_card_number",
			],
			as_dict=True,
		)
		if jr:
			put("journey_request", jr_name)
			# Plain text carried over from the Tagging Booking — see
			# start_seal_journey in journey_request.py.
			put("vehicle_plate_number", jr.vehicle)
			put("container_number", jr.container_number)
			put("file_number", jr.file_number)
			put("departure_card_number", jr.departure_card_number)
			put("origin", jr.origin)  # JR origin overrides booking.location once set
			put("destination", jr.destination)
			put("assigned_technician", jr.assigned_technician)
			put("control_room_approver", jr.control_room_approver)
			put("control_room_approval_date_time", jr.control_room_approval_date_time)
			put("control_room_remarks", jr.control_room_remarks)
			put("tagging_date_time", jr.actual_tagging_date_time)
			put("tagging_location", jr.tagging_location)
			put("tagging_remarks", jr.tagging_remarks)
			put("departure_confirmation", 1 if jr.approval_date_time else 0)

			# --- Seal Return (mirrored onto the Seal Return tab) -------------
			put("return_location", jr.seal_return_location)
			put("seal_return_confirmed_by_technician", cint(jr.seal_return_confirmed_by_technician))
			put("seal_condition_after_journey", jr.seal_return_condition)
			put("retrieval_card_number", jr.retrieval_card_number)
			# Returned By is the technician who untagged/returned the seal, but only
			# once the technician confirms the return.
			if cint(jr.seal_returned):
				put("returned_by", jr.assigned_technician)

	return values


def get_pre_tagging_checklist_items():
	settings = frappe.get_single("Seal API Settings")
	items = [
		row.checklist_item.strip()
		for row in settings.pre_tagging_checklist_template
		if row.checklist_item and row.checklist_item.strip()
	]
	return items or DEFAULT_PRE_TAGGING_CHECKLIST_ITEMS


@frappe.whitelist()
def get_pre_tagging_checklist_template():
	return get_pre_tagging_checklist_items()


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def pcb_team_leader_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("PCB Team Leader", txt, searchfield, start, page_len)


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def field_technician_query(doctype, txt, searchfield, start, page_len, filters):
	return _user_role_query("Field Technician", txt, searchfield, start, page_len)


def _user_role_query(role, txt, searchfield, start, page_len):
	return frappe.db.sql(
		f"""
		select
			u.name,
			concat_ws(' ', u.first_name, u.last_name) as full_name
		from `tabUser` u
		inner join `tabHas Role` hr on hr.parent = u.name
		where hr.role = %(role)s
			and u.enabled = 1
			and u.docstatus < 2
			and u.user_type = 'System User'
			and (
				u.{searchfield} like %(txt)s
				or concat_ws(' ', u.first_name, u.last_name) like %(txt)s
			)
		order by
			case when u.name like %(txt)s then 0 else 1 end,
			case when concat_ws(' ', u.first_name, u.last_name) like %(txt)s then 0 else 1 end,
			u.full_name asc,
			u.name asc
		limit %(start)s, %(page_len)s
		""",
		{
			"role": role,
			"txt": f"%{cstr(txt)}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
	)
