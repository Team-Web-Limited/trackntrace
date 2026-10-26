// The same page serves both systems: /app/warehouse-list for TNT and
// /app/warehouse-list/rects for RECTS. Seals are shared; each system lists the
// warehouses of its own Branch (see SYSTEM_DIVISIONS in seal_warehouses.py).
const WH_SYSTEMS = {
	TNT: {
		title: "Warehouses",
		dashboard: "tnt-seal-management",
		division: "ECTS Division",
		empty_hint: "Warehouses appear here when their Branch is ECTS Division or Both. Clear the filters to see more.",
	},
	RECTS: {
		title: "RECTS Warehouses",
		dashboard: "rects",
		division: "RECTS Division",
		empty_hint: "Warehouses appear here when their Branch is RECTS Division. Clear the filters to see more.",
	},
};

function _wh_route_system() {
	return String(frappe.get_route()[1] || "").toLowerCase() === "rects" ? "RECTS" : "TNT";
}

frappe.pages["warehouse-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Warehouses"),
		single_column: true,
	});
	wrapper.page = page;
	page.wh_system = _wh_route_system();
	page.set_title(__(WH_SYSTEMS[page.wh_system].title));

	page.wh_state = {
		search: "",
		statuses: [], // selected filters; empty = All
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route(WH_SYSTEMS[page.wh_system].dashboard));
	page.add_inner_button(__("Refresh"), () => _wh_load(page));

	const $statsBar = $('<div class="wh-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.wh_stats_bar = $statsBar;

	_wh_inject_styles();
	_wh_build_page(page);
	_wh_load(page);
};

// Switching between /app/warehouse-list and /app/warehouse-list/rects reuses
// the loaded page, so start over with the other system's warehouses.
frappe.pages["warehouse-list"].on_page_show = function (wrapper) {
	const page = wrapper.page;
	if (!page || page.wh_system === _wh_route_system()) return;
	page.wh_system = _wh_route_system();
	page.set_title(__(WH_SYSTEMS[page.wh_system].title));
	Object.assign(page.wh_state, { search: "", statuses: [], page: 1 });
	$(page.body).find(".wh-search").val("");
	_wh_load(page);
};

