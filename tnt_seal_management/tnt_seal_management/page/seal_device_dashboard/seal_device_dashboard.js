frappe.pages["seal-device-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Seal Device Dashboard",
		single_column: true,
	});

	page.sd_state = {
		devices: [],
		search: "",
		filter: "all",
		page: 1,
		page_size: 30,
	};

	page.add_inner_button("← Dashboard", () => frappe.set_route("tnt-seal-management"));
	_inject_seal_device_styles();
	_build_seal_device_page(page);
	_load_seal_devices(page);
};

function _load_seal_devices(page) {
	_set_seal_device_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.get_device_dashboard_data",
		callback(r) {
			_set_seal_device_loading(page, false);
			const data = r.message || {};
			page.sd_state.devices = Array.isArray(data.devices) ? data.devices : [];
			page.sd_state.page = 1;
			_render_seal_device_stats(page, data.summary || {});
			_render_seal_device_table(page);
		},
		error() {
			_set_seal_device_loading(page, false);
			frappe.show_alert({ message: __("Failed to load seal devices"), indicator: "red" }, 5);
		},
	});
}

function _build_seal_device_page(page) {
	$(page.body).html(`
		<div class="sd-page">
			<div class="sd-toolbar">
				<div class="sd-filters">
					<button class="sd-filter-btn active" data-filter="all">${__("All")}</button>
					<button class="sd-filter-btn" data-filter="available">${__("Available")}</button>
					<button class="sd-filter-btn" data-filter="assigned">${__("Assigned")}</button>
					<button class="sd-filter-btn" data-filter="issues">${__("Issues")}</button>
					<button class="sd-filter-btn" data-filter="excluded">${__("Sync Excluded")}</button>
				</div>
				<div class="sd-actions">
					<input class="sd-search" type="search" placeholder="${__("Search seal devices...")}">
					<button class="sd-btn sd-btn-sync-active">${__("Sync Active")}</button>
					<button class="sd-btn sd-btn-sync-all">${__("Sync All Devices")}</button>
					<button class="sd-btn sd-btn-refresh">${__("Refresh")}</button>
				</div>
			</div>
			<div class="sd-stat-row"></div>
			<div class="sd-table-panel">
				<div class="sd-table-scroll">
					<div class="sd-table-wrap"></div>
				</div>
				<div class="sd-pagination"></div>
			</div>
			<div class="sd-loading" style="display:none">
				<div class="sd-spinner"></div>
			</div>
		</div>
	`);

	$(page.body).on("click", ".sd-filter-btn", function () {
		$(page.body).find(".sd-filter-btn").removeClass("active");
		$(this).addClass("active");
		page.sd_state.filter = $(this).data("filter");
		page.sd_state.page = 1;
		_render_seal_device_table(page);
	});

	$(page.body).on("input", ".sd-search", function () {
		page.sd_state.search = ($(this).val() || "").trim().toLowerCase();
		page.sd_state.page = 1;
		_render_seal_device_table(page);
	});

	$(page.body).on("click", ".sd-btn-refresh", () => _load_seal_devices(page));
	$(page.body).on("click", ".sd-btn-sync-active", () => _sync_active_journeys(page));
	$(page.body).on("click", ".sd-btn-sync-all", () => _sync_all_devices(page));
	$(page.body).on("click", ".sd-device-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Device", name);
	});
	$(page.body).on("click", ".sd-page-btn", function () {
		if ($(this).prop("disabled")) return;
		const nextPage = Number.parseInt($(this).data("page"), 10);
		if (!nextPage || nextPage === page.sd_state.page) return;
		page.sd_state.page = nextPage;
		_render_seal_device_table(page);
	});
}

function _sync_active_journeys(page) {
	_run_sync(page, {
		btnClass: ".sd-btn-sync-active",
		idleLabel: __("Sync Active"),
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.trigger_sync_all",
	});
}

function _sync_all_devices(page) {
	_run_sync(page, {
		btnClass: ".sd-btn-sync-all",
		idleLabel: __("Sync All Devices"),
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.trigger_sync_all_devices",
	});
}

