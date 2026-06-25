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
		branch: "",
		page: 1,
		page_size: 30,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _load_seal_devices(page));

	const $statsBar = $('<div class="sd-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.sd_stats_bar = $statsBar;

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
			_render_branch_filter(page);
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
	const filters = [
		["all", __("All")],
		["available", __("Available")],
		["assigned", __("Assigned")],
		["issues", __("Issues")],
		["excluded", __("Deassigned")],
	];

	$(page.body).html(`
		<div class="sd-page">
			<section class="sd-panel">
				<div class="sd-toolbar">
					<div class="sd-toolbar-top">
						<label class="sd-field sd-search-inline">
							<input class="sd-search" type="search" placeholder="${__("Seal, vehicle, branch, status or technician")}">
						</label>

						<div class="sd-filter-dropdown">
							<button class="sd-filter-btn" type="button">
								<span class="sd-filter-btn-label">${__("All")}</span>
								<span class="sd-filter-btn-count">0</span>
								<span class="sd-filter-arrow">&#9662;</span>
							</button>
							<div class="sd-filter-menu">
								${filters.map(([val, lbl]) => `
									<div class="sd-filter-item ${val === "all" ? "active" : ""}" data-filter="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="sd-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="sd-field sd-branch-field">
							<span>${__("Branch")}</span>
							<select class="sd-branch-filter" aria-label="${__("Filter by branch")}">
								<option value="">${__("All Branches")}</option>
							</select>
						</label>

						<div class="sd-actions">
							<button class="sd-clear-btn" type="button">${__("Clear filters")}</button>
							<div class="sd-action-dropdown">
								<button class="sd-btn sd-btn-actions" type="button">${__("Actions")} <span class="sd-caret">&#9662;</span></button>
								<div class="sd-action-menu">
									<button class="sd-action-item" data-action="sync-active">${__("Sync Active")}</button>
									<button class="sd-action-item" data-action="sync-all">${__("Sync All Devices")}</button>
									<button class="sd-action-item" data-action="fetch-seals">${__("Fetch Seals")}</button>
									<button class="sd-action-item" data-action="sync-alerts">${__("Sync Uffizio Alerts")}</button>
									<div class="sd-action-divider"></div>
									<button class="sd-action-item" data-action="refresh">${__("Refresh")}</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section class="sd-table-panel">
				<div class="sd-table-scroll"><div class="sd-table-wrap"></div></div>
				<div class="sd-pagination"></div>
			</section>

			<div class="sd-loading" style="display:none"><div class="sd-spinner"></div></div>
		</div>
	`);

	$(page.body).on("click", ".sd-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".sd-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".sd-filter-item", function () {
		page.sd_state.filter = $(this).data("filter");
		page.sd_state.page = 1;
		$(page.body).find(".sd-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".sd-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".sd-filter-menu").removeClass("open");
		_render_seal_device_stats(page, _seal_device_summary(page.sd_state.devices));
		_render_seal_device_table(page);
	});

	$(page.body).on("input", ".sd-search", function () {
		page.sd_state.search = ($(this).val() || "").trim().toLowerCase();
		page.sd_state.page = 1;
		_render_seal_device_table(page);
	});

	$(page.body).on("change", ".sd-branch-filter", function () {
		page.sd_state.branch = $(this).val() || "";
		page.sd_state.page = 1;
		_render_seal_device_table(page);
	});

	$(page.body).on("click", ".sd-clear-btn", () => _clear_seal_device_filters(page));

	$(page.body).on("click", ".sd-btn-actions", function (e) {
		e.stopPropagation();
		$(page.body).find(".sd-action-dropdown").toggleClass("open");
	});
	$(page.body).on("click", ".sd-action-item", function () {
		const action = $(this).data("action");
		$(page.body).find(".sd-action-dropdown").removeClass("open");
		if (action === "sync-active") _sync_active_journeys(page);
		else if (action === "sync-all") _sync_all_devices(page);
		else if (action === "fetch-seals") _fetch_seals(page);
		else if (action === "sync-alerts") _sync_alert_data(page);
		else if (action === "refresh") _load_seal_devices(page);
	});
	$(document).on("click.sd-dropdown", () => {
		$(page.body).find(".sd-action-dropdown").removeClass("open");
		$(page.body).find(".sd-filter-menu").removeClass("open");
	});
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
		busyLabel: __("Syncing Active…"),
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.trigger_sync_all",
	});
}

function _sync_all_devices(page) {
	_run_sync(page, {
		busyLabel: __("Syncing All Devices…"),
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.trigger_sync_all_devices",
	});
}

function _sync_alert_data(page) {
	// Unverified Trakzee Premium endpoint (see seal_sync.sync_alert_data) — manual
	// trigger only until a live run confirms real alert rows come back.
	const $toggle = $(page.body).find(".sd-btn-actions");
	const originalHtml = $toggle.html();
	$toggle.prop("disabled", true).text(__("Syncing Alerts…"));
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.manual_sync_alert_data",
		freeze: true,
		freeze_message: __("Fetching alerts from Uffizio…"),
		callback(r) {
			$toggle.prop("disabled", false).html(originalHtml);
			const res = r.message || {};
			if (res.status === "success") {
				frappe.show_alert(
					{ message: __("{0} new alert(s), {1} already logged.", [res.created || 0, res.skipped || 0]), indicator: "green" },
					7
				);
			} else {
				frappe.msgprint({
					title: __("Alert Sync Failed"),
					message: res.message || __("Unknown error — check Seal API Sync Log."),
					indicator: "red",
				});
			}
		},
		error() {
			$toggle.prop("disabled", false).html(originalHtml);
			frappe.msgprint({
				title: __("Alert Sync Failed"),
				message: __("Unexpected error — check Seal API Sync Log for details."),
				indicator: "red",
			});
		},
	});
}

function _fetch_seals(page) {
	const $toggle = $(page.body).find(".sd-btn-actions");
	const originalHtml = $toggle.html();
	$toggle.prop("disabled", true).text(__("Fetching Seals…"));
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_sync.import_devices_from_api",
		freeze: true,
		freeze_message: __("Fetching seals from Uffizio…"),
		callback(r) {
			$toggle.prop("disabled", false).html(originalHtml);
			const res = r.message || {};
			const indicator = res.errors ? "orange" : "green";
			frappe.show_alert({
				message: __("{0} created, {1} skipped, {2} failed.", [res.created || 0, res.skipped || 0, res.errors || 0]),
				indicator,
			}, 7);
			_load_seal_devices(page);
		},
		error() {
			$toggle.prop("disabled", false).html(originalHtml);
			frappe.show_alert({ message: __("Fetch seals request failed"), indicator: "red" }, 7);
		},
	});
}

function _run_sync(page, { busyLabel, method }) {
	const $toggle = $(page.body).find(".sd-btn-actions");
	const originalHtml = $toggle.html();
	$toggle.prop("disabled", true).text(busyLabel);
	frappe.call({
		method,
		callback(r) {
			$toggle.prop("disabled", false).html(originalHtml);
			const res = r.message || {};
			if (res.status === "success") {
				frappe.show_alert({ message: res.message || __("Sync complete"), indicator: "green" }, 5);
				_load_seal_devices(page);
			} else {
				frappe.show_alert({ message: res.message || __("Sync failed"), indicator: "red" }, 7);
			}
		},
		error() {
			$toggle.prop("disabled", false).html(originalHtml);
			frappe.show_alert({ message: __("Sync request failed"), indicator: "red" }, 7);
		},
	});
}

function _render_seal_device_stats(page, summary) {
	const stats = [
		[__("All"), summary.total || 0, ""],
		[__("Available"), summary.available || 0, "sd-stat--approved"],
		[__("Assigned"), summary.assigned || 0, "sd-stat--pending"],
		[__("Issues"), summary.issues || 0, "sd-stat--rejected"],
		[__("Moving"), summary.moving_now || 0, "sd-stat--moving"],
	];

	const html = stats.map(([label, value, className]) => `
		<div class="sd-stat-card ${className}">
			<div class="sd-stat-label">${label}</div>
			<div class="sd-stat-value">${value}</div>
		</div>
	`).join("");
	if (page.sd_stats_bar) {
		page.sd_stats_bar.html(html);
	}

	const counts = _seal_device_filter_counts(page.sd_state.devices);
	$(page.body).find(".sd-fcount").each(function () {
		$(this).text(counts[$(this).data("fcount")] || 0);
	});
	$(page.body).find(".sd-filter-btn-count").text(counts[page.sd_state.filter] || 0);
}

function _seal_device_summary(devices) {
	return {
		total: devices.length,
		available: devices.filter(d => d.current_status === "Available").length,
		assigned: devices.filter(d => ["Assigned", "In Journey"].includes(d.current_status || "")).length,
		issues: devices.filter(d => ["Damaged", "Lost", "Inactive"].includes(d.current_status || "") || ["Damaged", "Lost"].includes(d.condition || "")).length,
		moving_now: devices.filter(d => (d.last_api_status || "").trim().toUpperCase() === "RUNNING").length,
	};
}

function _seal_device_filter_counts(devices) {
	return {
		all: devices.length,
		available: devices.filter(d => d.current_status === "Available").length,
		assigned: devices.filter(d => ["Assigned", "In Journey"].includes(d.current_status || "")).length,
		issues: devices.filter(d => ["Damaged", "Lost", "Inactive"].includes(d.current_status || "") || ["Damaged", "Lost"].includes(d.condition || "")).length,
		excluded: devices.filter(_is_sync_excluded).length,
	};
}

function _clear_seal_device_filters(page) {
	page.sd_state.search = "";
	page.sd_state.filter = "all";
	page.sd_state.branch = "";
	page.sd_state.page = 1;
	$(page.body).find(".sd-search").val("");
	$(page.body).find(".sd-branch-filter").val("");
	$(page.body).find(".sd-filter-item").removeClass("active");
	$(page.body).find('.sd-filter-item[data-filter="all"]').addClass("active");
	$(page.body).find(".sd-filter-btn-label").text(__("All"));
	_render_seal_device_stats(page, _seal_device_summary(page.sd_state.devices));
	_render_seal_device_table(page);
}

function _render_branch_filter(page) {
	const branches = [...new Set(
		page.sd_state.devices
			.map(d => (d.api_branch || "").trim())
			.filter(Boolean)
	)].sort((a, b) => a.localeCompare(b));

	if (page.sd_state.branch && !branches.includes(page.sd_state.branch)) {
		page.sd_state.branch = "";
	}

	const options = [`<option value="">${__("All Branches")}</option>`]
		.concat(branches.map(branch => `
			<option value="${frappe.utils.escape_html(branch)}" ${branch === page.sd_state.branch ? "selected" : ""}>
				${frappe.utils.escape_html(branch)}
			</option>
		`));
	$(page.body).find(".sd-branch-filter").html(options.join(""));
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
					<th>${__("Branch")}</th>
					<th>${__("Journey")}</th>
					<th>${__("Technician")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Coordinates")}</th>
					<th>${__("Location")}</th>
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
		? frappe.datetime.prettyDate(d.last_successful_sync_time).replace(/\s+ago$/i, "")
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
			<td>${frappe.utils.escape_html(d.api_branch || "—")}</td>
			<td>${d.current_journey ? frappe.utils.escape_html(d.current_journey) : "—"}</td>
			<td>${d.current_technician ? frappe.utils.escape_html(d.current_technician) : "—"}</td>
			<td>${frappe.utils.escape_html(d.journey_vehicle || d.current_vehicle || "—")}</td>
			<td>${coordLine}</td>
			<td>${frappe.utils.escape_html(d.current_location || d.last_known_api_location || "—")}</td>
			<td>${battery}</td>
			<td>${frappe.utils.escape_html(lastSync)}</td>
		</tr>
	`;
}

function _render_seal_device_pagination(page, totalRecords, rangeStart, rangeEnd) {
	const totalPages = Math.max(1, Math.ceil(totalRecords / page.sd_state.page_size));
	const currentPage = page.sd_state.page;

	$(page.body).find(".sd-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [rangeStart, rangeEnd, totalRecords])}</span>
		<div>
			<button class="sd-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [currentPage, totalPages])}</b>
			<button class="sd-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _get_filtered_seal_devices(page) {
	const filter = page.sd_state.filter;
	const search = page.sd_state.search;
	const branch = page.sd_state.branch;

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
		if (branch && (d.api_branch || "") !== branch) return false;
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
		d.api_branch,
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
			--sd-blue: #0284c7;
			--sd-dark: #075985;
			max-width: 1200px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		.sd-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.sd-header-stats .sd-stat-card {
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
		.sd-header-stats .sd-stat--pending { border-top-color: #f59e0b; }
		.sd-header-stats .sd-stat--approved { border-top-color: #16a34a; }
		.sd-header-stats .sd-stat--rejected { border-top-color: #dc2626; }
		.sd-header-stats .sd-stat--moving { border-top-color: #2563eb; }
		.sd-header-stats .sd-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.sd-header-stats .sd-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		.sd-panel,
		.sd-table-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.sd-panel { margin-bottom: 20px; }
		.sd-table-panel { position: sticky; top: 60px; }
		.sd-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }
		.sd-table-scroll::-webkit-scrollbar { height: 10px; }
		.sd-table-scroll::-webkit-scrollbar-thumb { background: #bae6fd; border-radius: 999px; }

		.sd-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.sd-toolbar-top { display: flex; align-items: center; gap: 12px; }
		.sd-search-inline { flex: 1; display: flex; align-items: center; margin: 0; }
		.sd-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.sd-search-inline input:focus,
		.sd-branch-filter:focus {
			outline: none;
			border-color: var(--sd-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		.sd-filter-dropdown,
		.sd-action-dropdown { position: relative; }
		.sd-filter-btn,
		.sd-btn-actions {
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
		.sd-filter-btn:hover,
		.sd-btn-actions:hover:not(:disabled) { border-color: var(--sd-blue); }
		.sd-filter-btn-count,
		.sd-fcount {
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
		.sd-filter-arrow,
		.sd-caret { color: #94a3b8; font-size: 11px; }
		.sd-filter-menu,
		.sd-action-menu {
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
		.sd-action-menu { position: absolute; right: 0; top: calc(100% + 6px); }
		.sd-filter-menu.open,
		.sd-action-dropdown.open .sd-action-menu { display: block; }
		.sd-filter-item,
		.sd-action-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			padding: 10px 16px;
			border: 0;
			background: transparent;
			font-size: 13px;
			font-weight: 600;
			color: #334155;
			text-align: left;
			cursor: pointer;
			transition: background .12s;
		}
		.sd-filter-item:hover,
		.sd-action-item:hover { background: #f0f9ff; }
		.sd-filter-item.active { background: #e0f2fe; color: var(--sd-blue); }
		.sd-filter-item.active .sd-fcount { background: var(--sd-blue); color: #fff; }
		.sd-action-divider { height: 1px; background: #e0f2fe; margin: 4px 0; }

		.sd-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.sd-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.sd-branch-filter {
			width: 220px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 10px;
			font-size: 13px;
		}
		.sd-actions { display: flex; align-items: flex-end; gap: 8px; }
		.sd-clear-btn {
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
		.sd-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		.sd-table { width: 100%; min-width: 1180px; border-collapse: collapse; }
		.sd-table th,
		.sd-table td {
			padding: 10px 12px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.sd-table th {
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
		.sd-device-row { cursor: pointer; }
		.sd-device-row:hover { background: rgba(224, 242, 254, .7); }
		.sd-strong { font-weight: 800; color: #0c4a6e; }
		.sd-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
		}
		.sd-badge--available { background: #dcfce7; color: #166534; }
		.sd-badge--assigned { background: #e0f2fe; color: #0369a1; }
		.sd-badge--issue { background: #fee2e2; color: #b91c1c; }
		.sd-badge--neutral { background: #e5e7eb; color: #4b5563; }
		.sd-badge--excluded { background: #fef3c7; color: #92400e; margin-left: 6px; cursor: help; }
		.sd-coord-link { color: var(--sd-blue); text-decoration: none; font-size: 12px; }
		.sd-coord-link:hover { text-decoration: underline; }
		.sd-empty { padding: 60px 20px; text-align: center; color: #64748b; }
		.sd-empty strong { display: block; margin-bottom: 6px; color: #0c4a6e; font-size: 22px; }
		.sd-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.sd-pagination > div { display: flex; align-items: center; gap: 8px; }
		.sd-page-btn {
			padding: 8px 16px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.sd-page-btn:not([disabled]):hover {
			background: #f0f9ff;
			border-color: var(--sd-blue);
			color: var(--sd-blue);
			box-shadow: 0 4px 6px rgba(14, 165, 233, .1);
		}
		.sd-page-btn[disabled] {
			opacity: .6;
			cursor: not-allowed;
			background: #f8fafc;
			border-color: #e2e8f0;
			color: #94a3b8;
			box-shadow: none;
		}
		.sd-loading {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(240, 249, 255, .72);
			backdrop-filter: blur(2px);
		}
		.sd-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--sd-blue);
			border-radius: 50%;
			animation: sd-spin .7s linear infinite;
		}
		@keyframes sd-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .sd-header-stats .sd-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .sd-panel,
		[data-theme="dark"] .sd-table-panel,
		[data-theme="dark"] .sd-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .sd-search-inline input,
		[data-theme="dark"] .sd-branch-filter,
		[data-theme="dark"] .sd-filter-btn,
		[data-theme="dark"] .sd-filter-menu,
		[data-theme="dark"] .sd-action-menu,
		[data-theme="dark"] .sd-clear-btn,
		[data-theme="dark"] .sd-btn-actions {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .sd-field > span { color: #7dd3fc; }
		[data-theme="dark"] .sd-toolbar,
		[data-theme="dark"] .sd-table th,
		[data-theme="dark"] .sd-pagination { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .sd-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .sd-device-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .sd-filter-item,
		[data-theme="dark"] .sd-action-item { color: #cbd5e1; }
		[data-theme="dark"] .sd-filter-item:hover,
		[data-theme="dark"] .sd-action-item:hover { background: #0f172a; }
		[data-theme="dark"] .sd-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.sd-toolbar-top { flex-direction: column; align-items: stretch; }
			.sd-actions { align-items: stretch; }
			.sd-branch-filter { width: 100%; }
		}
		@media (max-width: 720px) {
			.sd-page { padding: 10px 8px 32px; }
			.sd-pagination { align-items: flex-start; flex-direction: column; }
			.sd-pagination > div { flex-wrap: wrap; }
		}
	`;
	document.head.appendChild(style);
}