function _wh_build_page(page) {
	const statuses = [
		["All", __("All Warehouses")],
		["Active", __("Active")],
		["Inactive", __("Inactive")],
		["User", __("Held by Staff")],
		["Customer", __("Held by Customers")],
	];

	$(page.body).html(`
		<div class="wh-page">
			<section class="wh-panel">
				<div class="wh-toolbar">
					<div class="wh-toolbar-top">
						<label class="wh-field wh-search-inline">
							<input class="wh-search" type="search" placeholder="${__("Warehouse, staff, role, customer, location or address")}">
						</label>

						<div class="wh-filter-dropdown">
							<button class="wh-filter-btn">
								<span class="wh-filter-btn-label">${__("All Warehouses")}</span>
								<span class="wh-filter-btn-count">0</span>
								<span class="wh-filter-arrow">&#9662;</span>
							</button>
							<div class="wh-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="wh-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										<span class="wh-filter-check"></span>
										<span class="wh-filter-item-label">${frappe.utils.escape_html(lbl)}</span>
										<span class="wh-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<div class="wh-actions">
							<button class="wh-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="wh-table-panel">
				<div class="wh-table-scroll"><div class="wh-table-wrap"></div></div>
				<div class="wh-pagination"></div>
			</section>

			<div class="wh-loading" style="display:none"><div class="wh-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _wh_debounce(() => {
		page.wh_state.search = ($(page.body).find(".wh-search").val() || "").trim();
		page.wh_state.page = 1;
		_wh_load(page);
	}, 350);

	$(page.body).on("input", ".wh-search", delayedSearch);

	$(page.body).on("click", ".wh-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".wh-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	// Several filters can be ticked at once; the menu stays open while picking.
	// "All" clears the selection.
	$(page.body).on("click", ".wh-filter-item", function (e) {
		e.stopPropagation();
		const status = $(this).data("status");
		const selected = new Set(page.wh_state.statuses);
		if (status === "All") selected.clear();
		else if (selected.has(status)) selected.delete(status);
		else selected.add(status);
		page.wh_state.statuses = [...selected];
		page.wh_state.page = 1;
		_wh_sync_filter_menu(page);
		_wh_load(page);
	});

	$(document).on("click.wh-dropdown", function () {
		$(page.body).find(".wh-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".wh-clear-btn", () => _wh_clear(page));

	$(page.body).on("click", ".wh-base-edit", function (e) {
		e.stopPropagation(); // the row itself opens the seals held
		_wh_edit_base_location(page, $(this).data("user"), $(this).data("base") || "");
	});

	$(page.body).on("click", ".wh-row", function () {
		const name = $(this).data("name");
		const type = $(this).data("holder-type");
		if (!name) return;
		if (type === "Warehouse") {
			if (page.wh_can_read_warehouse) frappe.set_route("Form", "Warehouse", name);
		} else {
			// A staff member or customer: show the seals they hold right now.
			frappe.set_route("List", "Seal Device", { current_custody_type: type, current_custodian: name });
		}
	});

	$(page.body).on("click", ".wh-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.wh_state.page = Number.parseInt($(this).data("page"), 10);
		_wh_load(page);
	});
}

function _wh_load(page) {
	const requestId = ++page.wh_state.request_id;
	_wh_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_warehouses.get_warehouse_list",
		args: {
			search: page.wh_state.search,
			status: JSON.stringify(page.wh_state.statuses),
			page: page.wh_state.page,
			page_length: page.wh_state.page_length,
			system: page.wh_system,
		},
		callback(r) {
			if (requestId !== page.wh_state.request_id) return;
			_wh_set_loading(page, false);
			const data = r.message || {};
			page.wh_state.total = data.total || 0;
			page.wh_can_read_warehouse = !!data.can_read_warehouse;
			page.wh_can_edit_base_location = !!data.can_edit_base_location;
			page.wh_session_user = data.session_user;
			_wh_render_stats(page, data.summary || {});
			_wh_set_create_action(page, data.can_create);
			_wh_render_table(page, data.warehouses || []);
			_wh_render_pagination(page);
		},
		error() {
			if (requestId !== page.wh_state.request_id) return;
			_wh_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load warehouses"), indicator: "red" }, 5);
		},
	});
}

function _wh_render_stats(page, summary) {
	const stats = [
		["All", __("All"), ""],
		["Active", __("Active"), "wh-stat--active"],
		["Inactive", __("Inactive"), "wh-stat--inactive"],
		["User", __("Staff"), "wh-stat--user"],
		["Customer", __("Customers"), "wh-stat--customer"],
	];
	if (page.wh_stats_bar) {
		page.wh_stats_bar.html(stats.map(([key, label, cls]) => `
			<div class="wh-stat-card ${cls}">
				<div class="wh-stat-label">${label}</div>
				<div class="wh-stat-value">${summary[key] || 0}</div>
			</div>
		`).join(""));
	}

	$(page.body).find(".wh-fcount").each(function () {
		$(this).text(summary[$(this).data("fcount")] ?? 0);
	});
	page.wh_summary = summary;
	_wh_sync_filter_menu(page);
}

// "New Warehouse" only for users who may create ERPNext Warehouses; it starts
// in the current system's division so it shows up here.
function _wh_set_create_action(page, canCreate) {
	if (!canCreate || page.wh_create_added) return;
	page.wh_create_added = true;
	page.set_primary_action(__("New Warehouse"), () => frappe.new_doc("Warehouse", { custom_division: WH_SYSTEMS[page.wh_system].division }));
}

function _wh_render_table(page, warehouses) {
	if (!warehouses.length) {
		$(page.body).find(".wh-table-wrap").html(`
			<div class="wh-empty">
				<strong>${__("No seal holders found")}</strong>
				<span>${__(WH_SYSTEMS[page.wh_system].empty_hint)}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".wh-table-wrap").html(`
		<table class="wh-table">
			<thead><tr>
				<th>${__("Holder")}</th>
				<th>${__("Type")}</th>
				<th title="${__("Seal journey role of the staff member holding the seals")}">${__("Role")}</th>
				<th title="${__("Warehouse location; for staff, their base and the latest GPS position of the seals they hold")}">${__("Location")}</th>
				<th>${__("Status")}</th>
				<th>${__("Seals Held")}</th>
				<th title="${__("Seal serials ERPNext has in stock in this warehouse")}">${__("In Stock (ERP)")}</th>
				<th>${__("Company")}</th>
				<th>${__("Parent Warehouse")}</th>
				<th>${__("City")}</th>
				<th>${__("Address / Contact")}</th>
			</tr></thead>
			<tbody>${warehouses.map((w) => _wh_row_html(page, w)).join("")}</tbody>
		</table>
	`);
}

