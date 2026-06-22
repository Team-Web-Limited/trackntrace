frappe.pages["journey-monitoring"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Journey Monitoring"),
		single_column: true,
	});

	$(wrapper).data("page_obj", page);
	page.jm_state = {
		view: "all",
		search: "",
		from_date: "",
		to_date: "",
		page: 1,
		page_size: 30,
		total: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _load_data(page));

	// Inject compact stats bar into the Frappe page header
	const $statsBar = $('<div class="jm-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.jm_stats_bar = $statsBar;

	_inject_styles();
	_build_skeleton(page);
	_load_data(page);

	// Auto-refresh every 60 s when page is visible
	let _timer = null;
	$(wrapper).on("page-show", () => {
		_load_data(page);
		_timer = setInterval(() => _load_data(page), 60000);
	});
	$(wrapper).on("page-hide", () => clearInterval(_timer));
};


// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function _load_data(page) {
	const s = page.jm_state;
	_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.journey_monitoring.get_journey_monitoring_data",
		args: {
			view: s.view,
			search: s.search,
			from_date: s.from_date || null,
			to_date: s.to_date || null,
			page: s.page,
			page_length: s.page_size,
		},
		callback(r) {
			_set_loading(page, false);
			const data = r.message || {};
			s.total = data.total || 0;
			_render_summary(page, data.summary || {});
			_render_tab_badges(page, data.summary || {});
			_render_journeys(page, data.journeys || []);
			_render_pagination(page, data.total || 0);
			_update_refresh_time(page);
		},
		error() {
			_set_loading(page, false);
			frappe.show_alert({ message: __("Failed to load monitoring data"), indicator: "red" }, 5);
		},
	});
}


// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _build_skeleton(page) {
	$(page.body).html(`
		<div class="jm-dashboard">
			<section class="jm-panel">
				<div class="jm-toolbar">
					<div class="jm-toolbar-top">
						<label class="jm-field jm-search-inline">
							<input type="search" class="jm-search-input"
								placeholder="${__("Journey, client, vehicle, container, seal or location")}" />
						</label>

						<div class="jm-filter-dropdown">
							<button class="jm-filter-btn">
								<span class="jm-filter-btn-label">${__("All Journeys")}</span>
								<span class="jm-filter-btn-count">0</span>
								<span class="jm-filter-arrow">&#9662;</span>
							</button>
							<div class="jm-filter-menu">
								<div class="jm-filter-item active" data-view="all" data-label="${__("All Journeys")}">${__("All Journeys")} <span class="jm-fcount" data-fcount="all">0</span></div>
								<div class="jm-filter-item" data-view="active" data-label="${__("Active")}">${__("Active")} <span class="jm-fcount" data-fcount="active">0</span></div>
								<div class="jm-filter-item" data-view="in_transit" data-label="${__("In Transit")}">${__("In Transit")} <span class="jm-fcount" data-fcount="in_transit">0</span></div>
								<div class="jm-filter-item" data-view="completed" data-label="${__("Completed")}">${__("Completed")} <span class="jm-fcount" data-fcount="completed">0</span></div>
								<div class="jm-filter-item" data-view="alerts" data-label="${__("With Alerts")}">${__("With Alerts")} <span class="jm-fcount" data-fcount="alerts">0</span></div>
							</div>
						</div>

						<label class="jm-field">
							<span>${__("From")}</span>
							<input type="date" class="jm-from-date" />
						</label>
						<label class="jm-field">
							<span>${__("To")}</span>
							<input type="date" class="jm-to-date" />
						</label>
						<div class="jm-actions">
							<button class="jm-btn jm-btn-clear">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="jm-table-panel">
				<div class="jm-table-scroll">
					<div class="jm-table-wrap"></div>
				</div>
				<div class="jm-pagination"></div>
			</section>

			<div class="jm-loading" style="display:none">
				<div class="jm-spinner"></div>
			</div>
		</div>
	`);

	// Filter dropdown
	$(page.body).on("click", ".jm-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".jm-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});
	$(page.body).on("click", ".jm-filter-item", function () {
		const view = $(this).data("view");
		const label = $(this).data("label");
		page.jm_state.view = view;
		page.jm_state.page = 1;
		$(page.body).find(".jm-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".jm-filter-btn-label").text(label);
		$(page.body).find(".jm-filter-menu").removeClass("open");
		_load_data(page);
	});
	$(document).on("click.jm-dropdown", function () {
		$(page.body).find(".jm-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".jm-btn-clear", () => _clear_filters(page));

	$(page.body).on("change", ".jm-from-date", function () {
		page.jm_state.from_date = $(this).val() || "";
		page.jm_state.page = 1;
		_load_data(page);
	});
	$(page.body).on("change", ".jm-to-date", function () {
		page.jm_state.to_date = $(this).val() || "";
		page.jm_state.page = 1;
		_load_data(page);
	});

	// Debounced search
	let _searchTimer = null;
	$(page.body).on("input", ".jm-search-input", function () {
		const val = ($(this).val() || "").trim();
		clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => {
			page.jm_state.search = val;
			page.jm_state.page = 1;
			_load_data(page);
		}, 350);
	});

	$(page.body).on("click", ".jm-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Journey", name);
	});

	$(page.body).on("click", ".jm-page-btn", function () {
		if ($(this).prop("disabled")) return;
		const nextPage = Number.parseInt($(this).data("page"), 10);
		if (!nextPage || nextPage === page.jm_state.page) return;
		page.jm_state.page = nextPage;
		_load_data(page);
	});
}

