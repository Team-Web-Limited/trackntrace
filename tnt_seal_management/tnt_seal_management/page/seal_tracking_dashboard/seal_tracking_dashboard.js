frappe.pages["seal-tracking-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Seal Tracking Dashboard",
		single_column: true,
	});

	$(wrapper).data("page_obj", page);
	page.std_state = {
		devices: [],
		filter: "all",
		search: "",
		page: 1,
		page_size: 30,
	};

	page.add_inner_button("Dashboard", () => frappe.set_route("tnt-seal-management"));
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
	_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.get_device_dashboard_data",
		callback(r) {
			_set_loading(page, false);
			if (r.message) {
				_render_summary(page, r.message.summary);
				_render_devices(page, r.message.devices);
				_update_refresh_time(page);
			}
		},
		error() {
			_set_loading(page, false);
			frappe.show_alert({ message: __("Failed to load dashboard data"), indicator: "red" }, 5);
		},
	});
}

function _trigger_sync(page) {
	const btn = page.body.find(".std-btn-sync");
	btn.prop("disabled", true).text(__("Syncing…"));
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.trigger_sync_all",
		callback(r) {
			btn.prop("disabled", false).text(__("Sync Active Journeys"));
			const res = r.message || {};
			if (res.status === "success") {
				frappe.show_alert({ message: res.message, indicator: "green" }, 5);
				setTimeout(() => _load_data(page), 1500);
			} else {
				frappe.msgprint({ title: __("Sync Failed"), message: res.message, indicator: "red" });
			}
		},
		error() {
			btn.prop("disabled", false).text(__("Sync Active Journeys"));
			frappe.show_alert({ message: __("Sync request failed"), indicator: "red" }, 5);
		},
	});
}


// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _build_skeleton(page) {
	$(page.body).html(`
		<div class="std-dashboard">
			<div class="std-toolbar">
				<div class="std-toolbar-left">
					<div class="std-filters">
						<button class="std-filter-btn active" data-filter="all">${__("All")}</button>
						<button class="std-filter-btn" data-filter="active">${__("Active")}</button>
						<button class="std-filter-btn" data-filter="moving">${__("Moving Now")}</button>
						<button class="std-filter-btn" data-filter="in_transit">${__("In Transit")}</button>
						<button class="std-filter-btn" data-filter="offline">${__("Offline")}</button>
					</div>
					<div class="std-search-wrap">
						<input
							type="search"
							class="std-search-input"
							placeholder="${__("Search devices, journeys, vehicles, locations...")}"
						/>
					</div>
				</div>
				<div class="std-actions">
					<span class="std-refresh-label"></span>
					<button class="std-btn std-btn-refresh">${__("Refresh")}</button>
					<button class="std-btn std-btn-sync">${__("Sync Active Journeys")}</button>
				</div>
			</div>
			<div class="std-summary-row"></div>
			<div class="std-table-section">
				<div class="std-table-scroll">
					<div class="std-device-table-wrap"></div>
				</div>
				<div class="std-pagination"></div>
			</div>
			<div class="std-loading" style="display:none">
				<div class="std-spinner"></div>
			</div>
		</div>
	`);

	// Filter clicks
	$(page.body).on("click", ".std-filter-btn", function () {
		$(page.body).find(".std-filter-btn").removeClass("active");
		$(this).addClass("active");
		page.std_state.filter = $(this).data("filter");
		page.std_state.page = 1;
		_render_device_table(page);
	});

	// Refresh / Sync buttons
	$(page.body).on("click", ".std-btn-refresh", () => _load_data(page));
	$(page.body).on("click", ".std-btn-sync", () => _trigger_sync(page));
	$(page.body).on("input", ".std-search-input", function () {
		page.std_state.search = ($(this).val() || "").trim().toLowerCase();
		page.std_state.page = 1;
		_render_device_table(page);
	});

	$(page.body).on("click", ".std-device-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Device", name);
	});

	$(page.body).on("click", ".std-page-btn", function () {
		if ($(this).prop("disabled")) return;
		const nextPage = Number.parseInt($(this).data("page"), 10);
		if (!nextPage || nextPage === page.std_state.page) return;
		page.std_state.page = nextPage;
		_render_device_table(page);
	});
}

