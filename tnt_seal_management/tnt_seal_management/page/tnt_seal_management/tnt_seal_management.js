frappe.pages["tnt-seal-management"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "TNT Seal Management",
		single_column: true,
	});

	page.set_primary_action(__("Refresh"), () => {
		load_card_counts(page);
		frappe.show_alert({ message: __("Dashboard counts refreshed"), indicator: "green" });
	}, "octicon octicon-sync");

	$(page.body).html(get_landing_page_html());
	bind_actions(page);
	load_card_counts(page);
};

// on_page_load only fires once per page instance — navigating away (e.g. into
// an assignment) and back via the SPA router does not re-run it, so counts
// like the Assignments card badge would keep showing whatever was true when
// the dashboard first loaded (e.g. before an assignment was cancelled) until
// "Refresh" was clicked. on_page_show fires on every such re-entry.
frappe.pages["tnt-seal-management"].on_page_show = function (wrapper) {
	if (wrapper.page) load_card_counts(wrapper.page);
};

const TNT_DASHBOARD_CARDS = [
	{
		title: "Seal Journeys",
		icon: "🚚",
		route: "seal-journey-list",
		primary: true,
		roles: ["System Manager", "Finance PCB", "Operations Control Room", "Managing Director"],
	},
	{
		title: "Journey Requests",
		icon: "🧾",
		route: "journey-request-list",
		roles: [
			"System Manager",
			"Management",
			"Managing Director",
			"Operations Control Room",
			"Field Technician",
			"PCB Team Leader",
		],
	},
	{
		title: "Tagging Bookings",
		icon: "📅",
		route: "tagging-booking-list",
		primary: true,
		roles: ["System Manager", "Account Manager", "Finance PCB", "Management", "Managing Director"],
	},
	{
		title: "PCB Job Orders",
		icon: "📋",
		route: "pcb-job-order-list",
		roles: ["System Manager", "Finance PCB", "Management", "Managing Director", "PCB Team Leader"],
	},
	{
		title: "Assignments",
		icon: "👷",
		route: "assignment-list",
		primary: true,
		roles: ["System Manager", "PCB Team Leader", "Finance PCB", "Management", "Managing Director"],
	},
	{
		title: "Current Customers",
		icon: "🏢",
		route: "current-customer-list",
		roles: [
			"System Manager",
			"Account Manager",
			"Finance PCB",
			"Management",
			"Managing Director",
			"Operations Control Room",
		],
	},
	{
		title: "Vehicles",
		icon: "🚘",
		route: "vehicle-list",
		roles: ["System Manager", "Management", "Managing Director", "Field Technician"],
	},
	{
		title: "Warehouses",
		icon: "🏬",
		route: "List/Warehouse/List",
		roles: [
			"System Manager",
			"Operations Control Room",
			"Management",
			"Managing Director",
			"PCB Team Leader",
			"Field Technician",
		],
	},
	{
		title: "Seal Device",
		icon: "🔒",
		route: "seal-device-dashboard",
		roles: [
			"System Manager",
			"Operations Control Room",
			"Management",
			"Managing Director",
			"PCB Team Leader",
		],
	},
	{
		title: "Billing Rates",
		icon: "💰",
		route: "seal-billing-rate-list",
		roles: ["System Manager", "Finance PCB", "Management", "Managing Director"],
	},
	{
		title: "Completed Journeys",
		icon: "📄",
		route: "completed-journeys",
		roles: [
			"System Manager",
			"Finance PCB",
			"Management",
			"Managing Director",
			"Accounts Manager",
			"Accounts User",
		],
	},
	{
		title: "Tracking Dashboard",
		icon: "🗺",
		route: "seal-tracking-dashboard",
		primary: true,
		roles: [
			"System Manager",
			"Operations Control Room",
			"Management",
			"Managing Director",
		],
	},
	{
		title: "Control Room",
		icon: "🛂",
		route: "control-room",
		primary: true,
		roles: [
			"System Manager",
			"Operations Control Room",
			"Management",
			"Managing Director",
		],
	},
	{
		title: "Journey Monitoring",
		icon: "📡",
		route: "journey-monitoring",
		primary: true,
		roles: [
			"System Manager",
			"Operations Control Room",
			"Management",
			"Managing Director",
		],
	},
	{
		title: "Seal Settings",
		icon: "⚙️",
		route: "Form/Seal API Settings",
		roles: ["System Manager"],
	},
];

const CARDS_WITHOUT_COUNT_LABELS = new Set([
	"seal-journey-list",
	"tagging-booking-list",
	"pcb-job-order-list",
	"vehicle-list",
	"seal-device-dashboard",
	"seal-billing-rate-list",
	"completed-journeys",
]);

function bind_actions(page) {
	$(page.body)
		.find("[data-route]")
		.on("click", function () {
			const route = $(this).data("route");
			if (!route) return;
			frappe.set_route(...route.split("/"));
		});
}

function get_visible_cards() {
	return TNT_DASHBOARD_CARDS.filter((card) =>
		card.roles.some((role) => frappe.user.has_role(role))
	);
}

