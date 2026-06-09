frappe.pages["tnt-seal-management"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "TNT Seal Management",
		single_column: true,
	});

	$(page.body).html(get_landing_page_html());
	bind_actions(page);
};

function bind_actions(page) {
	$(page.body)
		.find("[data-route]")
		.on("click", function () {
			const route = $(this).data("route");
			if (!route) return;
			frappe.set_route(...route.split("/"));
		});
}

function get_landing_page_html() {
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
				border-color: rgba(14, 165, 233, 0.2);
				box-shadow: 0 4px 12px rgba(14, 165, 233, 0.05);
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
				<div class="tsm-card tsm-card--primary" data-route="List/Seal Journey">
					<div class="tsm-icon">🚚</div>
					<h3>Seal Journeys</h3>
				</div>
				<div class="tsm-card" data-route="List/Tagging Request">
					<div class="tsm-icon">📸</div>
					<h3>Tagging Requests</h3>
				</div>
				<div class="tsm-card" data-route="List/Seal Device">
					<div class="tsm-icon">🔒</div>
					<h3>Seal Device</h3>
				</div>
				<div class="tsm-card" data-route="List/Seal Billing Rate">
					<div class="tsm-icon">💰</div>
					<h3>Billing Rates</h3>
				</div>
				<div class="tsm-card" data-route="Form/Seal API Settings">
					<div class="tsm-icon">⚙️</div>
					<h3>API Settings</h3>
				</div>
			</section>
		</div>
	`;
}