function _render_summary(page, s) {
	$(page.body).find(".std-summary-row").html(`
		<div class="std-stat-card">
			<div class="std-stat-label">${__("Total Devices")}</div>
			<div class="std-stat-value">${s.total}</div>
		</div>
		<div class="std-stat-card std-stat--green">
			<div class="std-stat-label">${__("Active")}</div>
			<div class="std-stat-value">${s.active}</div>
		</div>
		<div class="std-stat-card std-stat--teal">
			<div class="std-stat-label">${__("Moving Now")}</div>
			<div class="std-stat-value">${s.moving_now != null ? s.moving_now : 0}</div>
		</div>
		<div class="std-stat-card std-stat--blue">
			<div class="std-stat-label">${__("In Transit")}</div>
			<div class="std-stat-value">${s.in_transit}</div>
		</div>
		<div class="std-stat-card std-stat--red">
			<div class="std-stat-label">${__("Offline / Inactive")}</div>
			<div class="std-stat-value">${s.offline}</div>
		</div>
	`);
}

function _render_devices(page, devices) {
	page.std_state.devices = Array.isArray(devices) ? devices : [];
	page.std_state.page = 1;
	_render_device_table(page);
}

function _render_device_table(page) {
	const devices = _get_filtered_devices(page);

	if (!devices.length) {
		$(page.body).find(".std-device-table-wrap").html(
			`<p class="std-empty">${__("No Seal Devices found for the current filters.")}</p>`
		);
		$(page.body).find(".std-pagination").empty();
		return;
	}

	const pageSize = page.std_state.page_size;
	const totalPages = Math.max(1, Math.ceil(devices.length / pageSize));
	page.std_state.page = Math.min(page.std_state.page, totalPages);

	const start = (page.std_state.page - 1) * pageSize;
	const rows = devices.slice(start, start + pageSize).map(d => _device_row_html(d)).join("");

	$(page.body).find(".std-device-table-wrap").html(`
			<table class="std-device-table">
				<thead>
					<tr>
						<th>${__("Device")}</th>
						<th>${__("Status")}</th>
						<th>${__("Lock Status")}</th>
						<th>${__("Journey")}</th>
						<th>${__("Vehicle")}</th>
					<th>${__("Location")}</th>
					<th>${__("Speed")}</th>
					<th>${__("Battery")}</th>
					<th>${__("Last Sync")}</th>
					<th>${__("Error")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`);

	_render_pagination(page, devices.length, start + 1, Math.min(start + pageSize, devices.length));
}

function _device_row_html(d) {
	const statusRaw = (d.last_api_status || d.current_status || "").toUpperCase();
	const apiClass = _status_class(statusRaw);
	const statusText = d.last_api_status || d.current_status || __("Unknown");
	const journeyText = d.current_journey
		? `${frappe.utils.escape_html(d.current_journey)}<div class="std-row-subtle">${__("In Transit")}</div>`
		: `<span class="std-cell-muted">—</span>`;
	const vehicle = d.journey_vehicle || d.current_vehicle || "—";
	const location = d.last_known_api_location || d.current_location || "—";
	const speed = d.speed != null ? `${d.speed} km/h` : "—";
	const battery = d.battery_level != null ? `${d.battery_level}%` : "—";
	const lockStatus = d.lock_status || __("Unknown");
	const lockClass = d.lock_status === "Locked" ? "active" : d.lock_status === "Unlocked" ? "offline" : "unknown";
	const syncTime = d.last_successful_sync_time
		? frappe.datetime.prettyDate(d.last_successful_sync_time)
		: __("Never");
	const errorText = d.api_error_message
		? frappe.utils.escape_html(d.api_error_message.slice(0, 80))
		: "—";

		return `
		<tr class="std-device-row" data-name="${frappe.utils.escape_html(d.name)}">
			<td>
				<div class="std-cell-strong">${frappe.utils.escape_html(d.name)}</div>
			</td>
			<td>
				<span class="std-badge std-badge--${apiClass}">${frappe.utils.escape_html(statusText)}</span>
			</td>
			<td>
				<span class="std-badge std-badge--${lockClass}">${frappe.utils.escape_html(lockStatus)}</span>
			</td>
			<td>${journeyText}</td>
			<td>${frappe.utils.escape_html(vehicle)}</td>
			<td class="std-cell-location">${frappe.utils.escape_html(location)}</td>
			<td>${frappe.utils.escape_html(speed)}</td>
			<td>${frappe.utils.escape_html(battery)}</td>
			<td>${frappe.utils.escape_html(syncTime)}</td>
			<td class="std-cell-error">${errorText}</td>
		</tr>
	`;
}