// Staff: fixed base (editable here, the only place it shows) over the live GPS
// position of the seals they hold. Customers: GPS only.
function _wh_staff_location_html(page, w) {
	const esc = frappe.utils.escape_html;
	const canEdit = w.holder_type === "User"
		&& (page.wh_can_edit_base_location || w.name === page.wh_session_user);
	const base = w.holder_type === "User"
		? `<div class="wh-base">${w.base_location ? esc(w.base_location) : `<span class="wh-muted">${__("No base set")}</span>`}${canEdit
			? ` <button class="wh-base-edit" data-user="${esc(w.name)}" data-base="${esc(w.base_location || "")}" title="${__("Set base location")}">✎</button>`
			: ""}</div>`
		: "";
	const gps = w.location ? `<div class="wh-muted">${__("GPS")}: ${esc(w.location)}</div>` : "";
	return base + gps || "—";
}

function _wh_edit_base_location(page, user, current) {
	frappe.prompt(
		{ fieldname: "base_location", fieldtype: "Data", label: __("Base Location"), default: current,
			description: __("Fixed base of this staff member, e.g. Mombasa office. Leave empty to clear.") },
		(values) => frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.seal_warehouses.set_staff_base_location",
			args: { user, base_location: values.base_location },
			callback: () => _wh_load(page),
		}),
		__("Set Base Location"),
		__("Save")
	);
}

function _wh_row_html(page, w) {
	const esc = frappe.utils.escape_html;
	const dash = "—";
	const isWarehouse = w.holder_type === "Warehouse";
	const type = isWarehouse
		? (w.is_main_seal_store ? `<span class="wh-badge wh-badge--main">${__("Main Seal Store")}</span>` : esc(__("Warehouse")))
		: `<span class="wh-badge wh-badge--${w.holder_type === "User" ? "user" : "customer"}">${w.holder_type === "User" ? __("Staff") : __("Customer")}</span>`;
	const status = isWarehouse
		? `<span class="wh-badge wh-badge--${w.disabled ? "inactive" : "active"}">${w.disabled ? __("Inactive") : __("Active")}</span>`
		: `<span class="wh-badge wh-badge--active">${__("Holding")}</span>`;
	return `
		<tr class="wh-row" data-name="${esc(w.name)}" data-holder-type="${esc(w.holder_type)}">
			<td><span class="wh-name">${esc(w.label || w.name)}</span></td>
			<td>${type}</td>
			<td>${w.role ? `<span class="wh-badge wh-badge--role">${esc(w.role)}</span>` : dash}</td>
			<td class="wh-address" title="${esc(w.location || "")}">${isWarehouse ? esc(w.location || dash) : _wh_staff_location_html(page, w)}</td>
			<td>${status}</td>
			<td><b>${w.seals_held || 0}</b></td>
			<td>${isWarehouse
				? `<span class="${w.in_stock === (w.seals_held || 0) ? "" : "wh-stock-diff"}" title="${w.in_stock === (w.seals_held || 0) ? "" : __("Differs from the seals held here")}">${w.in_stock || 0}</span>`
				: dash}</td>
			<td>${esc(w.company || dash)}</td>
			<td>${esc(w.parent_warehouse || dash)}</td>
			<td>${esc(w.region || dash)}</td>
			<td class="wh-address" title="${esc(w.address_line || "")}">${esc(w.address_line || dash)}</td>
		</tr>
	`;
}

