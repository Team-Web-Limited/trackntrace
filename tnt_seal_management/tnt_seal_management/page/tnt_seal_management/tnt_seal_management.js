frappe.pages["tnt-seal-management"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "TNT Seal Management",
		single_column: true,
	});

	$(page.body).html(get_landing_page_html());
	bind_actions(page);
};

const TNT_DASHBOARD_CARDS = [
	{
		title: "Seal Journeys",
		icon: "🚚",
		route: "List/Seal Journey",
		primary: true,
		roles: ["System Manager", "Finance PCB", "Operations Control Room"],
	},
	{
		title: "Journey Requests",
		icon: "🧾",
		route: "journey-request-list",
		roles: [
			"System Manager",
			"Customer Care",
			"Management",
			"Operations Control Room",
			"Field Technician",
		],
	},
	{
		title: "Tagging Bookings",
		icon: "📅",
		route: "tagging-booking-list",
		primary: true,
		roles: ["System Manager", "Account Manager", "Finance PCB", "Management"],
	},
	{
		title: "PCB Job Orders",
		icon: "📋",
		route: "pcb-job-order-list",
		roles: ["System Manager", "Finance PCB", "Management"],
	},
	{
		title: "Assignments",
		icon: "👷",
		route: "assignment-list",
		primary: true,
		roles: ["System Manager", "PCB Team Leader", "Management"],
	},
	{
		title: "Current Customers",
		icon: "🏢",
		route: "current-customer-list",
		roles: [
			"System Manager",
			"Account Manager",
			"Customer Care",
			"Finance PCB",
			"Management",
			"Operations Control Room",
		],
	},
	{
		title: "Vehicles",
		icon: "🚘",
		route: "vehicle-list",
		roles: ["System Manager", "Management"],
	},
	{
		title: "Seal Device",
		icon: "🔒",
		route: "seal-device-dashboard",
		roles: [
			"System Manager",
			"Seal System Administrator",
			"Operations Control Room",
			"Management",
		],
	},
	{
		title: "Billing Rates",
		icon: "💰",
		route: "List/Seal Billing Rate",
		roles: ["System Manager", "Finance PCB", "Management"],
	},
	{
		title: "Tracking Dashboard",
		icon: "🗺",
		route: "seal-tracking-dashboard",
		primary: true,
		roles: [
			"System Manager",
			"Seal System Administrator",
			"Operations Control Room",
			"Management",
		],
	},
	{
		title: "Journey Monitoring",
		icon: "📡",
		route: "journey-monitoring",
		primary: true,
		roles: [
			"System Manager",
			"Seal System Administrator",
			"Operations Control Room",
			"Management",
		],
	},
	{
		title: "Seal Settings",
		icon: "⚙️",
		route: "Form/Seal API Settings",
		roles: ["System Manager"],
	},
];

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

	return `
		<div class="tsm-card${primaryClass}" data-route="${frappe.utils.escape_html(card.route)}">
			<div class="tsm-icon">${card.icon}</div>
			<h3>${__(card.title)}</h3>
		</div>
	`;
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

			.tsm-icon {
				width: 54px;
				height: 54px;
				border-radius: 16px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				font-size: 28px;
				margin-bottom: 16px;
				background: #e0f2fe;
				color: #0284c7;
			}
			
			.tsm-card--primary .tsm-icon {
				background: #0284c7;
				color: #ffffff;
			}

			.tsm-card h3 {
				font-size: 19px;
				font-weight: 700;
				margin: 0 0 8px;
				color: #0c4a6e;
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
			[data-theme="dark"] .tsm-card--primary {
				background: linear-gradient(135deg, #075985 0%, #0369a1 100%);
				border-color: #0284c7;
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