function _render_pagination(page, totalRecords, rangeStart, rangeEnd) {
	const totalPages = Math.max(1, Math.ceil(totalRecords / page.std_state.page_size));
	const currentPage = page.std_state.page;

	$(page.body).find(".std-pagination").html(`
		<div class="std-pagination-status">
			${__("Showing {0}-{1} of {2}", [rangeStart, rangeEnd, totalRecords])}
		</div>
		<div class="std-pagination-controls">
			<button class="std-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>
				${__("Previous")}
			</button>
			<span class="std-page-indicator">${__("Page {0} of {1}", [currentPage, totalPages])}</span>
			<button class="std-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>
				${__("Next")}
			</button>
		</div>
	`);
}

function _get_filtered_devices(page) {
	const filter = page.std_state.filter;
	const search = page.std_state.search;
	return page.std_state.devices.filter(d => {
		const bucket = _device_status(d).bucket;
		const matchesFilter =
			filter === "all" ||
			(filter === "active" && bucket === "active") ||
			(filter === "moving" && _is_moving_now(d)) ||
			(filter === "in_transit" && Boolean(d.current_journey)) ||
			(filter === "offline" && bucket === "offline");

		if (!matchesFilter) return false;
		if (!search) return true;

		return _row_search_text(d).includes(search);
	});
}

