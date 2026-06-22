frappe.pages["vehicle-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Vehicles"),
		single_column: true,
	});

	page.vehicle_state = {
		search: "",
		status: "All",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _vehicle_load(page));
	page.set_primary_action(__("New Vehicle"), () => frappe.new_doc("Vehicle"));

	const $statsBar = $('<div class="vh-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.vh_stats_bar = $statsBar;

	_vehicle_inject_styles();
	_vehicle_build_page(page);
	_vehicle_load(page);
};

function _vehicle_build_page(page) {
	const statuses = [
		["All", __("All Vehicles")],
		["Active", __("Active")],
		["Maintenance", __("Maintenance")],
		["Inactive", __("Inactive")],
	];

	$(page.body).html(`
		<div class="vh-page">
			<section class="vh-panel">
				<div class="vh-toolbar">
					<div class="vh-toolbar-top">
						<label class="vh-field vh-search-inline">
							<input class="vh-search" type="search" placeholder="${__("Vehicle, registration, make, model or color")}">
						</label>

						<div class="vh-filter-dropdown">
							<button class="vh-filter-btn">
								<span class="vh-filter-btn-label">${__("All Vehicles")}</span>
								<span class="vh-filter-btn-count">0</span>
								<span class="vh-filter-arrow">&#9662;</span>
							</button>
							<div class="vh-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="vh-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="vh-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<div class="vh-actions">
							<button class="vh-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="vh-table-panel">
				<div class="vh-table-scroll"><div class="vh-table-wrap"></div></div>
				<div class="vh-pagination"></div>
			</section>

			<div class="vh-loading" style="display:none"><div class="vh-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _vehicle_debounce(() => {
		page.vehicle_state.search = ($(page.body).find(".vh-search").val() || "").trim();
		page.vehicle_state.page = 1;
		_vehicle_load(page);
	}, 350);

	$(page.body).on("input", ".vh-search", delayedSearch);

	$(page.body).on("click", ".vh-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".vh-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".vh-filter-item", function () {
		page.vehicle_state.status = $(this).data("status");
		page.vehicle_state.page = 1;
		$(page.body).find(".vh-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".vh-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".vh-filter-menu").removeClass("open");
		_vehicle_load(page);
	});

	$(document).on("click.vh-dropdown", function () {
		$(page.body).find(".vh-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".vh-clear-btn", () => _vehicle_clear(page));

	$(page.body).on("click", ".vh-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Vehicle", name);
	});

	$(page.body).on("click", ".vh-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.vehicle_state.page = Number.parseInt($(this).data("page"), 10);
		_vehicle_load(page);
	});
}

function _vehicle_load(page) {
	const requestId = ++page.vehicle_state.request_id;
	_vehicle_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.vehicle.vehicle.get_vehicle_list",
		args: {
			search: page.vehicle_state.search,
			status: page.vehicle_state.status,
			page: page.vehicle_state.page,
			page_length: page.vehicle_state.page_length,
		},
		callback(r) {
			if (requestId !== page.vehicle_state.request_id) return;
			_vehicle_set_loading(page, false);
			const data = r.message || {};
			page.vehicle_state.total = data.total || 0;
			_vehicle_render_stats(page, data.summary || {});
			_vehicle_render_table(page, data.vehicles || []);
			_vehicle_render_pagination(page);
		},
		error() {
			if (requestId !== page.vehicle_state.request_id) return;
			_vehicle_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load vehicles"), indicator: "red" }, 5);
		},
	});
}

function _vehicle_render_stats(page, summary) {
	const html = `
		<div class="vh-stat-card">
			<div class="vh-stat-label">${__("All")}</div>
			<div class="vh-stat-value">${summary.All || 0}</div>
		</div>
		<div class="vh-stat-card vh-stat--active">
			<div class="vh-stat-label">${__("Active")}</div>
			<div class="vh-stat-value">${summary.Active || 0}</div>
		</div>
		<div class="vh-stat-card vh-stat--maintenance">
			<div class="vh-stat-label">${__("Maintenance")}</div>
			<div class="vh-stat-value">${summary.Maintenance || 0}</div>
		</div>
		<div class="vh-stat-card vh-stat--inactive">
			<div class="vh-stat-label">${__("Inactive")}</div>
			<div class="vh-stat-value">${summary.Inactive || 0}</div>
		</div>
	`;
	if (page.vh_stats_bar) {
		page.vh_stats_bar.html(html);
	}

	const countMap = {
		"All": summary.All || 0,
		"Active": summary.Active || 0,
		"Maintenance": summary.Maintenance || 0,
		"Inactive": summary.Inactive || 0,
	};
	$(page.body).find(".vh-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	const currentCount = countMap[page.vehicle_state.status] ?? 0;
	$(page.body).find(".vh-filter-btn-count").text(currentCount);
}

function _vehicle_render_table(page, vehicles) {
	if (!vehicles.length) {
		$(page.body).find(".vh-table-wrap").html(`
			<div class="vh-empty">
				<strong>${__("No vehicles found")}</strong>
				<span>${__("Add a vehicle or clear the filters to see more records.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".vh-table-wrap").html(`
		<table class="vh-table">
			<thead><tr>
				<th>${__("Vehicle")}</th>
				<th>${__("Registration")}</th>
				<th>${__("Make")}</th>
				<th>${__("Model")}</th>
				<th>${__("Color")}</th>
				<th>${__("Year")}</th>
				<th>${__("Status")}</th>
			</tr></thead>
			<tbody>${vehicles.map(_vehicle_row_html).join("")}</tbody>
		</table>
	`);
}

function _vehicle_row_html(vehicle) {
	const status = vehicle.vehicle_status || __("Active");
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	return `
		<tr class="vh-row" data-name="${frappe.utils.escape_html(vehicle.name)}">
			<td><span class="vh-name">${frappe.utils.escape_html(vehicle.name)}</span></td>
			<td>${frappe.utils.escape_html(vehicle.registration_number || "—")}</td>
			<td>${frappe.utils.escape_html(vehicle.vehicle_make || "—")}</td>
			<td>${frappe.utils.escape_html(vehicle.vehicle_model || "—")}</td>
			<td>${frappe.utils.escape_html(vehicle.color || "—")}</td>
			<td>${frappe.utils.escape_html(String(vehicle.year_of_manufacture || "—"))}</td>
			<td><span class="vh-badge vh-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
		</tr>
	`;
}

function _vehicle_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.vehicle_state.total / page.vehicle_state.page_length));
	page.vehicle_state.page = Math.min(page.vehicle_state.page, pages);
	const start = page.vehicle_state.total
		? (page.vehicle_state.page - 1) * page.vehicle_state.page_length + 1
		: 0;
	const end = Math.min(page.vehicle_state.page * page.vehicle_state.page_length, page.vehicle_state.total);
	$(page.body).find(".vh-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.vehicle_state.total])}</span>
		<div>
			<button class="vh-page-btn" data-page="${page.vehicle_state.page - 1}" ${page.vehicle_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.vehicle_state.page, pages])}</b>
			<button class="vh-page-btn" data-page="${page.vehicle_state.page + 1}" ${page.vehicle_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _vehicle_clear(page) {
	Object.assign(page.vehicle_state, {
		search: "",
		status: "All",
		page: 1,
	});
	$(page.body).find(".vh-search").val("");
	$(page.body).find(".vh-filter-item").removeClass("active");
	$(page.body).find('.vh-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".vh-filter-btn-label").text(__("All Vehicles"));
	_vehicle_load(page);
}

function _vehicle_set_loading(page, show) {
	$(page.body).find(".vh-loading").toggle(show);
}

function _vehicle_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _vehicle_inject_styles() {
	if (document.getElementById("vehicle-list-styles")) return;
	const style = document.createElement("style");
	style.id = "vehicle-list-styles";
	style.textContent = `
		.vh-page {
			--vh-blue: #0284c7;
			--vh-dark: #075985;
			--vh-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.vh-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.vh-header-stats .vh-stat-card {
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
		.vh-header-stats .vh-stat--active      { border-top-color: var(--vh-blue); }
		.vh-header-stats .vh-stat--maintenance { border-top-color: #f59e0b; }
		.vh-header-stats .vh-stat--inactive    { border-top-color: #64748b; }
		.vh-header-stats .vh-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.vh-header-stats .vh-stat-value {
			color: var(--vh-ink);
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.vh-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.vh-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.vh-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.vh-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.vh-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.vh-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.vh-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.vh-search-inline input:focus {
			outline: none;
			border-color: var(--vh-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.vh-filter-dropdown { position: relative; }
		.vh-filter-btn {
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
		.vh-filter-btn:hover { border-color: var(--vh-blue); }
		.vh-filter-btn-count {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 20px;
			padding: 1px 6px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #075985;
			font-size: 11px;
			font-weight: 800;
		}
		.vh-filter-arrow { color: #94a3b8; font-size: 11px; }
		.vh-filter-menu {
			display: none;
			position: fixed;
			min-width: 220px;
			border: 1px solid #bae6fd;
			border-radius: 12px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .12);
			z-index: 1000;
			overflow: hidden;
		}
		.vh-filter-menu.open { display: block; }
		.vh-filter-item {
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
		.vh-filter-item:hover { background: #f0f9ff; }
		.vh-filter-item.active { background: #e0f2fe; color: var(--vh-blue); }
		.vh-fcount {
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
		.vh-filter-item.active .vh-fcount { background: var(--vh-blue); color: #fff; }

		/* ---- field wrapper ---- */
		.vh-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }

		/* ---- actions ---- */
		.vh-actions { display: flex; gap: 8px; }
		.vh-clear-btn {
			padding: 9px 16px;
			border: 1px solid #cbd5e1;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #475569;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			height: 38px;
			transition: background .12s, border-color .12s;
		}
		.vh-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.vh-table {
			width: 100%;
			min-width: 1240px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.vh-table th,
		.vh-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.vh-table th {
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
		.vh-row { cursor: pointer; }
		.vh-row:hover { background: rgba(224, 242, 254, .7); }
		.vh-row td:first-child { border-left: 3px solid transparent; }
		.vh-row:hover td:first-child { border-left-color: var(--vh-blue); }
		.vh-name { color: var(--vh-blue); font-size: 14px; font-weight: 800; }
		.vh-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.vh-badge--active      { background: #dbeafe; color: #1d4ed8; }
		.vh-badge--maintenance { background: #fef3c7; color: #b45309; }
		.vh-badge--inactive    { background: #e2e8f0; color: #475569; }
		.vh-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.vh-empty strong {
			color: var(--vh-ink);
			font-size: 22px;
		}

		/* ---- pagination ---- */
		.vh-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.vh-pagination div { display: flex; align-items: center; gap: 9px; }
		.vh-pagination b { font-weight: 700; }
		.vh-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.vh-page-btn:disabled { cursor: default; opacity: .45; }

		/* ---- loading overlay ---- */
		.vh-loading {
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
		.vh-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--vh-blue);
			border-radius: 50%;
			animation: vh-spin .7s linear infinite;
		}
		@keyframes vh-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .vh-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .vh-panel,
		[data-theme="dark"] .vh-table-panel,
		[data-theme="dark"] .vh-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .vh-search-inline input,
		[data-theme="dark"] .vh-filter-btn,
		[data-theme="dark"] .vh-filter-menu,
		[data-theme="dark"] .vh-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .vh-toolbar,
		[data-theme="dark"] .vh-table th,
		[data-theme="dark"] .vh-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .vh-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .vh-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .vh-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.vh-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.vh-page { padding: 10px 8px 32px; }
			.vh-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
