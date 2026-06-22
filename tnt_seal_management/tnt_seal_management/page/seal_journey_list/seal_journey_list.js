frappe.pages["seal-journey-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Seal Journey List"),
		single_column: true,
	});

	page.sjl_state = {
		search: "",
		status: "All",
		page: 1,
		page_length: 30,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Back"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _sjl_load(page));
	page.set_primary_action(__("New Journey"), () => frappe.new_doc("Seal Journey"));

	const $statsBar = $('<div class="sjl-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.sjl_stats_bar = $statsBar;

	_sjl_inject_styles();
	_sjl_build_page(page);
	_sjl_load(page);
};

function _sjl_build_page(page) {
	$(page.body).html(`
		<div class="sjl-page">
			<section class="sjl-panel">
				<div class="sjl-toolbar">
					<div class="sjl-toolbar-top">
						<label class="sjl-field sjl-search-inline">
							<input class="sjl-search" type="search" placeholder="${__("Journey ID, Customer, Vehicle, etc.")}">
						</label>

						<div class="sjl-filter-dropdown">
							<button class="sjl-filter-btn">
								<span class="sjl-filter-btn-label">${__("All Journeys")}</span>
								<span class="sjl-filter-btn-count">0</span>
								<span class="sjl-filter-arrow">&#9662;</span>
							</button>
							<div class="sjl-filter-menu">
								<div class="sjl-filter-item active" data-status="All" data-label="${__("All Journeys")}">${__("All Journeys")} <span class="sjl-fcount" data-fcount="All">0</span></div>
								<div class="sjl-filter-item" data-status="Active" data-label="${__("Active")}">${__("Active")} <span class="sjl-fcount" data-fcount="Active">0</span></div>
								<div class="sjl-filter-item" data-status="Completed" data-label="${__("Completed")}">${__("Completed")} <span class="sjl-fcount" data-fcount="Completed">0</span></div>
								<div class="sjl-filter-item" data-status="Cancelled" data-label="${__("Cancelled")}">${__("Cancelled")} <span class="sjl-fcount" data-fcount="Cancelled">0</span></div>
							</div>
						</div>

						<div class="sjl-actions">
							<button class="sjl-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="sjl-table-panel">
				<div class="sjl-table-scroll"><div class="sjl-table-wrap"></div></div>
				<div class="sjl-pagination"></div>
			</section>

			<div class="sjl-loading" style="display:none"><div class="sjl-spinner"></div></div>
		</div>
	`);

	const delayedSearch = frappe.utils.debounce(() => {
		page.sjl_state.search = ($(page.body).find(".sjl-search").val() || "").trim();
		page.sjl_state.page = 1;
		_sjl_load(page);
	}, 300);

	$(page.body).on("input", ".sjl-search", delayedSearch);

	$(page.body).on("click", ".sjl-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".sjl-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".sjl-filter-item", function () {
		page.sjl_state.status = $(this).data("status");
		page.sjl_state.page = 1;
		$(page.body).find(".sjl-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".sjl-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".sjl-filter-menu").removeClass("open");
		_sjl_load(page);
	});

	$(document).on("click.sjl-dropdown", function () {
		$(page.body).find(".sjl-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".sjl-clear-btn", () => _sjl_clear(page));

	$(page.body).on("click", ".sjl-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Journey", name);
	});

	$(page.body).on("click", ".sjl-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.sjl_state.page = Number.parseInt($(this).data("page"), 10);
		_sjl_load(page);
	});
}

function _sjl_load(page) {
	const requestId = ++page.sjl_state.request_id;
	_sjl_set_loading(page, true);

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_journey_list.get_seal_journey_list_data",
		args: {
			search: page.sjl_state.search,
			status: page.sjl_state.status,
			page: page.sjl_state.page,
			page_length: page.sjl_state.page_length,
		},
		callback(r) {
			if (requestId !== page.sjl_state.request_id) return;
			_sjl_set_loading(page, false);
			const data = r.message || {};
			page.sjl_state.total = data.total || 0;
			
			_sjl_render_stats(page, data.summary || {});
			_sjl_render_table(page, data.journeys || []);
			_sjl_render_pagination(page);
		},
		error() {
			if (requestId !== page.sjl_state.request_id) return;
			_sjl_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load journeys"), indicator: "red" }, 5);
		},
	});
}