function get_card_html(card) {
	const primaryClass = card.primary ? " tsm-card--primary" : "";
	const route = frappe.utils.escape_html(card.route);

	// The Control Room card carries three independent counts (approvals,
	// alerts, arrivals — see dashboard_cards.py's "control-room",
	// "control-room-alerts" and "control-room-arrivals" entries), so each
	// badge gets its own short label directly underneath it instead of the
	// single generic label line other cards use below the title — that line
	// only ever described one of the three counts and went stale/confusing
	// once Alerts and Arrivals were added alongside Approvals.
	if (card.route === "control-room") {
		return `
			<div class="tsm-card${primaryClass}" data-route="${route}">
				<div class="tsm-card__top">
					<div class="tsm-icon">${card.icon}</div>
					<div class="tsm-badges tsm-badges--labeled">
						<div class="tsm-badge-stat">
							<span class="tsm-count is-hidden" data-count="control-room"></span>
							<span class="tsm-badge-label">${__("Approvals")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--alert is-hidden" data-count="control-room-alerts"></span>
							<span class="tsm-badge-label">${__("Alerts")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--arrival is-hidden" data-count="control-room-arrivals"></span>
							<span class="tsm-badge-label">${__("Arrivals")}</span>
						</div>
					</div>
				</div>
				<h3>${__(card.title)}</h3>
			</div>
		`;
	}

	// The Assignments card splits its count into Tagging (Pending Tag-Operator
	// assignments), Untagging (untagging requests raised on arrival) and
	// Retrieval (seal-return requests raised when a seal is unlocked remotely —
	// see dashboard_cards.py's "assignment-list", "assignment-untagging" and
	// "assignment-seal-return" entries), each labeled. This is the PCB Team
	// Leader's single workspace.
	if (card.route === "assignment-list") {
		return `
			<div class="tsm-card${primaryClass}" data-route="${route}">
				<div class="tsm-card__top">
					<div class="tsm-icon">${card.icon}</div>
					<div class="tsm-badges tsm-badges--labeled">
						<div class="tsm-badge-stat">
							<span class="tsm-count is-hidden" data-count="assignment-list"></span>
							<span class="tsm-badge-label">${__("Tagging")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--arrival is-hidden" data-count="assignment-untagging"></span>
							<span class="tsm-badge-label">${__("Untagging")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--arrival is-hidden" data-count="assignment-seal-return"></span>
							<span class="tsm-badge-label">${__("Retrieval")}</span>
						</div>
					</div>
				</div>
				<h3>${__(card.title)}</h3>
			</div>
		`;
	}

	if (card.route === "journey-request-list") {
		return `
			<div class="tsm-card${primaryClass}" data-route="${route}">
				<div class="tsm-card__top">
					<div class="tsm-icon">${card.icon}</div>
					<div class="tsm-badges tsm-badges--labeled">
						<div class="tsm-badge-stat">
							<span class="tsm-count is-hidden" data-count="journey-request-list"></span>
							<span class="tsm-badge-label">${__("Tagging")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--arrival is-hidden" data-count="journey-request-untagging"></span>
							<span class="tsm-badge-label">${__("Untagging")}</span>
						</div>
						<div class="tsm-badge-stat">
							<span class="tsm-count tsm-count--arrival is-hidden" data-count="journey-request-seal-return"></span>
							<span class="tsm-badge-label">${__("Seal Return")}</span>
						</div>
					</div>
				</div>
				<h3>${__(card.title)}</h3>
			</div>
		`;
	}

	return `
		<div class="tsm-card${primaryClass}" data-route="${route}">
			<div class="tsm-card__top">
				<div class="tsm-icon">${card.icon}</div>
				<span class="tsm-count is-hidden" data-count="${route}"></span>
			</div>
			<h3>${__(card.title)}</h3>
			${CARDS_WITHOUT_COUNT_LABELS.has(card.route)
				? ""
				: `<p class="tsm-count-label is-hidden" data-count-label="${route}"></p>`}
		</div>
	`;
}

function load_card_counts(page) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.dashboard_cards.get_card_counts",
		callback(r) {
			const counts = (r && r.message) || {};
			Object.keys(counts).forEach((route) => {
				const { count, label } = counts[route];
				const $badge = $(page.body).find(`[data-count="${CSS.escape(route)}"]`);
				const $label = $(page.body).find(
					`[data-count-label="${CSS.escape(route)}"]`
				);

				$badge.text(count).removeClass("is-hidden");
				if (count > 0) {
					$badge.addClass("tsm-count--active");
				}
				if (label && $label.length) {
					$label.text(__(label)).removeClass("is-hidden");
				}
			});
		},
	});
}