function _run_sync(page, { btnClass, idleLabel, method }) {
	const $btn = $(page.body).find(btnClass);
	$btn.prop("disabled", true).text(__("Syncing…"));
	frappe.call({
		method,
		callback(r) {
			$btn.prop("disabled", false).text(idleLabel);
			const res = r.message || {};
			if (res.status === "success") {
				frappe.show_alert({ message: res.message || __("Sync complete"), indicator: "green" }, 5);
				_load_seal_devices(page);
			} else {
				frappe.show_alert({ message: res.message || __("Sync failed"), indicator: "red" }, 7);
			}
		},
		error() {
			$btn.prop("disabled", false).text(idleLabel);
			frappe.show_alert({ message: __("Sync request failed"), indicator: "red" }, 7);
		},
	});
}

function _render_seal_device_stats(page, summary) {
	const stats = [
		[__("Total"), summary.total || 0],
		[__("Available"), summary.available || 0],
		[__("Assigned / In Journey"), summary.assigned || 0],
		[__("Issues"), summary.issues || 0],
	];

	$(page.body).find(".sd-stat-row").html(
		stats.map(([label, value]) => `
			<div class="sd-stat-card">
				<span class="sd-stat-label">${label}</span>
				<span class="sd-stat-value">${value}</span>
			</div>
		`).join("")
	);
}

function _render_seal_device_table(page) {
	const devices = _get_filtered_seal_devices(page);

	if (!devices.length) {
		$(page.body).find(".sd-table-wrap").html(`<p class="sd-empty">${__("No seal devices match the current filters.")}</p>`);
		$(page.body).find(".sd-pagination").empty();
		return;
	}

	const pageSize = page.sd_state.page_size;
	const totalPages = Math.max(1, Math.ceil(devices.length / pageSize));
	page.sd_state.page = Math.min(page.sd_state.page, totalPages);

	const start = (page.sd_state.page - 1) * pageSize;
	const visibleDevices = devices.slice(start, start + pageSize);

	$(page.body).find(".sd-table-wrap").html(`
		<table class="sd-table">
			<thead>
				<tr>
					<th>${__("Seal")}</th>
					<th>${__("Status")}</th>
					<th>${__("Journey")}</th>
					<th>${__("Technician")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Coordinates")}</th>
					<th>${__("Battery")}</th>
					<th>${__("Last Sync")}</th>
				</tr>
			</thead>
			<tbody>${visibleDevices.map(_seal_device_row_html).join("")}</tbody>
		</table>
	`);

	_render_seal_device_pagination(page, devices.length, start + 1, Math.min(start + pageSize, devices.length));
}

// A device is "sync excluded" when its IMEI was cleared because the tracking
// API rejected it (see the [SYNC EXCLUDED] note written into remarks). Such
// devices never appear in sync results, so we flag them explicitly.
function _is_sync_excluded(d) {
	return (d.remarks || "").includes("[SYNC EXCLUDED");
}

function _seal_device_row_html(d) {
	const status = d.current_status || __("Unknown");
	const statusClass = _seal_device_status_class(status);
	const excludedBadge = _is_sync_excluded(d)
		? `<span class="sd-badge sd-badge--excluded" title="${frappe.utils.escape_html(d.remarks || "")}">${__("Sync Excluded")}</span>`
		: "";
	const battery = _format_battery(d.battery_level);
	const lastSync = d.last_successful_sync_time
		? frappe.datetime.prettyDate(d.last_successful_sync_time)
		: __("Never");
	const coordLine = (d.latitude && d.longitude)
		? `<a class="sd-coord-link" href="https://maps.google.com/?q=${d.latitude},${d.longitude}" target="_blank" onclick="event.stopPropagation()">
				${parseFloat(d.latitude).toFixed(5)}, ${parseFloat(d.longitude).toFixed(5)}
		   </a>`
		: "—";

	return `
		<tr class="sd-device-row" data-name="${frappe.utils.escape_html(d.name)}">
			<td><span class="sd-strong">${frappe.utils.escape_html(d.name)}</span>${excludedBadge}</td>
			<td><span class="sd-badge sd-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
			<td>${d.current_journey ? frappe.utils.escape_html(d.current_journey) : "—"}</td>
			<td>${d.current_technician ? frappe.utils.escape_html(d.current_technician) : "—"}</td>
			<td>${frappe.utils.escape_html(d.journey_vehicle || d.current_vehicle || "—")}</td>
			<td>${coordLine}</td>
			<td>${battery}</td>
			<td>${frappe.utils.escape_html(lastSync)}</td>
		</tr>
	`;
}