function _wh_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.wh_state.total / page.wh_state.page_length));
	page.wh_state.page = Math.min(page.wh_state.page, pages);
	const start = page.wh_state.total
		? (page.wh_state.page - 1) * page.wh_state.page_length + 1
		: 0;
	const end = Math.min(page.wh_state.page * page.wh_state.page_length, page.wh_state.total);
	$(page.body).find(".wh-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.wh_state.total])}</span>
		<div>
			<button class="wh-page-btn" data-page="${page.wh_state.page - 1}" ${page.wh_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.wh_state.page, pages])}</b>
			<button class="wh-page-btn" data-page="${page.wh_state.page + 1}" ${page.wh_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _wh_clear(page) {
	Object.assign(page.wh_state, {
		search: "",
		statuses: [],
		page: 1,
	});
	$(page.body).find(".wh-search").val("");
	_wh_sync_filter_menu(page);
	_wh_load(page);
}

// Ticks, button label and count for the current selection. The filters never
// overlap, so the count is the sum of the ticked ones.
function _wh_sync_filter_menu(page) {
	const selected = page.wh_state.statuses;
	const summary = page.wh_summary || {};
	const $items = $(page.body).find(".wh-filter-item");
	$items.each(function () {
		const status = $(this).data("status");
		$(this).toggleClass("active", status === "All" ? !selected.length : selected.includes(status));
	});
	const labels = selected.map((s) => $items.filter(`[data-status="${s}"]`).data("label"));
	let label = __("All Warehouses");
	if (labels.length === 1) label = labels[0];
	else if (labels.length > 1) label = __("{0} filters", [labels.length]);
	$(page.body).find(".wh-filter-btn-label").text(label).attr("title", labels.join(", "));
	const count = selected.length ? selected.reduce((n, s) => n + (summary[s] || 0), 0) : summary.All || 0;
	$(page.body).find(".wh-filter-btn-count").text(count);
}

function _wh_set_loading(page, show) {
	$(page.body).find(".wh-loading").toggle(show);
}

function _wh_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _wh_inject_styles() {
	if (document.getElementById("warehouse-list-styles")) return;
	const style = document.createElement("style");
	style.id = "warehouse-list-styles";
	style.textContent = `
		.wh-page {
			--wh-blue: #0284c7;
			--wh-dark: #075985;
			--wh-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.wh-header-stats {
			display: flex;
			align-items: center;
			gap: 4px;
			flex: 1;
			flex-wrap: nowrap;
			min-width: 0;
			padding: 0 4px;
			/* One row; scrolls sideways if the header is too narrow, without a bar. */
			overflow-x: auto;
			scrollbar-width: none;
		}
		.wh-header-stats::-webkit-scrollbar { display: none; }
		.wh-header-stats .wh-stat-card {
			display: flex;
			min-height: unset;
			flex: none;
			padding: 4px 8px;
			flex-direction: row;
			align-items: center;
			gap: 6px;
			border-radius: 999px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-top: 1px solid #075985;
			background: var(--card-bg, #fff);
			white-space: nowrap;
		}
		.wh-header-stats .wh-stat--active      { border-top-color: var(--wh-blue); }
		.wh-header-stats .wh-stat--main        { border-top-color: #f59e0b; }
		.wh-header-stats .wh-stat--user        { border-top-color: #7c3aed; }
		.wh-header-stats .wh-stat--customer    { border-top-color: #16a34a; }
		.wh-header-stats .wh-stat--inactive    { border-top-color: #64748b; }
		.wh-header-stats .wh-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.wh-header-stats .wh-stat-value {
			color: var(--wh-ink);
			font-size: 15px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.wh-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.wh-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.wh-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.wh-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.wh-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.wh-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.wh-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.wh-search-inline input:focus {
			outline: none;
			border-color: var(--wh-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.wh-filter-dropdown { position: relative; }
		.wh-filter-btn {
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
		.wh-filter-btn:hover { border-color: var(--wh-blue); }
		.wh-filter-btn-count {
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
		.wh-filter-arrow { color: #94a3b8; font-size: 11px; }
		.wh-filter-menu {
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
		.wh-filter-menu.open { display: block; }
		.wh-filter-item {
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
		.wh-filter-item:hover { background: #f0f9ff; }
		.wh-filter-item.active { background: #e0f2fe; color: var(--wh-blue); }
		.wh-filter-item { gap: 10px; }
		.wh-filter-item-label { flex: 1; }
		.wh-filter-check {
			width: 16px;
			height: 16px;
			flex: none;
			border: 1.5px solid #94a3b8;
			border-radius: 4px;
			background: var(--card-bg, #fff);
		}
		.wh-filter-item.active .wh-filter-check {
			border-color: var(--wh-blue);
			background: var(--wh-blue) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 14px no-repeat;
		}
		.wh-fcount {
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
		.wh-filter-item.active .wh-fcount { background: var(--wh-blue); color: #fff; }

		/* ---- field wrapper ---- */
		.wh-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }

		/* ---- actions ---- */
		.wh-actions { display: flex; gap: 8px; }
		.wh-clear-btn {
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
		.wh-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.wh-table {
			width: 100%;
			min-width: 1100px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.wh-table th,
		.wh-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
			white-space: nowrap; /* one line per row; the table scrolls sideways */
		}
		.wh-table th {
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
		.wh-row { cursor: pointer; }
		.wh-row:hover { background: rgba(224, 242, 254, .7); }
		.wh-row td:first-child { border-left: 3px solid transparent; }
		.wh-row:hover td:first-child { border-left-color: var(--wh-blue); }
		.wh-name { color: var(--wh-blue); font-size: 14px; font-weight: 800; }
		.wh-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.wh-badge--active      { background: #dbeafe; color: #1d4ed8; }
		.wh-badge--main        { background: #fef3c7; color: #b45309; }
		.wh-badge--user        { background: #ede9fe; color: #6d28d9; }
		.wh-badge--role        { background: #e0f2fe; color: #0369a1; }
		.wh-base               { font-weight: 600; }
		.wh-muted              { color: var(--text-muted); font-size: 0.85em; font-weight: 400; }
		.wh-base-edit          { border: 0; background: none; padding: 0 4px; color: var(--text-muted); cursor: pointer; }
		.wh-base-edit:hover    { color: var(--primary); }
		.wh-stock-diff { color: #b45309; font-weight: 700; }
		[data-theme="dark"] .wh-stock-diff { color: #fbbf24; }
		.wh-badge--customer    { background: #dcfce7; color: #15803d; }
		[data-theme="dark"] .wh-badge--user     { background: #2e1065; color: #ddd6fe; }
		[data-theme="dark"] .wh-badge--role     { background: #082f49; color: #bae6fd; }
		[data-theme="dark"] .wh-badge--customer { background: #052e16; color: #bbf7d0; }
		.wh-address { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.wh-badge--inactive    { background: #e2e8f0; color: #475569; }
		.wh-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.wh-empty strong {
			color: var(--wh-ink);
			font-size: 22px;
		}

		/* ---- pagination ---- */
		.wh-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.wh-pagination div { display: flex; align-items: center; gap: 9px; }
		.wh-pagination b { font-weight: 700; }
		.wh-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.wh-page-btn:disabled { cursor: default; opacity: .45; }

		/* ---- loading overlay ---- */
		.wh-loading {
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
		.wh-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--wh-blue);
			border-radius: 50%;
			animation: wh-spin .7s linear infinite;
		}
		@keyframes wh-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .wh-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .wh-panel,
		[data-theme="dark"] .wh-table-panel,
		[data-theme="dark"] .wh-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .wh-search-inline input,
		[data-theme="dark"] .wh-filter-btn,
		[data-theme="dark"] .wh-filter-menu,
		[data-theme="dark"] .wh-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .wh-toolbar,
		[data-theme="dark"] .wh-table th,
		[data-theme="dark"] .wh-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .wh-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .wh-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .wh-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.wh-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.wh-page { padding: 10px 8px 32px; }
			.wh-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
