frappe.pages["rects"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "RECTs",
		single_column: true,
	});

	page.set_primary_action(__("Refresh"), () => {
		load_rects_card_counts(page);
		frappe.show_alert({ message: __("Dashboard counts refreshed"), indicator: "green" });
	}, "octicon octicon-sync");

	$(page.body).html(get_rects_landing_html());
	load_rects_card_counts(page);
	$(page.body).on("click", "[data-route]", function () {
		const route = $(this).data("route");
		if (route) frappe.set_route(...String(route).split("/"));
	});
};

// The page's module would otherwise show the TNT workspace in the breadcrumb.
function set_rects_breadcrumb() {
	frappe.breadcrumbs.add({ type: "Custom", label: __("RECTs Sealmanagement"), route: "/app/rects" });
}

frappe.pages["rects"].on_page_show = function (wrapper) {
	window.tnt_set_module("RECTS");
	set_rects_breadcrumb();
	if (wrapper.page) load_rects_card_counts(wrapper.page);
};

// Same card layout as the TNT landing page. Cards with a real route take their
// count (and label) from dashboard_cards.get_card_counts under that route; the
// rest are placeholders (always 0) until RECTS has its own data. `badges` gives a card several labeled counts;
// otherwise `count` (if set) is a single badge and `label` a line under the
// title. A card with an empty `route` does nothing on click until its RECTS
// page exists.
const RECTS_DASHBOARD_CARDS = [
	{ title: "Tagging Bookings", icon: "📅", route: "tagging-booking-list/rects", primary: true, count: 0 },
	{
		title: "Assignments",
		icon: "👷",
		route: "assignment-list/rects",
		// Same as the PCB card: users who can't open assignments (Control Room,
		// Field Technician) land on the Journey Requests list instead.
		fallback_route: "journey-request-list/rects",
		primary: true,
		badges: [
			{ label: "Tagging", count: 0, route: "assignment-list/rects" },
			{ label: "Untagging", count: 0, variant: "arrival", route: "assignment-untagging/rects" },
			{ label: "Retrieval", count: 0, variant: "arrival", route: "assignment-seal-return/rects" },
			{ label: "Seal Return", count: 0, variant: "arrival", route: "journey-request-seal-return/rects" },
		],
	},
	{
		title: "Control Room",
		icon: "🛂",
		route: "control-room/rects",
		primary: true,
		// No Alerts or Arrivals badges: RECTs seals have no seal API to raise
		// alerts or detect arrivals, so arrival is confirmed by hand.
		badges: [{ label: "Approvals", count: 0, route: "control-room/rects" }],
	},
	{ title: "Seal Device", icon: "🔒", route: "seal-device-dashboard/rects", count: 0 },
	{ title: "Warehouses", icon: "🏬", route: "warehouse-list/rects", count: 0, label: "Active warehouses" },
	{ title: "Seal Journeys", icon: "🚚", route: "seal-journey-list/rects", primary: true, count: 0 },
	{ title: "Customer Billing", icon: "🧾", route: "customer-billing/rects", count: 0, label: "Customers" },
	{ title: "Vehicles", icon: "🚘", route: "vehicle-list/rects", count: 0 },
];

function get_rects_count_html(count, variant, route) {
	const classes = ["rects-count"];
	if (variant) classes.push(`rects-count--${variant}`);
	if (count > 0) classes.push("rects-count--active");
	const data = route ? ` data-count="${frappe.utils.escape_html(route)}"` : "";
	return `<span class="${classes.join(" ")}"${data}>${count}</span>`;
}

function load_rects_card_counts(page) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.dashboard_cards.get_card_counts",
		callback(r) {
			const counts = (r && r.message) || {};
			$(page.body).find("[data-count]").each(function () {
				const route = $(this).data("count");
				if (!counts[route]) return;
				const { count, label } = counts[route];
				$(this).text(count).toggleClass("rects-count--active", count > 0);
				$(page.body)
					.find(`[data-count-label="${CSS.escape(route)}"]`)
					.text(__(label));
			});
		},
	});
}

function get_rects_card_html(card) {
	if (card.fallback_route && !window.tnt_can_open_assignments()) {
		// Users who can't open assignments get the Journey Requests card, with
		// that list's own counts (same as the PCB card).
		card = {
			...card,
			route: card.fallback_route,
			badges: [
				{ label: "Tagging", count: 0, route: "journey-request-list/rects" },
				{ label: "Untagging", count: 0, variant: "arrival", route: "journey-request-untagging/rects" },
				{ label: "Seal Return", count: 0, variant: "arrival", route: "journey-request-seal-return/rects" },
			],
		};
	}
	const primaryClass = card.primary ? " rects-card--primary" : "";
	let badges = "";
	if (card.badges) {
		badges = `
			<div class="rects-badges">
				${card.badges
					.map(
						(b) => `<div class="rects-badge-stat">
							${get_rects_count_html(b.count, b.variant, b.route)}
							<span class="rects-badge-label">${__(b.label)}</span>
						</div>`
					)
					.join("")}
			</div>`;
	} else if (card.count !== undefined) {
		badges = get_rects_count_html(card.count, null, card.route);
	}

	return `
		<div class="rects-card${primaryClass}" data-route="${frappe.utils.escape_html(card.route)}">
			<div class="rects-card__top">
				<div class="rects-icon">${card.icon}</div>
				${badges}
			</div>
			<h3>${__(card.title)}</h3>
			${card.label
				? `<p class="rects-count-label" data-count-label="${frappe.utils.escape_html(card.route)}">${__(card.label)}</p>`
				: ""}
		</div>
	`;
}

