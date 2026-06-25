// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt
//
// Billing follow-up list — the Pending Billing seal journeys Finance PCB needs to
// settle. Rows open the per-journey finance page (billing-manage).

frappe.pages["billing-followup-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Billing Follow-up"),
		single_column: true,
	});

	page.bfl_state = { search: "", status: "Pending Billing", page: 1, page_length: 30, total: 0 };

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _bfl_load(page));

	const $statsBar = $('<div class="bfl-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.bfl_stats_bar = $statsBar;

	_bfl_inject_styles();
	_bfl_build(page);
	_bfl_load(page);
};

const BFL_METHOD = "tnt_seal_management.tnt_seal_management.api.billing_followup.get_billing_followup_list";

// Order shown in the status filter dropdown ("All" + the billing statuses).
const BFL_STATUSES = ["Pending Billing", "Billed", "Not Billed", "Cancelled", "All"];

function _bfl_build(page) {
	const statusLabels = {
		"Pending Billing": __("Pending Billing"),
		Billed: __("Billed"),
		"Not Billed": __("Not Billed"),
		Cancelled: __("Cancelled"),
		All: __("All Billing"),
	};

	$(page.body).html(`
		<div class="bfl-page">
			<section class="bfl-panel">
				<div class="bfl-toolbar">
					<div class="bfl-toolbar-top">
						<label class="bfl-field bfl-search-inline">
							<input class="bfl-search" type="search" placeholder="${__("Journey ID, customer, vehicle or container")}">
						</label>

						<div class="bfl-filter-dropdown">
							<button class="bfl-filter-btn">
								<span class="bfl-filter-btn-label">${statusLabels[page.bfl_state.status]}</span>
								<span class="bfl-filter-btn-count">0</span>
								<span class="bfl-filter-arrow">&#9662;</span>
							</button>
							<div class="bfl-filter-menu">
								${BFL_STATUSES.map((status) => `
									<div class="bfl-filter-item ${status === page.bfl_state.status ? "active" : ""}" data-status="${frappe.utils.escape_html(status)}" data-label="${frappe.utils.escape_html(statusLabels[status] || status)}">
										${frappe.utils.escape_html(statusLabels[status] || status)}
										<span class="bfl-fcount" data-fcount="${frappe.utils.escape_html(status)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>
					</div>
				</div>
			</section>

			<section class="bfl-table-panel">
				<div class="bfl-table-scroll"><div class="bfl-table-wrap"></div></div>
				<div class="bfl-pagination"></div>
			</section>

			<div class="bfl-loading" style="display:none"><div class="bfl-spinner"></div></div>
		</div>
	`);

	const onSearch = frappe.utils.debounce(() => {
		page.bfl_state.search = ($(page.body).find(".bfl-search").val() || "").trim();
		page.bfl_state.page = 1;
		_bfl_load(page);
	}, 300);
	$(page.body).on("input", ".bfl-search", onSearch);

	$(page.body).on("click", ".bfl-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".bfl-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".bfl-filter-item", function () {
		page.bfl_state.status = $(this).data("status");
		page.bfl_state.page = 1;
		$(page.body).find(".bfl-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".bfl-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".bfl-filter-menu").removeClass("open");
		_bfl_load(page);
	});

	$(document).on("click.bfl-dropdown", function () {
		$(page.body).find(".bfl-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".bfl-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("billing-manage", name);
	});

	$(page.body).on("click", ".bfl-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.bfl_state.page = Number.parseInt($(this).data("page"), 10);
		_bfl_load(page);
	});
}

function _bfl_load(page) {
	$(page.body).find(".bfl-loading").show();
	frappe.call({
		method: BFL_METHOD,
		args: {
			search: page.bfl_state.search,
			status: page.bfl_state.status,
			page: page.bfl_state.page,
			page_length: page.bfl_state.page_length,
		},
		callback(r) {
			$(page.body).find(".bfl-loading").hide();
			const data = r.message || {};
			page.bfl_state.total = data.total || 0;
			_bfl_render_stats(page, data.summary || {});
			_bfl_render_table(page, data.journeys || []);
			_bfl_render_pagination(page);
		},
		error() {
			$(page.body).find(".bfl-loading").hide();
			frappe.show_alert({ message: __("Could not load billing follow-up"), indicator: "red" }, 5);
		},
	});
}

function _bfl_render_stats(page, summary) {
	const byStatus = summary.by_status || {};
	const pending = byStatus["Pending Billing"] ?? summary.count ?? 0;
	const billed = byStatus.Billed ?? 0;
	const notBilled = byStatus["Not Billed"] ?? 0;
	const cancelled = byStatus.Cancelled ?? 0;

	const html = `
		<div class="bfl-stat-card bfl-stat--pending">
			<div class="bfl-stat-label">${__("Pending")}</div>
			<div class="bfl-stat-value">${pending}</div>
		</div>
		<div class="bfl-stat-card bfl-stat--amount">
			<div class="bfl-stat-label">${__("Outstanding")}</div>
			<div class="bfl-stat-value">${format_currency(summary.outstanding || 0)}</div>
		</div>
		<div class="bfl-stat-card bfl-stat--billed">
			<div class="bfl-stat-label">${__("Billed")}</div>
			<div class="bfl-stat-value">${billed}</div>
		</div>
		<div class="bfl-stat-card bfl-stat--muted">
			<div class="bfl-stat-label">${__("Not Billed")}</div>
			<div class="bfl-stat-value">${notBilled}</div>
		</div>
	`;
	if (page.bfl_stats_bar) {
		page.bfl_stats_bar.html(html);
	}

	const countMap = {
		"Pending Billing": pending,
		Billed: billed,
		"Not Billed": notBilled,
		Cancelled: cancelled,
		All: byStatus.All ?? (pending + billed + notBilled + cancelled),
	};
	$(page.body).find(".bfl-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	$(page.body).find(".bfl-filter-btn-count").text(countMap[page.bfl_state.status] ?? 0);
}

function _bfl_render_table(page, journeys) {
	if (!journeys.length) {
		$(page.body).find(".bfl-table-wrap").html(`
			<div class="bfl-empty">
				<div class="bfl-empty-icon">💵</div>
				<h3>${__("Nothing to settle")}</h3>
				<p>${__("Journeys awaiting billing settlement will appear here.")}</p>
			</div>
		`);
		return;
	}

	const rows = journeys
		.map((j) => {
			const completed = j.completion_date_time
				? frappe.datetime.str_to_user(j.completion_date_time)
				: "—";
			const billingStatus = j.billing_status || "Not Billed";
			return `
				<tr class="bfl-row" data-name="${frappe.utils.escape_html(j.name)}">
					<td>${frappe.utils.escape_html(j.name)}</td>
					<td>${frappe.utils.escape_html(j.customer || "—")}</td>
					<td>${frappe.utils.escape_html(j.vehicle_plate_number || "—")}</td>
					<td>${frappe.utils.escape_html(j.container_number || "—")}</td>
					<td class="text-right">${cint(j.billable_days)}</td>
					<td class="text-right bfl-amount">${format_currency(j.total_charge || 0)}</td>
					<td>${completed}</td>
					<td><span class="bfl-badge ${_bfl_badge_class(billingStatus)}">${__(billingStatus)}</span></td>
				</tr>
			`;
		})
		.join("");

	$(page.body).find(".bfl-table-wrap").html(`
		<table class="bfl-table">
			<thead>
				<tr>
					<th>${__("Journey")}</th>
					<th>${__("Customer")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Container")}</th>
					<th class="text-right">${__("Billable Days")}</th>
					<th class="text-right">${__("Total Charge")}</th>
					<th>${__("Completed")}</th>
					<th>${__("Status")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`);
}

function _bfl_badge_class(status) {
	return (
		{
			"Pending Billing": "bfl-badge--pending",
			Billed: "bfl-badge--billed",
			Cancelled: "bfl-badge--cancelled",
		}[status] || "bfl-badge--muted"
	);
}

function _bfl_render_pagination(page) {
	const state = page.bfl_state;
	const totalPages = Math.max(1, Math.ceil(state.total / state.page_length));
	state.page = Math.min(state.page, totalPages);
	const start = state.total ? (state.page - 1) * state.page_length + 1 : 0;
	const end = Math.min(state.page * state.page_length, state.total);
	$(page.body).find(".bfl-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, state.total])}</span>
		<div>
			<button class="bfl-page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [state.page, totalPages])}</b>
			<button class="bfl-page-btn" data-page="${state.page + 1}" ${state.page >= totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _bfl_inject_styles() {
	const id = "billing-followup-list-styles";
	if (document.getElementById(id)) return;
	const style = document.createElement("style");
	style.id = id;
	style.textContent = `
		.bfl-page {
			--bfl-blue: #0284c7;
			--bfl-dark: #075985;
			--bfl-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		.bfl-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.bfl-header-stats .bfl-stat-card {
			display: flex;
			min-height: unset;
			padding: 6px 14px;
			flex-direction: row;
			align-items: center;
			gap: 8px;
			border-radius: 999px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-top: 1px solid #075985;
			background: var(--card-bg, #fff);
			white-space: nowrap;
		}
		.bfl-header-stats .bfl-stat--pending { border-top-color: #f59e0b; }
		.bfl-header-stats .bfl-stat--amount { border-top-color: var(--bfl-blue); }
		.bfl-header-stats .bfl-stat--billed { border-top-color: #16a34a; }
		.bfl-header-stats .bfl-stat--muted { border-top-color: #64748b; }
		.bfl-header-stats .bfl-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.bfl-header-stats .bfl-stat-value {
			color: var(--bfl-ink);
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		.bfl-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.bfl-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.bfl-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		.bfl-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.bfl-toolbar-top { display: flex; align-items: center; gap: 12px; }
		.bfl-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.bfl-search-inline { flex: 1; display: flex; align-items: center; }
		.bfl-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.bfl-search-inline input:focus {
			outline: none;
			border-color: var(--bfl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		.bfl-filter-dropdown { position: relative; }
		.bfl-filter-btn {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			height: 38px;
			padding: 0 14px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
			transition: border-color .15s;
		}
		.bfl-filter-btn:hover { border-color: var(--bfl-blue); }
		.bfl-filter-btn-count,
		.bfl-fcount {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 22px;
			padding: 1px 6px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #075985;
			font-size: 11px;
			font-weight: 800;
		}
		.bfl-filter-arrow { color: #94a3b8; font-size: 11px; }
		.bfl-filter-menu {
			display: none;
			position: fixed;
			min-width: 240px;
			border: 1px solid #bae6fd;
			border-radius: 12px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .12);
			z-index: 1000;
			overflow: hidden;
		}
		.bfl-filter-menu.open { display: block; }
		.bfl-filter-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 10px 16px;
			font-size: 13px;
			font-weight: 600;
			color: #334155;
			cursor: pointer;
			transition: background .12s;
		}
		.bfl-filter-item:hover { background: #f0f9ff; }
		.bfl-filter-item.active { background: #e0f2fe; color: var(--bfl-blue); }
		.bfl-filter-item.active .bfl-fcount { background: var(--bfl-blue); color: #fff; }

		.bfl-table { width: 100%; min-width: 1180px; border-collapse: collapse; table-layout: auto; }
		.bfl-table th,
		.bfl-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.bfl-table th {
			position: sticky;
			top: 0;
			z-index: 10;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.bfl-row { cursor: pointer; }
		.bfl-row:hover { background: rgba(224, 242, 254, .7); }
		.bfl-row td:first-child { border-left: 3px solid transparent; }
		.bfl-row:hover td:first-child { border-left-color: var(--bfl-blue); }
		.bfl-row td:first-child { color: var(--bfl-blue); font-weight: 800; }
		.bfl-amount { font-weight: 800; color: var(--bfl-ink); }
		.text-right { text-align: right !important; }
		.bfl-badge { display: inline-flex; border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 800; white-space: nowrap; }
		.bfl-badge--pending { background: #fef3c7; color: #92400e; }
		.bfl-badge--billed { background: #dcfce7; color: #166534; }
		.bfl-badge--cancelled { background: #fee2e2; color: #b91c1c; }
		.bfl-badge--muted { background: #e2e8f0; color: #475569; }

		.bfl-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 58px 20px; color: var(--text-muted, #64748b); text-align: center; }
		.bfl-empty-icon { font-size: 36px; }
		.bfl-empty h3 { color: var(--bfl-ink); font-size: 22px; margin: 0; }
		.bfl-empty p { margin: 0; }

		.bfl-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.bfl-pagination div { display: flex; align-items: center; gap: 9px; }
		.bfl-pagination b { font-weight: 700; }
		.bfl-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.bfl-page-btn:disabled { cursor: default; opacity: .45; }

		.bfl-loading {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: 22px;
			background: rgba(240, 249, 255, .72);
			backdrop-filter: blur(2px);
		}
		.bfl-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--bfl-blue);
			border-radius: 50%;
			animation: bfl-spin .7s linear infinite;
		}
		@keyframes bfl-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .bfl-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .bfl-panel,
		[data-theme="dark"] .bfl-table-panel,
		[data-theme="dark"] .bfl-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .bfl-search-inline input,
		[data-theme="dark"] .bfl-filter-btn,
		[data-theme="dark"] .bfl-filter-menu {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .bfl-toolbar,
		[data-theme="dark"] .bfl-table th,
		[data-theme="dark"] .bfl-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .bfl-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .bfl-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .bfl-filter-item { color: #cbd5e1; }
		[data-theme="dark"] .bfl-filter-item:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .bfl-filter-item.active { background: rgba(14, 165, 233, .2); color: #7dd3fc; }
		[data-theme="dark"] .bfl-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.bfl-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.bfl-page { padding: 10px 8px 32px; }
			.bfl-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