function get_landing_page_html() {
	const cards = get_visible_cards();
	const cardsHtml = cards.length
		? cards.map(get_card_html).join("")
		: `
			<div class="tsm-empty">
				<h3>${__("No dashboard cards available")}</h3>
				<p>${__("Your role does not currently have access to any TNT module.")}</p>
			</div>
		`;

	return `
		<style>
			.tsm-landing {
				max-width: 1120px;
				margin: 0 auto;
				padding: 32px 20px 48px;
				font-family: var(--font-stack);
			}

			.tsm-grid {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 18px;
				margin: 0;
			}

			.tsm-card {
				background: var(--card-bg, #ffffff);
				border: 1px solid rgba(14, 165, 233, 0.2);
				border-radius: 22px;
				padding: 24px;
				cursor: pointer;
				box-shadow: 0 4px 12px rgba(14, 165, 233, 0.05);
			}

			.tsm-card:hover {
				border-color: #38bdf8;
				box-shadow: 0 12px 28px rgba(14, 165, 233, 0.14);
				transform: translateY(-2px);
			}

			.tsm-card--primary {
				background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
				border-color: #bae6fd;
			}

			.tsm-card__top {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				margin-bottom: 16px;
			}

			.tsm-icon {
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

			.tsm-card--primary .tsm-icon {
				background: #0284c7;
				color: #ffffff;
			}

			.tsm-count {
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

			.tsm-count--active {
				background: #0284c7;
				color: #ffffff;
			}

			.tsm-card--primary .tsm-count {
				background: rgba(255, 255, 255, 0.65);
				color: #0c4a6e;
			}

			.tsm-card--primary .tsm-count--active {
				background: #ffffff;
				color: #0284c7;
			}

			.tsm-badges {
				display: flex;
				align-items: center;
				gap: 6px;
			}

			.tsm-badges--labeled {
				gap: 16px;
				align-items: flex-start;
			}
			.tsm-badge-stat {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 5px;
			}
			.tsm-badge-label {
				font-size: 10px;
				font-weight: 800;
				letter-spacing: .04em;
				text-transform: uppercase;
				color: #64748b;
			}
			.tsm-card--primary .tsm-badge-label { color: #0c4a6e; }

			/* Open-alerts badge always reads red, regardless of card variant —
			   placed after the .tsm-card--primary rules above so it wins the
			   specificity tie and isn't repainted blue/white on Control Room. */
			.tsm-count--alert {
				background: #fee2e2;
				color: #b91c1c;
			}

			.tsm-count--alert.tsm-count--active {
				background: #dc2626;
				color: #ffffff;
			}

			/* Arrivals-awaiting-confirmation badge — amber, matching the Arrivals
			   card color in control_room.js. Same specificity-tie reasoning as
			   .tsm-count--alert above. */
			.tsm-count--arrival {
				background: #fef3c7;
				color: #92400e;
			}

			.tsm-count--arrival.tsm-count--active {
				background: #d97706;
				color: #ffffff;
			}

			.tsm-count.is-hidden,
			.tsm-count-label.is-hidden {
				display: none;
			}

			.tsm-card h3 {
				font-size: 19px;
				font-weight: 700;
				margin: 0 0 8px;
				color: #0c4a6e;
			}

			.tsm-count-label {
				font-size: 13px;
				font-weight: 500;
				margin: 0;
				color: #64748b;
			}

			.tsm-empty {
				grid-column: 1 / -1;
				padding: 48px 24px;
				border: 1px dashed #bae6fd;
				border-radius: 22px;
				color: var(--text-muted, #64748b);
				text-align: center;
			}

			.tsm-empty h3 {
				margin: 0 0 8px;
				color: #0c4a6e;
			}

			.tsm-empty p {
				margin: 0;
			}

			/* Dark mode compatibility */
			[data-theme="dark"] .tsm-card {
				background: #1e293b;
				border-color: #334155;
			}
			[data-theme="dark"] .tsm-card h3 {
				color: #f8fafc;
			}
			[data-theme="dark"] .tsm-count {
				background: #334155;
				color: #cbd5e1;
			}
			[data-theme="dark"] .tsm-count--active {
				background: #0284c7;
				color: #ffffff;
			}
			[data-theme="dark"] .tsm-count-label {
				color: #94a3b8;
			}
			[data-theme="dark"] .tsm-badge-label {
				color: #94a3b8;
			}
			[data-theme="dark"] .tsm-card--primary .tsm-badge-label {
				color: #e0f2fe;
			}
			[data-theme="dark"] .tsm-card--primary {
				background: linear-gradient(135deg, #075985 0%, #0369a1 100%);
				border-color: #0284c7;
			}
			[data-theme="dark"] .tsm-count--alert {
				background: #7f1d1d;
				color: #fecaca;
			}
			[data-theme="dark"] .tsm-count--alert.tsm-count--active {
				background: #dc2626;
				color: #ffffff;
			}
			[data-theme="dark"] .tsm-count--arrival {
				background: #78350f;
				color: #fde68a;
			}
			[data-theme="dark"] .tsm-count--arrival.tsm-count--active {
				background: #d97706;
				color: #ffffff;
			}

			@media (max-width: 991px) {
				.tsm-grid {
					grid-template-columns: 1fr;
				}
			}
		</style>

		<div class="tsm-landing">
			<section class="tsm-grid">
				${cardsHtml}
			</section>
		</div>
	`;
}