function _render_seal_device_pagination(page, totalRecords, rangeStart, rangeEnd) {
	const totalPages = Math.max(1, Math.ceil(totalRecords / page.sd_state.page_size));
	const currentPage = page.sd_state.page;

	$(page.body).find(".sd-pagination").html(`
		<div class="sd-pagination-status">${__("Showing {0}-{1} of {2}", [rangeStart, rangeEnd, totalRecords])}</div>
		<div class="sd-pagination-controls">
			<button class="sd-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>${__("Previous")}</button>
			<span class="sd-page-label">${__("Page {0} of {1}", [currentPage, totalPages])}</span>
			<button class="sd-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _get_filtered_seal_devices(page) {
	const filter = page.sd_state.filter;
	const search = page.sd_state.search;

	return page.sd_state.devices.filter(d => {
		const status = d.current_status || "";
		const condition = d.condition || "";
		const matchesFilter =
			filter === "all" ||
			(filter === "available" && status === "Available") ||
			(filter === "assigned" && ["Assigned", "In Journey"].includes(status)) ||
			(filter === "issues" && (["Damaged", "Lost", "Inactive"].includes(status) || ["Damaged", "Lost"].includes(condition))) ||
			(filter === "excluded" && _is_sync_excluded(d));

		if (!matchesFilter) return false;
		if (!search) return true;
		return _seal_device_search_text(d).includes(search);
	});
}

function _seal_device_search_text(d) {
	return [
		d.name,
		d.current_status,
		d.condition,
		d.current_journey,
		d.current_technician,
		d.current_vehicle,
		d.journey_vehicle,
		d.latitude,
		d.longitude,
		d.battery_level,
		d.last_api_status,
		d.remarks,
	]
		.filter(value => value !== null && value !== undefined && value !== "")
		.join(" ")
		.toLowerCase();
}

function _seal_device_status_class(status) {
	if (status === "Available") return "available";
	if (["Assigned", "In Journey", "Arrived"].includes(status)) return "assigned";
	if (["Damaged", "Lost", "Inactive"].includes(status)) return "issue";
	return "neutral";
}

function _format_battery(value) {
	if (value === null || value === undefined || value === "") return "—";
	const text = String(value);
	return frappe.utils.escape_html(text.includes("%") ? text : `${text}%`);
}

function _set_seal_device_loading(page, on) {
	$(page.body).find(".sd-loading").toggle(on);
}

function _inject_seal_device_styles() {
	if (document.getElementById("seal-device-page-styles")) return;

	const style = document.createElement("style");
	style.id = "seal-device-page-styles";
	style.textContent = `
		.sd-page {
			max-width: 1280px;
			margin: 0 auto;
			padding: 16px 16px 40px;
			position: relative;
		}
		.sd-toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			flex-wrap: wrap;
			margin-bottom: 12px;
		}
		.sd-filters,
		.sd-actions {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.sd-filter-btn,
		.sd-btn,
		.sd-page-btn {
			border: 1px solid var(--border-color, #d1d5db);
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			border-radius: 6px;
			padding: 6px 12px;
			font-size: 13px;
			cursor: pointer;
		}
		.sd-filter-btn.active {
			background: var(--primary, #2490ef);
			border-color: var(--primary, #2490ef);
			color: #fff;
		}
		.sd-btn-refresh {
			background: #111111;
			border-color: #111111;
			color: #ffffff;
		}
		.sd-btn-refresh:hover {
			background: #000000;
			border-color: #000000;
			color: #ffffff;
		}
		.sd-btn-sync-active {
			background: var(--primary, #2490ef);
			border-color: var(--primary, #2490ef);
			color: #ffffff;
		}
		.sd-btn-sync-active:hover:not(:disabled) {
			filter: brightness(0.9);
		}
		.sd-btn-sync-active:disabled {
			opacity: .6;
			cursor: default;
		}
		.sd-btn-sync-all {
			background: #0e7490;
			border-color: #0e7490;
			color: #ffffff;
		}
		.sd-btn-sync-all:hover:not(:disabled) {
			filter: brightness(0.9);
		}
		.sd-btn-sync-all:disabled {
			opacity: .6;
			cursor: default;
		}
		.sd-search {
			width: 280px;
			max-width: 100%;
			padding: 7px 12px;
			border: 1px solid var(--border-color, #d1d5db);
			border-radius: 6px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #374151);
			font-size: 13px;
		}
		.sd-stat-row {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 10px;
			margin-bottom: 14px;
		}
		.sd-stat-card {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 8px;
			background: var(--card-bg, #fff);
			padding: 10px 14px;
		}
		.sd-stat-label {
			color: var(--text-muted, #6b7280);
			font-size: 12px;
		}
		.sd-stat-value {
			color: var(--heading-color, #111827);
			font-size: 22px;
			font-weight: 700;
			line-height: 1;
		}
		.sd-table-panel {
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 8px;
			background: var(--card-bg, #fff);
			overflow: hidden;
		}
		.sd-table-scroll {
			overflow-x: auto;
		}
		.sd-table {
			width: 100%;
			min-width: 920px;
			border-collapse: collapse;
		}
		.sd-table th,
		.sd-table td {
			border-bottom: 1px solid var(--border-color, #eef2f7);
			padding: 11px 12px;
			text-align: left;
			vertical-align: middle;
			font-size: 13px;
			color: var(--text-color, #374151);
		}
		.sd-table th {
			background: var(--subtle-bg, #f8fafc);
			color: var(--text-muted, #6b7280);
			font-size: 12px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: .04em;
		}
		.sd-device-row {
			cursor: pointer;
		}
		.sd-device-row:hover {
			background: rgba(36, 144, 239, 0.06);
		}
		.sd-strong {
			font-weight: 700;
			color: var(--heading-color, #111827);
		}
		.sd-badge {
			display: inline-flex;
			align-items: center;
			border-radius: 999px;
			padding: 2px 8px;
			font-size: 12px;
			font-weight: 600;
		}
		.sd-badge--available { background: #dcfce7; color: #15803d; }
		.sd-badge--assigned { background: #dbeafe; color: #1d4ed8; }
		.sd-badge--issue { background: #fee2e2; color: #b91c1c; }
		.sd-badge--neutral { background: #f3f4f6; color: #4b5563; }
		.sd-badge--excluded {
			background: #fef3c7;
			color: #92400e;
			margin-left: 6px;
			cursor: help;
		}
		.sd-coord-link {
			color: var(--primary, #2490ef);
			text-decoration: none;
			font-size: 12px;
		}
		.sd-coord-link:hover {
			text-decoration: underline;
		}
		.sd-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 12px;
			background: var(--subtle-bg, #f8fafc);
		}
		.sd-pagination-status,
		.sd-page-label {
			font-size: 12px;
			color: var(--text-muted, #6b7280);
		}
		.sd-pagination-controls {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.sd-page-btn:disabled {
			opacity: .5;
			cursor: default;
		}
		.sd-empty {
			margin: 0;
			padding: 48px 16px;
			text-align: center;
			color: var(--text-muted, #6b7280);
		}
		.sd-loading {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(255,255,255,.6);
			z-index: 10;
		}
		.sd-spinner {
			width: 34px;
			height: 34px;
			border: 3px solid #e5e7eb;
			border-top-color: var(--primary, #2490ef);
			border-radius: 50%;
			animation: sd-spin .7s linear infinite;
		}
		@keyframes sd-spin { to { transform: rotate(360deg); } }
		[data-theme="dark"] .sd-filter-btn,
		[data-theme="dark"] .sd-btn,
		[data-theme="dark"] .sd-page-btn,
		[data-theme="dark"] .sd-search,
		[data-theme="dark"] .sd-stat-card,
		[data-theme="dark"] .sd-table-panel {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .sd-btn-refresh {
			background: #f8fafc;
			border-color: #f8fafc;
			color: #0f172a;
		}
		[data-theme="dark"] .sd-table th,
		[data-theme="dark"] .sd-pagination {
			background: #0f172a;
		}
		[data-theme="dark"] .sd-table td {
			border-bottom-color: #334155;
			color: #cbd5e1;
		}
		@media (max-width: 700px) {
			.sd-stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.sd-search { width: 100%; }
			.sd-actions { width: 100%; }
			.sd-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