function get_rects_landing_html() {
	return `
		<style>
			.rects-landing {
				max-width: 1400px;
				margin: 0 auto;
				padding: 32px 20px 48px;
				font-family: var(--font-stack);
			}

			.rects-grid {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 18px;
			}

			.rects-card {
				background: var(--card-bg, #ffffff);
				border: 1px solid rgba(14, 165, 233, 0.2);
				border-radius: 22px;
				padding: 24px;
				cursor: pointer;
				box-shadow: 0 4px 12px rgba(14, 165, 233, 0.05);
			}

			.rects-card:hover {
				border-color: #38bdf8;
				box-shadow: 0 12px 28px rgba(14, 165, 233, 0.14);
				transform: translateY(-2px);
			}

			.rects-card--primary {
				background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
				border-color: #bae6fd;
			}

			.rects-icon {
				width: 54px;
				height: 54px;
				border-radius: 16px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				font-size: 28px;
				background: #e0f2fe;
				color: #0284c7;
			}

			.rects-card--primary .rects-icon {
				background: #0284c7;
				color: #ffffff;
			}

			.rects-card__top {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				margin-bottom: 16px;
			}

			.rects-count {
				min-width: 28px;
				height: 28px;
				padding: 0 9px;
				border-radius: 14px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				font-size: 14px;
				font-weight: 700;
				line-height: 1;
				background: #e2e8f0;
				color: #475569;
			}

			.rects-count--active {
				background: #0284c7;
				color: #ffffff;
			}

			.rects-card--primary .rects-count {
				background: rgba(255, 255, 255, 0.65);
				color: #0c4a6e;
			}

			.rects-card--primary .rects-count--active {
				background: #ffffff;
				color: #0284c7;
			}

			.rects-badges {
				display: flex;
				gap: 12px;
				align-items: flex-start;
			}
			.rects-badge-stat {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 5px;
			}
			.rects-badge-label {
				font-size: 10px;
				font-weight: 800;
				letter-spacing: .04em;
				text-transform: uppercase;
				color: #64748b;
			}
			.rects-card--primary .rects-badge-label { color: #0c4a6e; }

			/* Placed after the primary-card rules so these win the specificity tie. */
			.rects-count--alert {
				background: #fee2e2;
				color: #b91c1c;
			}
			.rects-count--alert.rects-count--active {
				background: #dc2626;
				color: #ffffff;
			}
			.rects-count--arrival {
				background: #fef3c7;
				color: #92400e;
			}
			.rects-count--arrival.rects-count--active {
				background: #d97706;
				color: #ffffff;
			}

			.rects-count-label {
				font-size: 13px;
				font-weight: 500;
				margin: 0;
				color: #64748b;
			}

			.rects-card h3 {
				font-size: 19px;
				font-weight: 700;
				margin: 0 0 8px;
				color: #0c4a6e;
			}

			/* Dark mode compatibility */
			[data-theme="dark"] .rects-card {
				background: #1e293b;
				border-color: #334155;
			}
			[data-theme="dark"] .rects-card h3 {
				color: #f8fafc;
			}
			[data-theme="dark"] .rects-count {
				background: #334155;
				color: #cbd5e1;
			}
			[data-theme="dark"] .rects-count--alert {
				background: #7f1d1d;
				color: #fecaca;
			}
			[data-theme="dark"] .rects-count--arrival {
				background: #78350f;
				color: #fde68a;
			}
			[data-theme="dark"] .rects-count-label,
			[data-theme="dark"] .rects-badge-label {
				color: #94a3b8;
			}
			[data-theme="dark"] .rects-card--primary .rects-badge-label {
				color: #e0f2fe;
			}
			[data-theme="dark"] .rects-card--primary {
				background: linear-gradient(135deg, #075985 0%, #0369a1 100%);
				border-color: #0284c7;
			}

			@media (max-width: 991px) {
				.rects-grid {
					grid-template-columns: 1fr;
				}
			}
		</style>

		<div class="rects-landing">
			<section class="rects-grid">
				${RECTS_DASHBOARD_CARDS.map(get_rects_card_html).join("")}
			</section>
		</div>
	`;
}
