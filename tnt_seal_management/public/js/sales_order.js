// Item codes generate_sales_order bills journey charges onto (see
// ITEM_LEASING / ITEM_LEASING_EXTRA_DAYS / ITEM_SUBSCRIPTION in
// api/completed_journeys.py).
const TNT_JOURNEY_ITEM_CODES = new Set([
	"PCB SUBSCRIPTIONS",
	"PCB-LEASING",
	"PCB-LEASING-EXTRADAYS",
]);

frappe.ui.form.on("Sales Order", {
	async refresh(frm) {
		// Clear first so a stale pill never survives a route change into an
		// unrelated Sales Order while the async check below is still in flight.
		clear_customer_response_pill(frm);
		if (await is_journey_sales_order(frm)) {
			render_customer_response_pill(frm);
		}
	},
});

// Only Sales Orders that came out of Completed Journeys carry a customer
// response — every other ERPNext order on the site would otherwise show a
// meaningless "Customer: Pending" pill.
//
// The item-code check is client-side and instant; the server check is the
// fallback for journey orders billed onto the generic SJ-Subscription /
// Extra Days items (generate_sales_order uses those when the customer's
// billing rule doesn't resolve), and is cached per docname.
async function is_journey_sales_order(frm) {
	const items = frm.doc.items || [];
	const has_journey_item = items.some((row) =>
		TNT_JOURNEY_ITEM_CODES.has((row.item_code || "").trim().toUpperCase())
	);
	if (has_journey_item) return true;

	if (frm.is_new()) return false;

	if (frm.__tnt_is_journey_order === undefined) {
		try {
			const r = await frappe.call({
				method: "tnt_seal_management.tnt_seal_management.api.completed_journeys.is_journey_sales_order",
				args: { sales_order: frm.doc.name },
			});
			frm.__tnt_is_journey_order = !!r.message;
		} catch (e) {
			// Fail closed — a form that can't reach the check just shows no
			// pill rather than breaking, but keep the reason visible.
			console.warn("Could not check if Sales Order is journey-generated:", e);
			frm.__tnt_is_journey_order = false;
		}
	}
	return frm.__tnt_is_journey_order;
}

function clear_customer_response_pill(frm) {
	frm.page.$title_area?.find(".tnt-customer-response-pill").remove();
}

// The customer's Accept/Reject decision from the customer-portal Sales Orders
// tab (Seal Journeys modal) — see custom_customer_response and
// api/customer_sales_orders.py's set_sales_order_response.
//
// Rendered as our own pill appended next to the workflow status pill in the
// page header, rather than via frm.dashboard.add_indicator (v15 puts dashboard
// stats inside the "Connections" tab, so it's invisible from "Details") or
// frm.set_intro (shares the single layout message slot with the "not editable
// due to a Workflow" banner and would replace it).
function render_customer_response_pill(frm) {
	const $title_area = frm.page.$title_area;
	if (!$title_area) return;

	clear_customer_response_pill(frm);

	const response = frm.doc.custom_customer_response;
	const COLORS = { Accepted: "green", Rejected: "red" };
	const color = COLORS[response] || "orange";

	$(`<span class="indicator-pill no-indicator-dot whitespace-nowrap tnt-customer-response-pill ${color}"
			style="margin-left: 8px;"
			title="${__("Customer response from the portal")}">
			<span>${__("Customer: {0}", [__(response || "Pending")])}</span>
		</span>`).appendTo($title_area);
}