function _clear_filters(page) {
	Object.assign(page.jm_state, {
		view: "all",
		search: "",
		from_date: "",
		to_date: "",
		page: 1,
	});
	$(page.body).find(".jm-search-input, .jm-from-date, .jm-to-date").val("");
	$(page.body).find(".jm-filter-item").removeClass("active");
	$(page.body).find('.jm-filter-item[data-view="all"]').addClass("active");
	$(page.body).find(".jm-filter-btn-label").text(__("All Journeys"));
	_load_data(page);
}

function _render_summary(page, s) {
	const html = `
		<div class="jm-stat-card">
			<div class="jm-stat-label">${__("Total Journeys")}</div>
			<div class="jm-stat-value">${s.all || 0}</div>
		</div>
		<div class="jm-stat-card jm-stat--blue">
			<div class="jm-stat-label">${__("Active")}</div>
			<div class="jm-stat-value">${s.active || 0}</div>
		</div>
		<div class="jm-stat-card jm-stat--teal">
			<div class="jm-stat-label">${__("In Transit")}</div>
			<div class="jm-stat-value">${s.in_transit || 0}</div>
		</div>
		<div class="jm-stat-card jm-stat--green">
			<div class="jm-stat-label">${__("Completed")}</div>
			<div class="jm-stat-value">${s.completed || 0}</div>
		</div>
		<div class="jm-stat-card jm-stat--red">
			<div class="jm-stat-label">${__("With Alerts")}</div>
			<div class="jm-stat-value">${s.alerts || 0}</div>
		</div>
	`;
	if (page.jm_stats_bar) {
		page.jm_stats_bar.html(html);
	} else {
		$(page.body).find(".jm-summary-row").html(html);
	}

	// Update dropdown counts
	const countMap = {
		all: s.all || 0,
		active: s.active || 0,
		in_transit: s.in_transit || 0,
		completed: s.completed || 0,
		alerts: s.alerts || 0,
	};
	$(page.body).find(".jm-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	// Sync button count to current view
	const currentCount = countMap[page.jm_state.view] ?? 0;
	$(page.body).find(".jm-filter-btn-count").text(currentCount);
}

function _render_tab_badges(page, s) {
	$(page.body).find('.jm-tab-count[data-count="all"]').text(s.all || 0);
	$(page.body).find('.jm-tab-count[data-count="active"]').text(s.active || 0);
	$(page.body).find('.jm-tab-count[data-count="completed"]').text(s.completed || 0);
}

function _render_journeys(page, journeys) {
	if (!journeys.length) {
		$(page.body).find(".jm-table-wrap").html(
			`<p class="jm-empty">${__("No journeys found for the current filters.")}</p>`
		);
		return;
	}

	const rows = journeys.map(j => _journey_rows_html(j)).join("");
	$(page.body).find(".jm-table-wrap").html(`
		<table class="jm-table">
			<thead>
				<tr>
					<th>${__("Journey")}</th>
					<th>${__("Client")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Container")}</th>
					<th>${__("Origin")}</th>
					<th>${__("Destination")}</th>
					<th>${__("Status")}</th>
					<th>${__("Longer in Journey")}</th>
					<th>${__("Seal")}</th>
					<th>${__("Lock")}</th>
					<th>${__("Battery")}</th>
					<th>${__("Location")}</th>
					<th>${__("Alerts")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`);
}

function _journey_rows_html(j) {
	const seals = (j.seals && j.seals.length) ? j.seals : [null];
	return seals.map((seal, idx) => _row_html(j, seal, idx, seals.length)).join("");
}

function _row_html(j, seal, idx, sealCount) {
	const esc = frappe.utils.escape_html;
	const dash = `<span class="jm-cell-muted">—</span>`;
	const isFirst = idx === 0;

	const client = j.customer
		? `<span class="jm-truncate-chip" title="${esc(j.customer)}">${esc(_truncate_words(j.customer, 2))}</span>`
		: dash;
	const vehicle = j.vehicle_plate_number ? esc(j.vehicle_plate_number) : dash;
	const container = j.container_number ? esc(j.container_number) : dash;
	const origin = j.origin ? esc(j.origin) : dash;
	const destination = j.destination ? esc(j.destination) : dash;

	const status = j.journey_status || __("Unknown");
	const statusClass = _status_class(status);

	const longer = j.longer_in_journey && j.longer_in_journey > 0
		? `<span class="jm-badge jm-badge--warning">${Math.ceil(j.longer_in_journey)} ${__("Days")}</span>`
		: dash;

	// Journey-level cells render only on the first seal row and span the group.
	const span = sealCount > 1 ? ` rowspan="${sealCount}"` : "";
	const journeyCells = isFirst
		? `
			<td${span}><div class="jm-cell-strong">${esc(j.name)}</div></td>
			<td${span}>${client}</td>
			<td${span}>${vehicle}</td>
			<td${span}>${container}</td>
			<td${span} class="jm-cell-place">${origin}</td>
			<td${span} class="jm-cell-place">${destination}</td>
			<td${span}><span class="jm-badge jm-badge--${statusClass}">${esc(status)}</span></td>
			<td${span}>${longer}</td>
		`
		: "";

	const sealName = seal && seal.seal_number ? esc(String(seal.seal_number)) : dash;
	const lock = seal && seal.lock_status ? seal.lock_status : "";
	const lockHtml = lock
		? `<span class="jm-badge jm-badge--${lock === "Locked" ? "active" : "offline"}">${esc(lock)}</span>`
		: dash;
	const battery = seal && (seal.battery_level || seal.battery_level === 0)
		? esc(String(seal.battery_level)) : dash;
	const locationRaw = seal && seal.api_location ? String(seal.api_location) : null;
	const location = locationRaw
		? `<span class="jm-location-truncated" title="${esc(locationRaw)}">${esc(_truncate_words(locationRaw, 3))}</span>`
		: dash;
	const alertsHtml = _alerts_html((seal && seal.alerts) || []);

	return `
		<tr class="jm-row" data-name="${esc(j.name)}">
			${journeyCells}
			<td>${sealName}</td>
			<td>${lockHtml}</td>
			<td>${battery}</td>
			<td class="jm-cell-location">${location}</td>
			<td class="jm-cell-alerts">${alertsHtml}</td>
		</tr>
	`;
}

function _truncate_words(value, wordLimit) {
	if (!value) return "";
	const words = String(value).trim().split(/\s+/);
	if (words.length <= wordLimit) return String(value).trim();
	return `${words.slice(0, wordLimit).join(" ")}...`;
}

function _alerts_html(alerts) {
	if (!alerts.length) return `<span class="jm-cell-muted">—</span>`;
	return alerts.map(a =>
		`<span class="jm-badge jm-badge--${a.level}" title="${frappe.utils.escape_html(a.message)}">${frappe.utils.escape_html(a.message)}</span>`
	).join(" ");
}

function _render_pagination(page, totalRecords) {
	const pageSize = page.jm_state.page_size;
	const currentPage = page.jm_state.page;
	const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
	const rangeStart = totalRecords ? (currentPage - 1) * pageSize + 1 : 0;
	const rangeEnd = Math.min(currentPage * pageSize, totalRecords);

	$(page.body).find(".jm-pagination").html(`
		<div class="jm-pagination-status">
			${__("Showing {0}-{1} of {2}", [rangeStart, rangeEnd, totalRecords])}
		</div>
		<div class="jm-pagination-controls">
			<button class="jm-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>
				${__("Previous")}
			</button>
			<span class="jm-page-indicator">${__("Page {0} of {1}", [currentPage, totalPages])}</span>
			<button class="jm-page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}>
				${__("Next")}
			</button>
		</div>
	`);
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Journey-status badge colours. In Transit is the live/active highlight;
// completed is green; cancelled/rejected red; everything else neutral.
const _STATUS_CLASS = {
	"In Transit": "blue",
	"Ready for Journey": "blue",
	"Arrived": "idle",
	"Completed": "active",
	"Cancelled": "offline",
	"Finance PCB Rejected": "offline",
};

function _status_class(status) {
	return _STATUS_CLASS[status] || "unknown";
}

function _set_loading(page, on) {
	$(page.body).find(".jm-loading").toggle(on);
}

function _update_refresh_time(page) {
	const t = frappe.datetime.now_time();
	$(page.body).find(".jm-refresh-label").text(__("Updated {0}", [t]));
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function _inject_styles() {
	if (document.getElementById("jm-monitoring-styles")) return;
	const style = document.createElement("style");
	style.id = "jm-monitoring-styles";
	style.textContent = `
		.jm-dashboard {
			--jm-blue: #0284c7;
			--jm-dark: #075985;
			max-width: 1480px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			font-family: var(--font-stack);
			position: relative;
		}
		/* ---- header stats bar (injected into Frappe page-head) ---- */
		.jm-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.jm-header-stats .jm-stat-card {
			min-height: unset;
			padding: 6px 14px;
			flex-direction: row;
			align-items: center;
			gap: 8px;
			border-radius: 999px;
			border-top-width: 1px;
			border-top-style: solid;
			box-shadow: none;
			white-space: nowrap;
		}
		.jm-header-stats .jm-stat-label {
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.jm-header-stats .jm-stat-value {
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		.jm-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.jm-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.jm-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: #f0f9ff;
		}
		.jm-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.jm-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.jm-search-inline input {
			width: 320px;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.jm-search-inline input:focus {
			outline: none;
			border-color: var(--jm-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		/* ---- filter dropdown ---- */
		.jm-filter-dropdown {
			position: relative;
		}
		.jm-filter-btn {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			height: 38px;
			padding: 0 14px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--jm-dark);
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
			transition: border-color .15s;
		}
		.jm-filter-btn:hover { border-color: var(--jm-blue); }
		.jm-filter-btn-count {
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
		.jm-filter-arrow {
			color: #94a3b8;
			font-size: 11px;
		}
		.jm-filter-menu {
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
		.jm-filter-menu.open { display: block; }
		.jm-filter-item {
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
		.jm-filter-item:hover { background: #f0f9ff; }
		.jm-filter-item.active {
			background: #e0f2fe;
			color: var(--jm-blue);
		}
		.jm-fcount {
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
		.jm-filter-item.active .jm-fcount {
			background: var(--jm-blue);
			color: #fff;
		}

		.jm-tabs {
			display: flex;
			gap: 8px;
			overflow-x: auto;
		}
		.jm-tab {
			padding: 9px 15px;
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: var(--jm-dark);
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.jm-tab.active {
			border-color: var(--jm-blue);
			background: var(--jm-blue);
			color: #fff;
		}
		.jm-tab-count {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 18px;
			margin-left: 4px;
			padding: 1px 5px;
			border-radius: 999px;
			background: #e0f2fe;
			font-size: 11px;
			font-weight: 700;
		}
		.jm-tab.active .jm-tab-count {
			background: rgba(255, 255, 255, .24);
			color: #fff;
		}
		.jm-summary-row {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 12px;
		}
		.jm-stat-card {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: 12px;
			min-height: 78px;
			padding: 16px 18px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-top: 4px solid #075985;
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.jm-stat--blue { border-top-color: #0284c7; }
		.jm-stat--teal { border-top-color: #0d9488; }
		.jm-stat--green { border-top-color: #16a34a; }
		.jm-stat--red { border-top-color: #dc2626; }
		.jm-stat-label {
			max-width: 110px;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .05em;
			line-height: 1.3;
			text-transform: uppercase;
		}
		.jm-stat-value {
			color: #0c4a6e;
			font-size: 32px;
			font-weight: 800;
			line-height: 1;
			white-space: nowrap;
		}

		.jm-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.jm-field > span {
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.jm-field input {
			width: 100%;
			height: 42px;
			padding: 9px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.jm-field input:focus {
			outline: none;
			border-color: var(--jm-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		.jm-actions {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 8px;
			padding-bottom: 1px;
		}
		.jm-refresh-label {
			color: #64748b;
			font-size: 12px;
			white-space: nowrap;
		}
		.jm-btn,
		.jm-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: var(--jm-dark);
			padding: 9px 15px;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.jm-btn-refresh {
			border-color: var(--jm-blue);
			background: var(--jm-blue);
			color: #fff;
		}
		.jm-table-scroll {
			max-height: calc(100vh - 60px - 56px);
			overflow: auto;
		}
		.jm-table {
			width: 100%;
			min-width: 1560px;
			border-collapse: collapse;
		}
		.jm-table th,
		.jm-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
			white-space: nowrap;
		}
		.jm-table th {
			position: sticky;
			top: 0;
			z-index: 2;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
			white-space: nowrap;
		}
		.jm-row {
			cursor: pointer;
			transition: background .15s ease;
		}
		.jm-row:hover { background: rgba(224, 242, 254, .7); }
		.jm-cell-strong {
			color: var(--jm-blue);
			font-size: 15px;
			font-weight: 800;
		}
		.jm-row-subtle,
		.jm-cell-muted {
			margin-top: 3px;
			color: #64748b;
			font-size: 11px;
		}
		.jm-cell-muted { margin-top: 0; }
		.jm-cell-place {
			min-width: 180px;
			white-space: normal;
			word-break: break-word;
		}
		.jm-cell-location {
			white-space: nowrap;
		}
		.jm-location-truncated {
			cursor: help;
			border-bottom: 1px dashed #94a3b8;
			white-space: nowrap;
		}
		}
		.jm-cell-alerts {
			min-width: 170px;
			max-width: 280px;
			white-space: normal;
		}
		.jm-truncate-chip {
			display: inline-block;
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			vertical-align: bottom;
			white-space: nowrap;
		}
		.jm-badge {
			display: inline-flex;
			align-items: center;
			margin: 0 4px 4px 0;
			padding: 6px 10px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .02em;
			line-height: 1;
			white-space: nowrap;
		}
		.jm-badge--active { background: #dcfce7; color: #166534; }
		.jm-badge--idle { background: #fef3c7; color: #92400e; }
		.jm-badge--offline,
		.jm-badge--critical { background: #fee2e2; color: #b91c1c; }
		.jm-badge--unknown { background: #f1f5f9; color: #475569; }
		.jm-badge--blue { background: #e0f2fe; color: #075985; }
		.jm-badge--warning { background: #ffedd5; color: #c2410c; }
		.jm-badge--info { background: #dbeafe; color: #1d4ed8; }
		.jm-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.jm-pagination-controls {
			display: flex;
			align-items: center;
			gap: 9px;
		}
		.jm-page-indicator { font-weight: 700; }
		.jm-page-btn:disabled {
			cursor: default;
			opacity: .45;
		}
		.jm-empty {
			padding: 60px 20px;
			margin: 0;
			text-align: center;
			color: #64748b;
			font-size: 15px;
		}
		.jm-loading {
			position: absolute;
			inset: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(240, 249, 255, .72);
			backdrop-filter: blur(2px);
		}
		.jm-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--jm-blue);
			border-radius: 50%;
			animation: jm-spin .7s linear infinite;
		}
		@keyframes jm-spin { to { transform: rotate(360deg); } }
		[data-theme="dark"] .jm-panel,
		[data-theme="dark"] .jm-table-panel,
		[data-theme="dark"] .jm-stat-card,
		[data-theme="dark"] .jm-tab,
		[data-theme="dark"] .jm-btn,
		[data-theme="dark"] .jm-page-btn,
		[data-theme="dark"] .jm-field input {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .jm-stat-label,
		[data-theme="dark"] .jm-field > span { color: #7dd3fc; }
		[data-theme="dark"] .jm-stat-value { color: #f8fafc; }
		[data-theme="dark"] .jm-toolbar,
		[data-theme="dark"] .jm-table th,
		[data-theme="dark"] .jm-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .jm-table td {
			border-bottom-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .jm-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .jm-loading { background: rgba(15, 23, 42, .62); }
		@media (max-width: 1180px) {
			.jm-toolbar-top { grid-template-columns: 1fr; }
			.jm-summary-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
			.jm-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.jm-actions { grid-column: 1 / -1; justify-content: flex-start; }
		}
		@media (max-width: 720px) {
			.jm-dashboard { padding: 10px 8px 32px; }
			.jm-summary-row { grid-template-columns: 1fr; }
			.jm-filter-grid { grid-template-columns: 1fr; }
			.jm-actions {
				grid-column: auto;
				align-items: flex-start;
				flex-wrap: wrap;
				justify-content: flex-start;
			}
			.jm-refresh-label { width: 100%; }
			.jm-pagination { flex-direction: column; align-items: flex-start; }
		}
	`;
	document.head.appendChild(style);
}
