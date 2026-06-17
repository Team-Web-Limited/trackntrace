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
	page.set_primary_action(__("New Vehicle"), () => frappe.new_doc("Vehicle"));

	_vehicle_inject_styles();
	_vehicle_build_page(page);
	_vehicle_load(page);
};

function _vehicle_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Active", __("Active")],
		["Maintenance", __("Maintenance")],
		["Inactive", __("Inactive")],
	];

	$(page.body).html(`
		<div class="vh-page">
			<section class="vh-stats"></section>
			<section class="vh-panel">
				<div class="vh-toolbar">
					<div class="vh-toolbar-row">
						<div class="vh-status-filters">
							${statuses.map(([value, label]) => `
								<button class="vh-status-btn ${value === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(value)}">
									${frappe.utils.escape_html(label)}
								</button>
							`).join("")}
						</div>
						<div class="vh-filter-grid">
							<label class="vh-field">
								<input class="vh-search" type="search" placeholder="${__("Vehicle, registration, make, model or color")}">
							</label>
							<div class="vh-actions">
								<button class="vh-clear-btn">${__("Clear filters")}</button>
								<button class="vh-refresh-btn">${__("Refresh")}</button>
							</div>
						</div>
					</div>
				</div>
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
	$(page.body).on("click", ".vh-status-btn", function () {
		$(page.body).find(".vh-status-btn").removeClass("active");
		$(this).addClass("active");
		page.vehicle_state.status = $(this).data("status");
		page.vehicle_state.page = 1;
		_vehicle_load(page);
	});
	$(page.body).on("click", ".vh-refresh-btn", () => _vehicle_load(page));
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
	const stats = [
		[__("All Vehicles"), summary.All || 0, "all"],
		[__("Active"), summary.Active || 0, "active"],
		[__("Maintenance"), summary.Maintenance || 0, "maintenance"],
		[__("Inactive"), summary.Inactive || 0, "inactive"],
	];
	$(page.body).find(".vh-stats").html(
		stats.map(([label, value, variant]) => `
			<div class="vh-stat vh-stat--${variant}">
				<span>${frappe.utils.escape_html(label)}</span><strong>${value}</strong>
			</div>
		`).join("")
	);
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
	$(page.body).find(".vh-status-btn").removeClass("active");
	$(page.body).find('.vh-status-btn[data-status="All"]').addClass("active");
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
			max-width: 1520px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}
		.vh-stats {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 18px;
			margin-bottom: 18px;
		}
		.vh-stat {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			min-height: 86px;
			padding: 18px 20px;
			border: 1px solid rgba(14,165,233,.2);
			border-top: 4px solid #38bdf8;
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14,165,233,.05);
		}
		.vh-stat--all,
		.vh-stat--maintenance { background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border-color: #bae6fd; }
		.vh-stat--all { border-top-color: #075985; }
		.vh-stat--active { border-top-color: #0284c7; }
		.vh-stat--maintenance { border-top-color: #f59e0b; }
		.vh-stat--inactive { border-top-color: #64748b; }
		.vh-stat span { max-width: 130px; color: #0369a1; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
		.vh-stat strong { color: #0c4a6e; font-size: 34px; line-height: 1; }
		.vh-panel { overflow: hidden; border: 1px solid rgba(14,165,233,.2); border-radius: 22px; background: var(--card-bg,#fff); box-shadow: 0 4px 12px rgba(14,165,233,.05); }
		.vh-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.vh-toolbar-row { display: grid; grid-template-columns: auto minmax(560px, 1fr); gap: 18px; align-items: end; }
		.vh-status-filters { display: flex; gap: 8px; overflow-x: auto; }
		.vh-status-btn,
		.vh-clear-btn,
		.vh-refresh-btn,
		.vh-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg,#fff);
			color: #075985;
			padding: 9px 15px;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.vh-status-btn.active,
		.vh-refresh-btn { border-color: var(--vh-blue); background: var(--vh-blue); color: #fff; }
		.vh-filter-grid { display: grid; grid-template-columns: minmax(420px,1fr) auto; align-items: end; gap: 12px; }
		.vh-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.vh-field > span { color: #0369a1; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
		.vh-field input,
		.vh-field select {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg,#fff);
			color: var(--text-color,#0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.vh-actions { display: flex; justify-content: flex-end; gap: 8px; padding-bottom: 1px; }
		.vh-table-scroll { overflow-x: auto; }
		.vh-table { width: 100%; min-width: 1240px; border-collapse: collapse; }
		.vh-table th,
		.vh-table td { padding: 16px 18px; border-bottom: 1px solid #e0f2fe; text-align: left; vertical-align: middle; color: var(--text-color,#334155); font-size: 14px; line-height: 1.45; }
		.vh-table th { background: #f0f9ff; color: #0369a1; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.vh-row { cursor: pointer; }
		.vh-row:hover { background: rgba(224,242,254,.7); }
		.vh-name { color: var(--vh-blue); font-size: 16px; font-weight: 800; }
		.vh-badge { display: inline-flex; border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 800; white-space: nowrap; }
		.vh-badge--active { background: #dbeafe; color: #1d4ed8; }
		.vh-badge--maintenance { background: #fef3c7; color: #b45309; }
		.vh-badge--inactive { background: #e2e8f0; color: #475569; }
		.vh-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: #f0f9ff;
			color: #075985;
			font-size: 14px;
		}
		.vh-pagination > div { display: flex; align-items: center; gap: 10px; }
		.vh-page-btn[disabled] { opacity: .45; cursor: not-allowed; }
		.vh-empty {
			display: grid;
			place-items: center;
			gap: 10px;
			min-height: 240px;
			padding: 40px 18px;
			text-align: center;
			color: #475569;
		}
		.vh-empty strong { color: #0c4a6e; font-size: 20px; }
		.vh-loading {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			background: rgba(240,249,255,.56);
			border-radius: 24px;
			backdrop-filter: blur(2px);
		}
		.vh-spinner {
			width: 46px;
			height: 46px;
			border: 4px solid rgba(2,132,199,.15);
			border-top-color: var(--vh-blue);
			border-radius: 50%;
			animation: vh-spin .8s linear infinite;
		}
		@keyframes vh-spin { to { transform: rotate(360deg); } }
		[data-theme="dark"] .vh-toolbar,
		[data-theme="dark"] .vh-pagination,
		[data-theme="dark"] .vh-table th,
		[data-theme="dark"] .vh-stat--all,
		[data-theme="dark"] .vh-stat--maintenance {
			background: rgba(14, 116, 144, .18);
		}
		[data-theme="dark"] .vh-row:hover { background: rgba(14,116,144,.16); }
		@media (max-width: 1100px) {
			.vh-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.vh-toolbar-row { grid-template-columns: 1fr; }
			.vh-status-filters { margin-bottom: 10px; }
			.vh-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		}
		@media (max-width: 720px) {
			.vh-page { padding: 20px 12px 36px; }
			.vh-stats,
			.vh-filter-grid { grid-template-columns: 1fr; }
			.vh-actions,
			.vh-pagination { flex-direction: column; align-items: stretch; }
			.vh-pagination > div { justify-content: space-between; }
		}
	`;
	document.head.appendChild(style);
}