function _row_search_text(d) {
	return [
		d.name,
		d.last_api_status,
		d.lock_status,
		d.current_status,
		d.current_journey,
		d.journey_vehicle,
		d.current_vehicle,
		d.journey_destination,
		d.last_known_api_location,
		d.current_location,
		d.latitude,
		d.longitude,
		d.speed,
		d.battery_level,
		d.api_error_message,
	]
		.filter(value => value !== null && value !== undefined && value !== "")
		.join(" ")
		.toLowerCase();
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Map the raw device-API status vocabulary to internal dashboard buckets.
// Mirrors normalize_api_status() in seal_sync.py:
//   bucket: "active" (online) | "offline"   — used for summary counts & filters
//   motion: moving | stopped | idle | inactive | unknown — used for "Moving Now"
//   badge:  CSS badge class for the status pill
const _STATUS_MAP = {
	RUNNING: { bucket: "active", motion: "moving", badge: "active" },
	MOVING: { bucket: "active", motion: "moving", badge: "active" },
	ON: { bucket: "active", motion: "moving", badge: "active" },
	ACTIVE: { bucket: "active", motion: "moving", badge: "active" },
	STOP: { bucket: "active", motion: "stopped", badge: "idle" },
	STOPPED: { bucket: "active", motion: "stopped", badge: "idle" },
	IDLE: { bucket: "active", motion: "idle", badge: "idle" },
	INACTIVE: { bucket: "offline", motion: "inactive", badge: "offline" },
	OFFLINE: { bucket: "offline", motion: "inactive", badge: "offline" },
};

const _UNKNOWN_STATUS = { bucket: "offline", motion: "unknown", badge: "unknown" };

function _normalize_status(raw) {
	const key = (raw || "").trim().toUpperCase();
	if (!key) return _UNKNOWN_STATUS;
	return _STATUS_MAP[key] || _UNKNOWN_STATUS;
}

function _device_status(d) {
	return _normalize_status(d.last_api_status || d.current_status || "");
}

// True when the device is genuinely moving right now. We trust the reported
// status (RUNNING), not the speed field: an INACTIVE device echoes its last
// known speed from before it went dark, so speed > 0 there is stale, not live.
function _is_moving_now(d) {
	return _device_status(d).motion === "moving";
}

function _status_class(status) {
	return _normalize_status(status).badge;
}

function _set_loading(page, on) {
	$(page.body).find(".std-loading").toggle(on);
}

function _update_refresh_time(page) {
	const t = frappe.datetime.now_time();
	$(page.body).find(".std-refresh-label").text(__("Updated {0}", [t]));
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function _inject_styles() {
	if (document.getElementById("std-dashboard-styles")) return;
	const style = document.createElement("style");
	style.id = "std-dashboard-styles";
	style.textContent = `
		.std-dashboard {
			max-width: 1600px;
			margin: 0 auto;
			padding: 20px 16px 48px;
			font-family: var(--font-stack);
			position: relative;
		}

		/* Toolbar */
		.std-toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 10px;
			margin-bottom: 20px;
		}
		.std-toolbar-left {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 10px;
			flex: 1 1 640px;
		}
		.std-filters { display: flex; gap: 6px; flex-wrap: wrap; }
		.std-search-wrap {
			flex: 1 1 320px;
			min-width: 240px;
		}
		.std-search-input {
			width: 100%;
			padding: 8px 12px;
			border: 1px solid var(--border-color, #d1d5db);
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			font-size: 13px;
		}
		.std-search-input:focus {
			outline: none;
			border-color: var(--primary, #2490ef);
			box-shadow: 0 0 0 3px rgba(36, 144, 239, 0.12);
		}
		.std-filter-btn {
			padding: 5px 14px;
			border-radius: 20px;
			border: 1px solid var(--border-color, #d1d5db);
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			cursor: pointer;
			font-size: 13px;
			transition: all .15s;
		}
		.std-filter-btn.active, .std-filter-btn:hover {
			background: var(--primary, #2490ef);
			border-color: var(--primary, #2490ef);
			color: #fff;
		}
		.std-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
		.std-refresh-label { font-size: 12px; color: var(--text-muted, #6b7280); }
		.std-btn {
			padding: 6px 16px;
			border-radius: 6px;
			border: 1px solid var(--border-color, #d1d5db);
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			cursor: pointer;
			font-size: 13px;
			transition: background .15s;
		}
		.std-btn:hover { background: var(--subtle-bg, #f3f4f6); }
		.std-btn-sync {
			background: var(--primary, #2490ef);
			border-color: var(--primary, #2490ef);
			color: #fff;
		}
		.std-btn-sync:hover { background: #1d7fd6; }
		.std-btn-sync:disabled { opacity: .6; cursor: default; }

		/* Summary row */
		.std-summary-row {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 12px;
			margin-bottom: 24px;
		}
		.std-stat-card {
			background: var(--card-bg, #fff);
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 12px;
			padding: 12px 16px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		.std-stat-value {
			font-size: 26px;
			font-weight: 700;
			color: var(--heading-color, #111827);
			line-height: 1;
			white-space: nowrap;
		}
		.std-stat-label {
			font-size: 12px;
			color: var(--text-muted, #6b7280);
			line-height: 1.2;
		}
		.std-stat--green { border-left: 4px solid #22c55e; }
		.std-stat--teal  { border-left: 4px solid #14b8a6; }
		.std-stat--blue  { border-left: 4px solid #3b82f6; }
		.std-stat--red   { border-left: 4px solid #ef4444; }

		/* Device table */
		.std-table-section {
			background: var(--card-bg, #fff);
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 14px;
			overflow: hidden;
		}
		.std-table-scroll {
			overflow-x: auto;
		}
		.std-device-table {
			width: 100%;
			border-collapse: collapse;
			min-width: 1180px;
		}
		.std-device-table th,
		.std-device-table td {
			padding: 12px 14px;
			border-bottom: 1px solid var(--border-color, #eef2f7);
			text-align: left;
			vertical-align: top;
			font-size: 13px;
			color: var(--text-color, #374151);
		}
		.std-device-table th {
			background: var(--subtle-bg, #f8fafc);
			font-size: 12px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: var(--text-muted, #6b7280);
			white-space: nowrap;
		}
		.std-device-row {
			cursor: pointer;
			transition: background .15s ease;
		}
		.std-device-row:hover {
			background: rgba(36, 144, 239, 0.06);
		}
		.std-cell-strong { font-weight: 700; color: var(--heading-color, #111827); }
		.std-row-subtle,
		.std-cell-muted {
			margin-top: 3px;
			font-size: 11px;
			color: var(--text-muted, #6b7280);
		}
		.std-cell-location {
			max-width: 260px;
			min-width: 220px;
			white-space: normal;
			word-break: break-word;
		}
		.std-cell-error {
			max-width: 260px;
			color: #b91c1c;
			white-space: normal;
			word-break: break-word;
		}

		/* Badges */
		.std-badge {
			display: inline-block;
			padding: 2px 8px;
			border-radius: 12px;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: .4px;
		}
		.std-badge--active  { background: #dcfce7; color: #15803d; }
		.std-badge--idle    { background: #fef9c3; color: #a16207; }
		.std-badge--offline { background: #fee2e2; color: #b91c1c; }
		.std-badge--unknown { background: #f3f4f6; color: #6b7280; }
		.std-badge--blue    { background: #dbeafe; color: #1d4ed8; }

		/* Pagination */
		.std-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 12px 14px;
			background: var(--subtle-bg, #f8fafc);
		}
		.std-pagination-status,
		.std-page-indicator {
			font-size: 12px;
			color: var(--text-muted, #6b7280);
		}
		.std-pagination-controls {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.std-page-btn {
			padding: 6px 12px;
			border-radius: 6px;
			border: 1px solid var(--border-color, #d1d5db);
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			font-size: 12px;
			cursor: pointer;
		}
		.std-page-btn:disabled {
			opacity: .5;
			cursor: default;
		}

		/* Loading overlay */
		.std-loading {
			position: absolute; top: 0; left: 0; right: 0; bottom: 0;
			display: flex; align-items: center; justify-content: center;
			background: rgba(255,255,255,.6);
			border-radius: 8px;
			z-index: 10;
		}
		.std-spinner {
			width: 36px; height: 36px;
			border: 3px solid #e5e7eb;
			border-top-color: var(--primary, #2490ef);
			border-radius: 50%;
			animation: std-spin .7s linear infinite;
		}
		@keyframes std-spin { to { transform: rotate(360deg); } }

		/* Empty state */
		.std-empty {
			text-align: center;
			color: var(--text-muted, #6b7280);
			padding: 60px 20px;
			font-size: 15px;
		}

		/* Dark mode */
		[data-theme="dark"] .std-table-section,
		[data-theme="dark"] .std-stat-card   { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .std-device-table th { background: #0f172a; color: #94a3b8; }
		[data-theme="dark"] .std-device-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .std-device-row:hover { background: rgba(59, 130, 246, 0.12); }
		[data-theme="dark"] .std-loading      { background: rgba(15,23,42,.6); }
		[data-theme="dark"] .std-btn          { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .std-filter-btn  { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .std-search-input { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .std-page-btn,
		[data-theme="dark"] .std-pagination { background: #0f172a; border-color: #334155; color: #f1f5f9; }

		@media (max-width: 640px) {
			.std-summary-row { grid-template-columns: repeat(2, 1fr); }
			.std-toolbar { flex-direction: column; align-items: flex-start; }
			.std-toolbar-left { width: 100%; }
			.std-search-wrap { width: 100%; min-width: 0; }
			.std-pagination { flex-direction: column; align-items: flex-start; }
		}
	`;
	document.head.appendChild(style);
}
