frappe.pages["control-room"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Control Room"),
		single_column: true,
	});

	page.control_room_state = {
		tab: "approve",
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	_control_room_inject_styles();
	_control_room_render(page);
};

function _control_room_render(page) {
	$(page.body).html(`
		<div class="cr-page">
			<section class="cr-hero">
				<div>
					<h2>${__("Control Room")}</h2>
				</div>
			</section>
			<section class="cr-panel">
				<div class="cr-tabs">
					<button class="cr-tab ${page.control_room_state.tab === "approve" ? "active" : ""}" data-tab="approve">${__("Approve")}</button>
					<button class="cr-tab ${page.control_room_state.tab === "alert" ? "active" : ""}" data-tab="alert">${__("Alert")}</button>
				</div>
				<div class="cr-tab-body">${_control_room_tab_html(page.control_room_state.tab)}</div>
			</section>
		</div>
	`);

	$(page.body)
		.off("click", ".cr-tab")
		.on("click", ".cr-tab", function () {
			const tab = $(this).data("tab");
			if (!tab || tab === page.control_room_state.tab) return;
			page.control_room_state.tab = tab;
			_control_room_render(page);
		});
}

function _control_room_tab_html(tab) {
	if (tab === "alert") {
		return `
			<div class="cr-grid">
				<div class="cr-card cr-card--alert">
					<span class="cr-card-label">${__("Alert Queue")}</span>
					<h3>${__("Operational alerts will appear here")}</h3>
					<p>${__("Use this tab for seal exceptions, journey disruptions, low battery signals, and other control-room escalations.")}</p>
				</div>
				<div class="cr-card">
					<span class="cr-card-label">${__("Suggested next step")}</span>
					<h3>${__("Wire this tab to live alert sources")}</h3>
					<p>${__("This page is ready for the alert workflow once you decide which documents or API events should feed the queue.")}</p>
				</div>
			</div>
		`;
	}

	return `
		<div class="cr-grid">
			<div class="cr-card cr-card--approve">
				<span class="cr-card-label">${__("Approval Queue")}</span>
				<h3>${__("Approval work will appear here")}</h3>
				<p>${__("Use this tab for items that the control room team needs to approve, verify, or dispatch before a journey moves forward.")}</p>
			</div>
			<div class="cr-card">
				<span class="cr-card-label">${__("Suggested next step")}</span>
				<h3>${__("Connect this tab to pending requests")}</h3>
				<p>${__("This page is ready for the next step when you want to surface live approval queues such as journey requests or control-room checkpoints.")}</p>
			</div>
		</div>
	`;
}

function _control_room_inject_styles() {
	if (document.getElementById("control-room-page-styles")) return;

	const style = document.createElement("style");
	style.id = "control-room-page-styles";
	style.textContent = `
		.cr-page {
			max-width: 1440px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			font-family: var(--font-stack);
		}
		.cr-hero {
			margin-bottom: 20px;
			padding: 28px 30px;
			border: 1px solid rgba(14, 165, 233, .18);
			border-radius: 24px;
			background: linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .08);
		}
		.cr-eyebrow {
			margin: 0 0 10px;
			color: #0369a1;
			font-size: 12px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.cr-hero h2 {
			margin: 0 0 8px;
			color: #0f172a;
			font-size: 30px;
			font-weight: 800;
		}
		.cr-subtitle {
			margin: 0;
			max-width: 760px;
			color: #334155;
			font-size: 15px;
			line-height: 1.6;
		}
		.cr-panel {
			border: 1px solid rgba(14, 165, 233, .18);
			border-radius: 24px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .06);
			overflow: hidden;
		}
		.cr-tabs {
			display: flex;
			gap: 10px;
			padding: 18px;
			border-bottom: 1px solid #dbeafe;
			background: #f8fbff;
		}
		.cr-tab {
			border: 1px solid #bfdbfe;
			border-radius: 999px;
			background: #fff;
			color: #075985;
			padding: 10px 18px;
			font-size: 13px;
			font-weight: 800;
			cursor: pointer;
		}
		.cr-tab.active {
			border-color: #0284c7;
			background: #0284c7;
			color: #fff;
		}
		.cr-tab-body {
			padding: 24px;
		}
		.cr-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 18px;
		}
		.cr-card {
			min-height: 220px;
			padding: 24px;
			border: 1px solid #dbeafe;
			border-radius: 22px;
			background: #fff;
		}
		.cr-card--approve {
			background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
		}
		.cr-card--alert {
			background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
		}
		.cr-card-label {
			display: inline-flex;
			margin-bottom: 12px;
			color: #0369a1;
			font-size: 12px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.cr-card h3 {
			margin: 0 0 10px;
			color: #0f172a;
			font-size: 22px;
			font-weight: 800;
		}
		.cr-card p {
			margin: 0;
			color: #475569;
			font-size: 14px;
			line-height: 1.65;
		}
		[data-theme="dark"] .cr-hero,
		[data-theme="dark"] .cr-panel,
		[data-theme="dark"] .cr-card,
		[data-theme="dark"] .cr-tab {
			background: #1e293b;
			border-color: #334155;
			color: #f8fafc;
		}
		[data-theme="dark"] .cr-tabs {
			background: #0f172a;
			border-color: #334155;
		}
		[data-theme="dark"] .cr-eyebrow,
		[data-theme="dark"] .cr-card-label {
			color: #7dd3fc;
		}
		[data-theme="dark"] .cr-hero h2,
		[data-theme="dark"] .cr-card h3 {
			color: #f8fafc;
		}
		[data-theme="dark"] .cr-subtitle,
		[data-theme="dark"] .cr-card p {
			color: #cbd5e1;
		}
		[data-theme="dark"] .cr-tab.active {
			border-color: #0284c7;
			background: #0284c7;
			color: #fff;
		}
		@media (max-width: 900px) {
			.cr-grid {
				grid-template-columns: 1fr;
			}
		}
		@media (max-width: 640px) {
			.cr-page {
				padding: 18px 10px 32px;
			}
			.cr-hero,
			.cr-tab-body {
				padding: 18px;
			}
			.cr-tabs {
				flex-wrap: wrap;
			}
		}
	`;
	document.head.appendChild(style);
}
