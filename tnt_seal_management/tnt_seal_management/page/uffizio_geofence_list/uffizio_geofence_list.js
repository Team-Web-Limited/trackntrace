const UG_API = "tnt_seal_management.tnt_seal_management.api.geofence_sync";
const UG_COUNTRIES = "Kenya\nUganda\nTanzania\nDR Congo\nRwanda\nBurundi\nEthiopia\nSouth Sudan";
const UG_LOCATION_TYPES = "Port\nInland Container Depot\nBorder Post\nCity/Town\nWeighbridge\nDepot/Warehouse";

frappe.pages["uffizio-geofence-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Uffizio Geofences"),
		single_column: true,
	});

	page.ug_state = {
		search: "",
		scope: "ours",
		link: "all",
		page: 1,
		page_length: 25,
		total: 0,
		rows: [],
		selected: new Set(),
		can_manage: false,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _ug_load(page));

	_ug_inject_styles();
	_ug_build_page(page);
	_ug_load(page);
};

// Sync button only for the roles allowed to use it; added once the
// first load reports what the user may do.
function _ug_add_manage_actions(page) {
	if (page.ug_actions_added) return;
	page.ug_actions_added = true;
	page.add_inner_button(__("Sync from Uffizio"), () => _ug_sync(page));
}

function _ug_build_page(page) {
	const scopes = [
		["ours", __("Our Geofences")],
		["shared", __("Shared Geofences")],
		["all", __("All Geofences")],
	];
	const links = [
		["all", __("All")],
		["unlinked", __("Not Linked")],
		["linked", __("Linked")],
	];

	$(page.body).html(`
		<div class="ug-page">
			<section class="ug-panel">
				<div class="ug-toolbar">
					<label class="ug-search-inline">
						<input class="ug-search" type="search" placeholder="${__("Geofence name, ID, group, category or Transport Location")}">
					</label>
					<select class="ug-select ug-scope">
						${scopes.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
					</select>
					<div class="ug-chips">
						${links.map(([v, l]) => `
							<button class="ug-chip ${v === "all" ? "active" : ""}" data-link="${v}">
								${l} <span class="ug-chip-count" data-count="${v}">0</span>
							</button>
						`).join("")}
					</div>
					<button class="ug-clear-btn">${__("Clear filters")}</button>
				</div>
				<div class="ug-selection-bar" style="display:none"></div>
			</section>

			<section class="ug-table-panel">
				<div class="ug-table-scroll"><div class="ug-table-wrap"></div></div>
				<div class="ug-pagination"></div>
			</section>

			<div class="ug-loading" style="display:none"><div class="ug-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _ug_debounce(() => {
		page.ug_state.search = ($(page.body).find(".ug-search").val() || "").trim();
		page.ug_state.page = 1;
		_ug_load(page);
	}, 350);
	$(page.body).on("input", ".ug-search", delayedSearch);

	$(page.body).on("change", ".ug-scope", function () {
		page.ug_state.scope = $(this).val();
		page.ug_state.page = 1;
		_ug_load(page);
	});

	$(page.body).on("click", ".ug-chip", function () {
		page.ug_state.link = $(this).data("link");
		page.ug_state.page = 1;
		$(page.body).find(".ug-chip").removeClass("active");
		$(this).addClass("active");
		_ug_load(page);
	});

	$(page.body).on("click", ".ug-clear-btn", () => {
		Object.assign(page.ug_state, { search: "", scope: "ours", link: "all", page: 1 });
		page.ug_state.selected.clear();
		$(page.body).find(".ug-search").val("");
		$(page.body).find(".ug-scope").val("ours");
		$(page.body).find(".ug-chip").removeClass("active");
		$(page.body).find('.ug-chip[data-link="all"]').addClass("active");
		_ug_load(page);
	});

	// Ticking a row (or the header box) selects it for "Create Transport
	// Locations"; selections survive paging and filtering until cleared.
	$(page.body).on("click", ".ug-check-cell", (e) => e.stopPropagation());
	$(page.body).on("change", ".ug-row-check", function () {
		const name = String($(this).data("name"));
		if (this.checked) page.ug_state.selected.add(name);
		else page.ug_state.selected.delete(name);
		_ug_render_selection(page);
	});
	$(page.body).on("change", ".ug-all-check", function () {
		const checked = this.checked;
		page.ug_state.rows
			.filter((r) => _ug_selectable(r))
			.forEach((r) => (checked ? page.ug_state.selected.add(r.name) : page.ug_state.selected.delete(r.name)));
		$(page.body).find(".ug-row-check").prop("checked", checked);
		_ug_render_selection(page);
	});
	$(page.body).on("click", ".ug-clear-selection", () => {
		page.ug_state.selected.clear();
		$(page.body).find(".ug-row-check, .ug-all-check").prop("checked", false);
		_ug_render_selection(page);
	});

	$(page.body).on("click", ".ug-row", function (e) {
		if ($(e.target).closest("a, input, button").length) return;
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Uffizio Geofence", String(name));
	});

	$(page.body).on("click", ".ug-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.ug_state.page = Number.parseInt($(this).data("page"), 10);
		_ug_load(page);
	});
}

function _ug_load(page) {
	const state = page.ug_state;
	const requestId = ++state.request_id;
	_ug_set_loading(page, true);
	frappe.call({
		method: `${UG_API}.get_geofence_page`,
		args: {
			search: state.search,
			scope: state.scope,
			link: state.link,
			page: state.page,
			page_length: state.page_length,
		},
		callback(r) {
			if (requestId !== state.request_id) return;
			_ug_set_loading(page, false);
			const data = r.message || {};
			state.total = data.total || 0;
			state.rows = data.geofences || [];
			state.can_manage = !!data.can_manage;
			if (state.can_manage) _ug_add_manage_actions(page);
			_ug_render_stats(page, data);
			_ug_render_table(page);
			_ug_render_pagination(page);
			_ug_render_selection(page);
		},
		error() {
			if (requestId !== state.request_id) return;
			_ug_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load geofences"), indicator: "red" }, 5);
		},
	});
}

function _ug_render_stats(page, data) {
	const summary = data.summary || {};
	$(page.body).find(".ug-chip-count").each(function () {
		$(this).text(summary[$(this).data("count")] || 0);
	});
}

// Routes carry no area, and a geofence already linked needs no new location.
function _ug_selectable(row) {
	return row.shape !== "Route" && !row.transport_locations;
}

function _ug_render_table(page) {
	const state = page.ug_state;
	const rows = state.rows;
	if (!rows.length) {
		$(page.body).find(".ug-table-wrap").html(`
			<div class="ug-empty">
				<strong>${__("No geofences found")}</strong>
				<span>${__("Sync from Uffizio or clear the filters to see more.")}</span>
			</div>
		`);
		return;
	}
	$(page.body).find(".ug-table-wrap").html(`
		<table class="ug-table">
			<thead><tr>
				<th>${__("Geofence")}</th>
				<th>${__("Group")}</th>
				<th>${__("Category")}</th>
				<th>${__("Shape")}</th>
				<th>${__("Transport Location")}</th>
				<th>${__("Map")}</th>
				<th>${__("Last Synced")}</th>
			</tr></thead>
			<tbody>${rows.map((r) => _ug_row_html(r, state)).join("")}</tbody>
		</table>
	`);
}

function _ug_row_html(g, state) {
	const esc = frappe.utils.escape_html;
	const dash = "—";
	const locations = (g.transport_locations || "")
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => `<a href="/app/transport-location/${encodeURIComponent(l)}">${esc(l)}</a>`)
		.join(", ");
	const map =
		g.latitude || g.longitude
			? `<a href="https://www.google.com/maps?q=${g.latitude},${g.longitude}" target="_blank" rel="noopener">${__("Open")}</a>`
			: dash;
	const owner = g.is_ours ? "" : `<div class="ug-muted">${esc(g.company_name || __("Shared"))}</div>`;

	return `
		<tr class="ug-row" data-name="${esc(g.name)}">
			<td><span class="ug-name">${esc(g.geofence_name || g.name)}</span>${owner}</td>
			<td>${esc(g.geofence_group || dash)}</td>
			<td>${esc(g.category || dash)}</td>
			<td>${esc(g.shape || dash)}</td>
			<td>${locations || `<span class="ug-badge ug-badge--open">${__("Not linked")}</span>`}</td>
			<td>${map}</td>
			<td class="ug-nowrap">${g.last_synced ? esc(frappe.datetime.str_to_user(g.last_synced)) : dash}</td>
		</tr>
	`;
}

function _ug_render_selection(page) {
	const count = page.ug_state.selected.size;
	const $bar = $(page.body).find(".ug-selection-bar");
	if (!count) {
		$bar.hide();
		return;
	}
	$bar.html(`
		<span>${__("{0} geofence(s) selected for Create Transport Locations", [count])}</span>
		<button class="ug-clear-selection">${__("Clear selection")}</button>
	`).show();
}

function _ug_render_pagination(page) {
	const state = page.ug_state;
	const pages = Math.max(1, Math.ceil(state.total / state.page_length));
	state.page = Math.min(state.page, pages);
	const start = state.total ? (state.page - 1) * state.page_length + 1 : 0;
	const end = Math.min(state.page * state.page_length, state.total);
	$(page.body).find(".ug-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, state.total])}</span>
		<div>
			<button class="ug-page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [state.page, pages])}</b>
			<button class="ug-page-btn" data-page="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _ug_sync(page) {
	frappe.call({
		method: `${UG_API}.manual_sync_geofences`,
		freeze: true,
		freeze_message: __("Pulling geofences from Uffizio…"),
		callback(r) {
			const res = r.message || {};
			if (res.status !== "success") {
				frappe.msgprint({ title: __("Sync failed"), message: res.message || __("Unknown error"), indicator: "red" });
				return;
			}
			frappe.show_alert({
				message: __("{0} geofences: {1} new, {2} updated, {3} auto-linked", [res.total, res.created, res.updated, res.auto_linked]),
				indicator: "green",
			});
			_ug_load(page);
		},
	});
}

function _ug_create_locations(page) {
	const geofences = Array.from(page.ug_state.selected);
	if (!geofences.length) {
		frappe.msgprint(__("Tick the geofences to create Transport Locations for. Geofences already linked, and routes, can't be ticked."));
		return;
	}
	frappe.prompt(
		[
			{
				fieldname: "location_role",
				fieldtype: "Select",
				label: __("Role"),
				options: "Terminal\nCheckpoint",
				default: "Terminal",
				reqd: 1,
				description: __("Terminals can be a Journey Request origin/destination; Checkpoints are stops along the route."),
			},
			{ fieldname: "country", fieldtype: "Select", label: __("Country"), options: UG_COUNTRIES, default: "Kenya", reqd: 1 },
			{ fieldname: "location_type", fieldtype: "Select", label: __("Type"), options: UG_LOCATION_TYPES, default: "Depot/Warehouse", reqd: 1 },
		],
		(values) => {
			frappe.call({
				method: `${UG_API}.create_transport_locations`,
				args: { geofences, ...values },
				freeze: true,
				callback(r) {
					const res = r.message || {};
					const line = (label, rows) =>
						rows && rows.length
							? `<p><b>${label} (${rows.length}):</b> ${rows.map(frappe.utils.escape_html).join(", ")}</p>`
							: "";
					frappe.msgprint({
						title: __("Transport Locations"),
						message:
							line(__("Created"), res.created) +
							line(__("Linked existing"), res.linked) +
							line(__("Skipped — already linked or a route"), res.skipped),
						indicator: "green",
					});
					page.ug_state.selected.clear();
					_ug_load(page);
				},
			});
		},
		__("Create Transport Locations for {0} geofence(s)", [geofences.length]),
		__("Create")
	);
}

function _ug_set_loading(page, show) {
	$(page.body).find(".ug-loading").toggle(show);
}

function _ug_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _ug_inject_styles() {
	if (document.getElementById("uffizio-geofence-list-styles")) return;
	const style = document.createElement("style");
	style.id = "uffizio-geofence-list-styles";
	style.textContent = `
		.ug-page {
			--ug-blue: #0284c7;
			--ug-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- panels ---- */
		.ug-panel, .ug-table-panel {
			border: 1px solid rgba(14, 165, 233, .2); border-radius: 22px;
			background: var(--card-bg, #fff); box-shadow: 0 4px 12px rgba(14, 165, 233, .05); overflow: hidden;
		}
		.ug-panel { margin-bottom: 20px; }
		.ug-table-scroll { overflow: auto; max-height: calc(100vh - 220px); }

		/* ---- toolbar ---- */
		.ug-toolbar { display: flex; align-items: center; gap: 12px; padding: 18px; background: #f0f9ff; flex-wrap: wrap; }
		.ug-search-inline { flex: 1; min-width: 240px; margin: 0; }
		.ug-search-inline input, .ug-select {
			width: 100%; height: 38px; padding: 8px 12px; border: 1px solid #bae6fd; border-radius: 10px;
			background: var(--card-bg, #fff); color: var(--text-color, #0c4a6e); font-size: 14px;
		}
		.ug-select { width: auto; font-weight: 700; color: #075985; }
		.ug-search-inline input:focus, .ug-select:focus { outline: none; border-color: var(--ug-blue); box-shadow: 0 0 0 3px rgba(14, 165, 233, .12); }
		.ug-chips { display: flex; gap: 6px; }
		.ug-chip {
			display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px;
			border: 1px solid #bae6fd; border-radius: 10px; background: var(--card-bg, #fff);
			color: #075985; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
		}
		.ug-chip.active { background: #e0f2fe; border-color: var(--ug-blue); }
		.ug-chip-count { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: #e0f2fe; font-size: 11px; font-weight: 800; text-align: center; }
		.ug-chip.active .ug-chip-count { background: var(--ug-blue); color: #fff; }
		.ug-clear-btn, .ug-clear-selection {
			height: 38px; padding: 0 16px; border: 1px solid #cbd5e1; border-radius: 10px;
			background: var(--card-bg, #fff); color: #475569; font-size: 13px; font-weight: 700; cursor: pointer;
		}
		.ug-selection-bar {
			display: flex; align-items: center; justify-content: space-between; gap: 12px;
			padding: 10px 18px; border-top: 1px solid #e0f2fe; background: #fffbeb; color: #92400e; font-weight: 700; font-size: 13px;
		}
		.ug-selection-bar .ug-clear-selection { height: 30px; }

		/* ---- table ---- */
		.ug-table { width: 100%; min-width: 1100px; border-collapse: collapse; }
		.ug-table th, .ug-table td {
			padding: 14px 16px; border-bottom: 1px solid #e0f2fe; text-align: left; vertical-align: middle;
			color: var(--text-color, #334155); font-size: 14px; line-height: 1.45;
		}
		.ug-table th {
			position: sticky; top: 0; z-index: 10; background: #f0f9ff; color: #0369a1;
			font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
		}
		.ug-check-cell { width: 36px; }
		.ug-row { cursor: pointer; }
		.ug-row:hover { background: rgba(224, 242, 254, .7); }
		.ug-name { color: var(--ug-blue); font-weight: 800; }
		.ug-muted { color: var(--text-muted, #64748b); font-size: 12px; }
		.ug-nowrap { white-space: nowrap; }
		.ug-badge { display: inline-flex; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 800; white-space: nowrap; }
		.ug-badge--open { background: #fef3c7; color: #b45309; }
		.ug-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 58px 20px; color: var(--text-muted, #64748b); text-align: center; }
		.ug-empty strong { color: var(--ug-ink); font-size: 22px; }

		/* ---- pagination ---- */
		.ug-pagination {
			display: flex; align-items: center; justify-content: space-between; gap: 12px;
			padding: 15px 18px; background: #f0f9ff; color: #0369a1; font-size: 13px;
		}
		.ug-pagination div { display: flex; align-items: center; gap: 9px; }
		.ug-page-btn {
			padding: 6px 12px; border: 1px solid #bae6fd; border-radius: 8px;
			background: var(--card-bg, #fff); color: #075985; font-size: 13px; font-weight: 700; cursor: pointer;
		}
		.ug-page-btn:disabled { cursor: default; opacity: .45; }

		/* ---- loading ---- */
		.ug-loading {
			position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
			background: rgba(240, 249, 255, .72); backdrop-filter: blur(2px);
		}
		.ug-spinner {
			width: 38px; height: 38px; border: 3px solid rgba(14, 165, 233, .18); border-top-color: var(--ug-blue);
			border-radius: 50%; animation: ug-spin .7s linear infinite;
		}
		@keyframes ug-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .ug-panel, [data-theme="dark"] .ug-table-panel,
		[data-theme="dark"] .ug-page-btn, [data-theme="dark"] .ug-chip,
		[data-theme="dark"] .ug-search-inline input, [data-theme="dark"] .ug-select,
		[data-theme="dark"] .ug-clear-btn, [data-theme="dark"] .ug-clear-selection {
			background: #1e293b; border-color: #334155; color: #cbd5e1;
		}
		[data-theme="dark"] .ug-toolbar, [data-theme="dark"] .ug-table th, [data-theme="dark"] .ug-pagination {
			background: #0f172a; border-color: #334155; color: #7dd3fc;
		}
		[data-theme="dark"] .ug-chip.active { background: rgba(14, 165, 233, .2); }
		[data-theme="dark"] .ug-selection-bar { background: rgba(245, 158, 11, .12); color: #fcd34d; border-color: #334155; }
		[data-theme="dark"] .ug-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .ug-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .ug-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 720px) {
			.ug-page { padding: 10px 8px 32px; }
			.ug-toolbar { flex-direction: column; align-items: stretch; }
			.ug-chips { flex-wrap: wrap; }
			.ug-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