function _sjl_render_stats(page, summary) {
	const html = `
		<div class="sjl-stat-card">
			<div class="sjl-stat-label">${__("All")}</div>
			<div class="sjl-stat-value">${summary.All || 0}</div>
		</div>
		<div class="sjl-stat-card sjl-stat--active">
			<div class="sjl-stat-label">${__("Active")}</div>
			<div class="sjl-stat-value">${summary.Active || 0}</div>
		</div>
		<div class="sjl-stat-card sjl-stat--completed">
			<div class="sjl-stat-label">${__("Completed")}</div>
			<div class="sjl-stat-value">${summary.Completed || 0}</div>
		</div>
		<div class="sjl-stat-card sjl-stat--cancelled">
			<div class="sjl-stat-label">${__("Cancelled")}</div>
			<div class="sjl-stat-value">${summary.Cancelled || 0}</div>
		</div>
	`;
	if (page.sjl_stats_bar) {
		page.sjl_stats_bar.html(html);
	}

	const countMap = {
		All: summary.All || 0,
		Active: summary.Active || 0,
		Completed: summary.Completed || 0,
		Cancelled: summary.Cancelled || 0,
	};
	$(page.body).find(".sjl-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	const currentCount = countMap[page.sjl_state.status] ?? 0;
	$(page.body).find(".sjl-filter-btn-count").text(currentCount);
}

function _sjl_render_table(page, journeys) {
	if (!journeys.length) {
		$(page.body).find(".sjl-table-wrap").html(`
			<div class="sjl-empty">
				<strong>${__("No journeys found")}</strong>
				<span>${__("Try clearing the filters or search terms.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".sjl-table-wrap").html(`
		<table class="sjl-table">
			<thead>
				<tr>
					<th width="15%">${__("Journey ID")}</th>
					<th width="20%">${__("Customer")}</th>
					<th width="12%">${__("Vehicle")}</th>
					<th width="15%">${__("Route")}</th>
					<th width="15%">${__("Duration")}</th>
					<th width="10%">${__("Status")}</th>
				</tr>
			</thead>
			<tbody>
				${journeys.map(j => _sjl_row(j)).join("")}
			</tbody>
		</table>
	`);
}

function _sjl_row(j) {
	const start = j.journey_start_date_time ? frappe.datetime.str_to_user(j.journey_start_date_time) : "-";
	const end = j.completion_date_time ? frappe.datetime.str_to_user(j.completion_date_time) : "-";
	const routeStr = [j.origin, j.destination].filter(Boolean).join(" → ") || "-";

	const rawCustomer = j.customer || "-";
	const customerWords = rawCustomer.split(" ");
	let truncatedCustomer = rawCustomer;
	if (customerWords.length > 3) {
		truncatedCustomer = customerWords.slice(0, 3).join(" ") + "...";
	}

	return `
		<tr class="sjl-row" data-name="${frappe.utils.escape_html(j.name)}">
			<td>
				<div class="sjl-cell-primary">${frappe.utils.escape_html(j.name)}</div>
			</td>
			<td title="${frappe.utils.escape_html(rawCustomer)}">
				<div class="sjl-cell-primary">${frappe.utils.escape_html(truncatedCustomer)}</div>
			</td>
			<td>
				<div class="sjl-cell-primary">${frappe.utils.escape_html(j.vehicle_plate_number || "-")}</div>
				<div class="sjl-cell-secondary">${frappe.utils.escape_html(j.container_number || "")}</div>
			</td>
			<td>
				<div class="sjl-cell-primary">${frappe.utils.escape_html(routeStr)}</div>
			</td>
			<td>
				<div class="sjl-cell-primary">${j.days_taken ? parseFloat(j.days_taken).toFixed(1) + " days" : "-"}</div>
				<div class="sjl-cell-secondary">${start}</div>
			</td>
			<td>
				<span class="sjl-badge sjl-badge--${_sjl_status_class(j.journey_status)}">
					${frappe.utils.escape_html(j.journey_status || "Unknown")}
				</span>
			</td>
		</tr>
	`;
}

function _sjl_status_class(status) {
	const map = {
		"Completed": "completed",
		"In Transit": "active",
		"Ready for Journey": "active",
		"Cancelled": "cancelled",
		"Draft": "draft",
	};
	return map[status] || "default";
}

function _sjl_render_pagination(page) {
	const { page: currentPage, page_length: pageLength, total } = page.sjl_state;
	const totalPages = Math.ceil(total / pageLength) || 1;
	const start = (currentPage - 1) * pageLength + 1;
	const end = Math.min(currentPage * pageLength, total);

	$(page.body).find(".sjl-pagination").html(`
		<div>
			<span>${__("Showing {0} to {1} of {2}", [total ? start : 0, end, total])}</span>
		</div>
		<div>
			<button class="sjl-page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>
				${__("Previous")}
			</button>
			<button class="sjl-page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}>
				${__("Next")}
			</button>
		</div>
	`);
}

function _sjl_clear(page) {
	page.sjl_state.search = "";
	page.sjl_state.status = "All";
	page.sjl_state.page = 1;
	$(page.body).find(".sjl-search").val("");
	$(page.body).find(".sjl-filter-item").removeClass("active");
	$(page.body).find('.sjl-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".sjl-filter-btn-label").text(__("All Journeys"));
	_sjl_load(page);
}

function _sjl_set_loading(page, on) {
	$(page.body).find(".sjl-loading").toggle(on);
}

function _sjl_inject_styles() {
	if (document.getElementById("sjl-styles")) return;
	const style = document.createElement("style");
	style.id = "sjl-styles";
	style.textContent = `
		.sjl-page {
			--sjl-blue: #0284c7;
			max-width: 1480px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			font-family: var(--font-stack);
			position: relative;
		}

		/* ---- header stats bar ---- */
		.sjl-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.sjl-header-stats .sjl-stat-card {
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
		.sjl-header-stats .sjl-stat--active { border-top-color: var(--sjl-blue); }
		.sjl-header-stats .sjl-stat--completed { border-top-color: #16a34a; }
		.sjl-header-stats .sjl-stat--cancelled { border-top-color: #dc2626; }
		.sjl-header-stats .sjl-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.sjl-header-stats .sjl-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.sjl-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.sjl-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.sjl-table-scroll {
			overflow-x: auto;
			overflow-y: auto;
			max-height: calc(100vh - 200px);
		}

		/* ---- toolbar ---- */
		.sjl-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: #f0f9ff;
		}
		.sjl-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.sjl-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.sjl-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.sjl-search-inline input:focus {
			outline: none;
			border-color: var(--sjl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.sjl-filter-dropdown {
			position: relative;
		}
		.sjl-filter-btn {
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
		.sjl-filter-btn:hover { border-color: var(--sjl-blue); }
		.sjl-filter-btn-count {
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
		.sjl-filter-arrow {
			color: #94a3b8;
			font-size: 11px;
		}
		.sjl-filter-menu {
			display: none;
			position: fixed;
			min-width: 200px;
			border: 1px solid #bae6fd;
			border-radius: 12px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .12);
			z-index: 1000;
			overflow: hidden;
		}
		.sjl-filter-menu.open { display: block; }
		.sjl-filter-item {
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
		.sjl-filter-item:hover { background: #f0f9ff; }
		.sjl-filter-item.active {
			background: #e0f2fe;
			color: var(--sjl-blue);
		}
		.sjl-fcount {
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
		.sjl-filter-item.active .sjl-fcount {
			background: var(--sjl-blue);
			color: #fff;
		}

		.sjl-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.sjl-actions {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.sjl-clear-btn {
			padding: 9px 16px;
			border: 1px solid #cbd5e1;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #475569;
			font-size: 14px;
			font-weight: 700;
			cursor: pointer;
			transition: background .12s, border-color .12s;
		}
		.sjl-clear-btn:hover {
			background: #f8fafc;
			border-color: #94a3b8;
		}
		
		/* ---- table ---- */
		.sjl-table {
			width: 100%;
			border-collapse: collapse;
			text-align: left;
			background: var(--card-bg, #fff);
		}
		.sjl-table th,
		.sjl-table td {
			padding: 14px 18px;
			border-bottom: 1px solid #e2e8f0;
			vertical-align: top;
		}
		.sjl-table th {
			position: sticky;
			top: 0;
			z-index: 10;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .08em;
		}
		.sjl-row {
			cursor: pointer;
		}
		.sjl-row:hover {
			background: rgba(224, 242, 254, .7);
		}
		.sjl-cell-primary {
			color: #0f172a;
			font-size: 14px;
			font-weight: 700;
			margin-bottom: 4px;
		}
		.sjl-cell-secondary {
			color: #64748b;
			font-size: 12px;
		}
		.sjl-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 4px 10px;
			font-size: 11px;
			font-weight: 800;
			white-space: nowrap;
		}
		.sjl-badge--active { background: #dbeafe; color: #1d4ed8; }
		.sjl-badge--completed { background: #dcfce7; color: #16a34a; }
		.sjl-badge--cancelled { background: #fee2e2; color: #dc2626; }
		.sjl-badge--draft { background: #f1f5f9; color: #475569; }
		.sjl-badge--default { background: #e2e8f0; color: #475569; }

		.sjl-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 14px 18px;
			background: #f0f9ff;
			color: #075985;
			font-size: 14px;
		}
		.sjl-pagination > div {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.sjl-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.sjl-page-btn[disabled] {
			opacity: .45;
			cursor: not-allowed;
		}
		
		.sjl-empty {
			display: grid;
			place-items: center;
			gap: 10px;
			min-height: 240px;
			padding: 40px 18px;
			color: #64748b;
			text-align: center;
		}
		.sjl-empty strong {
			color: #0c4a6e;
			font-size: 20px;
		}
		
		.sjl-loading {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			background: rgba(240, 249, 255, .56);
			border-radius: 24px;
			backdrop-filter: blur(2px);
			z-index: 50;
		}
		.sjl-spinner {
			width: 46px;
			height: 46px;
			border: 4px solid rgba(2, 132, 199, .15);
			border-top-color: var(--sjl-blue);
			border-radius: 50%;
			animation: sjl-spin .8s linear infinite;
		}
		@keyframes sjl-spin {
			to { transform: rotate(360deg); }
		}

		/* Dark mode */
		[data-theme="dark"] .sjl-toolbar,
		[data-theme="dark"] .sjl-pagination,
		[data-theme="dark"] .sjl-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .sjl-table th {
			background: #1e293b;
			background-image: linear-gradient(rgba(14, 116, 144, .18), rgba(14, 116, 144, .18));
		}
		[data-theme="dark"] .sjl-row:hover {
			background: rgba(14, 116, 144, .16);
		}
		[data-theme="dark"] .sjl-search-inline input,
		[data-theme="dark"] .sjl-filter-btn,
		[data-theme="dark"] .sjl-filter-menu,
		[data-theme="dark"] .sjl-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}

		@media (max-width: 1100px) {
			.sjl-toolbar-top {
				flex-direction: column;
				align-items: stretch;
			}
		}
		@media (max-width: 720px) {
			.sjl-page {
				padding: 20px 12px 36px;
			}
			.sjl-actions,
			.sjl-pagination {
				flex-direction: column;
				align-items: stretch;
			}
			.sjl-pagination > div {
				justify-content: space-between;
			}
		}
	`;
	document.head.appendChild(style);
}