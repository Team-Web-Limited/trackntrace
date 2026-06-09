frappe.pages["seal-tracking-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Seal Tracking Dashboard",
		single_column: true,
	});

	$(wrapper).data("page_obj", page);

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
				<div class="std-filters">
					<button class="std-filter-btn active" data-filter="all">${__("All")}</button>
					<button class="std-filter-btn" data-filter="active">${__("Active")}</button>
					<button class="std-filter-btn" data-filter="in_transit">${__("In Transit")}</button>
					<button class="std-filter-btn" data-filter="offline">${__("Offline")}</button>
				</div>
				<div class="std-actions">
					<span class="std-refresh-label"></span>
					<button class="std-btn std-btn-refresh">${__("Refresh")}</button>
					<button class="std-btn std-btn-sync">${__("Sync Active Journeys")}</button>
				</div>
			</div>
			<div class="std-summary-row"></div>
			<div class="std-device-grid"></div>
			<div class="std-loading" style="display:none">
				<div class="std-spinner"></div>
			</div>
		</div>
	`);

	// Filter clicks
	$(page.body).on("click", ".std-filter-btn", function () {
		$(page.body).find(".std-filter-btn").removeClass("active");
		$(this).addClass("active");
		const filter = $(this).data("filter");
		$(page.body).find(".std-device-card").each(function () {
			const matches =
				filter === "all" ||
				(filter === "active" && $(this).data("api-status") === "active") ||
				(filter === "in_transit" && $(this).data("in-transit") === "1") ||
				(filter === "offline" && $(this).data("api-status") === "offline");
			$(this).toggle(matches);
		});
	});

	// Refresh / Sync buttons
	$(page.body).on("click", ".std-btn-refresh", () => _load_data(page));
	$(page.body).on("click", ".std-btn-sync", () => _trigger_sync(page));
}

function _render_summary(page, s) {
	$(page.body).find(".std-summary-row").html(`
		<div class="std-stat-card">
			<div class="std-stat-value">${s.total}</div>
			<div class="std-stat-label">${__("Total Devices")}</div>
		</div>
		<div class="std-stat-card std-stat--green">
			<div class="std-stat-value">${s.active}</div>
			<div class="std-stat-label">${__("Active")}</div>
		</div>
		<div class="std-stat-card std-stat--blue">
			<div class="std-stat-value">${s.in_transit}</div>
			<div class="std-stat-label">${__("In Transit")}</div>
		</div>
		<div class="std-stat-card std-stat--red">
			<div class="std-stat-value">${s.offline}</div>
			<div class="std-stat-label">${__("Offline / Inactive")}</div>
		</div>
	`);
}

function _render_devices(page, devices) {
	if (!devices.length) {
		$(page.body).find(".std-device-grid").html(
			`<p class="std-empty">${__("No Seal Devices found. Create one in the Seal Device list.")}</p>`
		);
		return;
	}

	const cards = devices.map(d => _device_card_html(d)).join("");
	$(page.body).find(".std-device-grid").html(cards);

	// Card click → open device form
	$(page.body).on("click", ".std-device-card", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Device", name);
	});
}

function _device_card_html(d) {
	const statusRaw = (d.last_api_status || d.current_status || "").toUpperCase();
	const apiClass = _status_class(statusRaw);
	const inTransit = d.current_journey ? "1" : "0";

	const statusBadge = `<span class="std-badge std-badge--${apiClass}">${d.last_api_status || d.current_status || __("Unknown")}</span>`;
	const journeyBadge = d.current_journey
		? `<span class="std-badge std-badge--blue">${__("In Transit")}</span>`
		: "";

	const location = d.last_known_api_location || d.current_location || "—";
	const speed = d.speed != null ? `${d.speed} km/h` : "—";
	const battery = d.battery_level != null ? `${d.battery_level}%` : "—";
	const syncTime = d.last_successful_sync_time
		? frappe.datetime.prettyDate(d.last_successful_sync_time)
		: __("Never");

	const coordLine = (d.latitude && d.longitude)
		? `<a class="std-coord-link" href="https://maps.google.com/?q=${d.latitude},${d.longitude}" target="_blank" onclick="event.stopPropagation()">
				${parseFloat(d.latitude).toFixed(5)}, ${parseFloat(d.longitude).toFixed(5)}
		   </a>`
		: "—";

	const errorHtml = d.api_error_message
		? `<div class="std-error-row">⚠ ${frappe.utils.escape_html(d.api_error_message.slice(0, 80))}</div>`
		: "";

	const vehicle = d.journey_vehicle || d.current_vehicle || "—";
	const destination = d.journey_destination ? ` → ${frappe.utils.escape_html(d.journey_destination)}` : "";

	return `
		<div class="std-device-card" data-name="${frappe.utils.escape_html(d.name)}"
		     data-api-status="${apiClass}" data-in-transit="${inTransit}">
			<div class="std-card-header">
				<div class="std-card-title">
					<span class="std-device-name">${frappe.utils.escape_html(d.name)}</span>
					${d.imei_number ? `<span class="std-imei">${frappe.utils.escape_html(d.imei_number)}</span>` : ""}
				</div>
				<div class="std-card-badges">${statusBadge}${journeyBadge}</div>
			</div>

			<div class="std-card-body">
				<div class="std-info-row">
					<span class="std-info-icon">🚗</span>
					<span>${frappe.utils.escape_html(vehicle)}${frappe.utils.escape_html(destination)}</span>
				</div>
				<div class="std-info-row">
					<span class="std-info-icon">📍</span>
					<span class="std-location">${frappe.utils.escape_html(location)}</span>
				</div>
				<div class="std-info-row">
					<span class="std-info-icon">🗺</span>
					<span>${coordLine}</span>
				</div>
			</div>

			<div class="std-card-metrics">
				<div class="std-metric">
					<div class="std-metric-value">${speed}</div>
					<div class="std-metric-label">${__("Speed")}</div>
				</div>
				<div class="std-metric">
					<div class="std-metric-value">${battery}</div>
					<div class="std-metric-label">${__("Battery")}</div>
				</div>
				<div class="std-metric">
					<div class="std-metric-value std-sync-time">${syncTime}</div>
					<div class="std-metric-label">${__("Last Sync")}</div>
				</div>
			</div>
			${errorHtml}
		</div>
	`;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _status_class(status) {
	if (["ACTIVE", "MOVING", "ON"].includes(status)) return "active";
	if (["IDLE", "STOP"].includes(status)) return "idle";
	if (["INACTIVE", "OFFLINE"].includes(status)) return "offline";
	return "unknown";
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
			max-width: 1280px;
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
		.std-filters { display: flex; gap: 6px; flex-wrap: wrap; }
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
			grid-template-columns: repeat(4, 1fr);
			gap: 12px;
			margin-bottom: 24px;
		}
		.std-stat-card {
			background: var(--card-bg, #fff);
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 12px;
			padding: 16px 20px;
			text-align: center;
		}
		.std-stat-value { font-size: 32px; font-weight: 700; color: var(--heading-color, #111827); }
		.std-stat-label { font-size: 12px; color: var(--text-muted, #6b7280); margin-top: 4px; }
		.std-stat--green { border-left: 4px solid #22c55e; }
		.std-stat--blue  { border-left: 4px solid #3b82f6; }
		.std-stat--red   { border-left: 4px solid #ef4444; }

		/* Device grid */
		.std-device-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
			gap: 16px;
		}
		.std-device-card {
			background: var(--card-bg, #fff);
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 14px;
			padding: 16px;
			cursor: pointer;
			transition: box-shadow .15s, border-color .15s;
		}
		.std-device-card:hover {
			box-shadow: 0 4px 16px rgba(0,0,0,.08);
			border-color: var(--primary, #2490ef);
		}

		/* Card header */
		.std-card-header {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			gap: 8px;
			margin-bottom: 12px;
		}
		.std-card-title { display: flex; flex-direction: column; gap: 2px; }
		.std-device-name { font-weight: 700; font-size: 15px; color: var(--heading-color, #111827); }
		.std-imei { font-size: 11px; color: var(--text-muted, #6b7280); font-family: monospace; }
		.std-card-badges { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }

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

		/* Card body */
		.std-card-body { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
		.std-info-row { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--text-color, #374151); }
		.std-info-icon { flex-shrink: 0; width: 18px; }
		.std-location { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px; }
		.std-coord-link { color: var(--primary, #2490ef); text-decoration: none; font-size: 12px; }
		.std-coord-link:hover { text-decoration: underline; }

		/* Metrics row */
		.std-card-metrics {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 8px;
			border-top: 1px solid var(--border-color, #f0f0f0);
			padding-top: 10px;
		}
		.std-metric { text-align: center; }
		.std-metric-value { font-size: 16px; font-weight: 600; color: var(--heading-color, #111827); }
		.std-metric-label { font-size: 11px; color: var(--text-muted, #6b7280); margin-top: 2px; }
		.std-sync-time { font-size: 12px; }

		/* Error row */
		.std-error-row {
			margin-top: 8px;
			font-size: 12px;
			color: #b91c1c;
			background: #fef2f2;
			border-radius: 6px;
			padding: 4px 8px;
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
			grid-column: 1 / -1;
			text-align: center;
			color: var(--text-muted, #6b7280);
			padding: 60px 20px;
			font-size: 15px;
		}

		/* Dark mode */
		[data-theme="dark"] .std-device-card { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .std-stat-card   { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .std-loading      { background: rgba(15,23,42,.6); }
		[data-theme="dark"] .std-btn          { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .std-filter-btn  { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .std-location, [data-theme="dark"] .std-info-row { color: #cbd5e1; }

		@media (max-width: 640px) {
			.std-summary-row { grid-template-columns: repeat(2, 1fr); }
			.std-toolbar { flex-direction: column; align-items: flex-start; }
		}
	`;
	document.head.appendChild(style);
}
