frappe.pages["seal-billing-rate-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Seal Billing Rates"),
		single_column: true,
	});

	page.sbr_state = {
		search: "",
		billing_type: "All",
		active: "All",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _sbr_load(page));
	page.set_primary_action(__("New Billing Rate"), () => frappe.new_doc("Seal Billing Rate"));

	const $statsBar = $('<div class="sbr-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.sbr_stats_bar = $statsBar;

	_sbr_inject_styles();
	_sbr_build_page(page);
	_sbr_load(page);
};

function _sbr_build_page(page) {
	const typeStatuses = [
		["All", __("All Rates")],
		["Default", __("Default")],
		["Special", __("Special")],
	];

	const activeStatuses = [
		["All", __("All")],
		["Active", __("Active")],
		["Inactive", __("Inactive")],
	];

	$(page.body).html(`
		<div class="sbr-page">
			<section class="sbr-panel">
				<div class="sbr-toolbar">
					<div class="sbr-toolbar-top">
						<label class="sbr-field sbr-search-inline">
							<input class="sbr-search" type="search" placeholder="${__("Rule name, type, period or currency")}">
						</label>

						<div class="sbr-filter-dropdown">
							<button class="sbr-filter-btn" data-filter="type">
								<span class="sbr-filter-btn-label">${__("All Rates")}</span>
								<span class="sbr-filter-btn-count">0</span>
								<span class="sbr-filter-arrow">&#9662;</span>
							</button>
							<div class="sbr-filter-menu" data-menu="type">
								${typeStatuses.map(([val, lbl]) => `
									<div class="sbr-filter-item ${val === "All" ? "active" : ""}" data-filter="type" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="sbr-fcount" data-fcount-type="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<div class="sbr-filter-dropdown">
							<button class="sbr-filter-btn" data-filter="active">
								<span class="sbr-active-btn-label">${__("All")}</span>
								<span class="sbr-active-btn-count">0</span>
								<span class="sbr-filter-arrow">&#9662;</span>
							</button>
							<div class="sbr-filter-menu" data-menu="active">
								${activeStatuses.map(([val, lbl]) => `
									<div class="sbr-filter-item ${val === "All" ? "active" : ""}" data-filter="active" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="sbr-fcount" data-fcount-active="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<div class="sbr-actions">
							<button class="sbr-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="sbr-table-panel">
				<div class="sbr-table-scroll"><div class="sbr-table-wrap"></div></div>
				<div class="sbr-pagination"></div>
			</section>

			<div class="sbr-loading" style="display:none"><div class="sbr-spinner"></div></div>
		</div>
	`);

	// ---- search ----
	const delayedSearch = _sbr_debounce(() => {
		page.sbr_state.search = ($(page.body).find(".sbr-search").val() || "").trim();
		page.sbr_state.page = 1;
		_sbr_load(page);
	}, 350);
	$(page.body).on("input", ".sbr-search", delayedSearch);

	// ---- filter dropdowns ----
	$(page.body).on("click", ".sbr-filter-btn", function (e) {
		e.stopPropagation();
		const filter = $(this).data("filter");
		const $menu = $(page.body).find(`.sbr-filter-menu[data-menu="${filter}"]`);
		// close others
		$(page.body).find(".sbr-filter-menu.open").not($menu).removeClass("open");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".sbr-filter-item", function () {
		const filter = $(this).data("filter");
		const val = $(this).data("status");
		const lbl = $(this).data("label");

		$(page.body).find(`.sbr-filter-item[data-filter="${filter}"]`).removeClass("active");
		$(this).addClass("active");
		$(page.body).find(`.sbr-filter-menu[data-menu="${filter}"]`).removeClass("open");
		page.sbr_state.page = 1;

		if (filter === "type") {
			page.sbr_state.billing_type = val;
			$(page.body).find(".sbr-filter-btn-label").text(lbl);
		} else {
			page.sbr_state.active = val;
			$(page.body).find(".sbr-active-btn-label").text(lbl);
		}
		_sbr_load(page);
	});

	$(document).on("click.sbr-dropdown", function () {
		$(page.body).find(".sbr-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".sbr-clear-btn", () => _sbr_clear(page));

	$(page.body).on("click", ".sbr-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Billing Rate", name);
	});

	$(page.body).on("click", ".sbr-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.sbr_state.page = Number.parseInt($(this).data("page"), 10);
		_sbr_load(page);
	});
}

function _sbr_load(page) {
	const requestId = ++page.sbr_state.request_id;
	_sbr_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_billing_rate_list.get_billing_rate_list",
		args: {
			search: page.sbr_state.search,
			billing_type: page.sbr_state.billing_type,
			active: page.sbr_state.active,
			page: page.sbr_state.page,
			page_length: page.sbr_state.page_length,
		},
		callback(r) {
			if (requestId !== page.sbr_state.request_id) return;
			_sbr_set_loading(page, false);
			const data = r.message || {};
			page.sbr_state.total = data.total || 0;
			_sbr_render_stats(page, data.summary || {});
			_sbr_render_table(page, data.rates || []);
			_sbr_render_pagination(page);
		},
		error() {
			if (requestId !== page.sbr_state.request_id) return;
			_sbr_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load billing rates"), indicator: "red" }, 5);
		},
	});
}

function _sbr_render_stats(page, summary) {
	const html = `
		<div class="sbr-stat-card">
			<div class="sbr-stat-label">${__("All")}</div>
			<div class="sbr-stat-value">${summary.All || 0}</div>
		</div>
		<div class="sbr-stat-card sbr-stat--default">
			<div class="sbr-stat-label">${__("Default")}</div>
			<div class="sbr-stat-value">${summary.Default || 0}</div>
		</div>
		<div class="sbr-stat-card sbr-stat--special">
			<div class="sbr-stat-label">${__("Special")}</div>
			<div class="sbr-stat-value">${summary.Special || 0}</div>
		</div>
		<div class="sbr-stat-card sbr-stat--active">
			<div class="sbr-stat-label">${__("Active")}</div>
			<div class="sbr-stat-value">${summary.Active || 0}</div>
		</div>
		<div class="sbr-stat-card sbr-stat--inactive">
			<div class="sbr-stat-label">${__("Inactive")}</div>
			<div class="sbr-stat-value">${summary.Inactive || 0}</div>
		</div>
	`;
	if (page.sbr_stats_bar) {
		page.sbr_stats_bar.html(html);
	}

	// update dropdown item counts
	const typeMap = { "All": summary.All || 0, "Default": summary.Default || 0, "Special": summary.Special || 0 };
	const activeMap = { "All": summary.All || 0, "Active": summary.Active || 0, "Inactive": summary.Inactive || 0 };

	$(page.body).find("[data-fcount-type]").each(function () {
		$(this).text(typeMap[$(this).data("fcountType")] ?? 0);
	});
	$(page.body).find("[data-fcount-active]").each(function () {
		$(this).text(activeMap[$(this).data("fcountActive")] ?? 0);
	});

	$(page.body).find(".sbr-filter-btn-count").text(typeMap[page.sbr_state.billing_type] ?? 0);
	$(page.body).find(".sbr-active-btn-count").text(activeMap[page.sbr_state.active] ?? 0);
}

function _sbr_render_table(page, rates) {
	if (!rates.length) {
		$(page.body).find(".sbr-table-wrap").html(`
			<div class="sbr-empty">
				<strong>${__("No billing rates found")}</strong>
				<span>${__("Create a new billing rate or clear the filters to see more records.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".sbr-table-wrap").html(`
		<table class="sbr-table">
			<thead><tr>
				<th>${__("Rule Name")}</th>
				<th>${__("Billing Type")}</th>
				<th>${__("Period Type")}</th>
				<th>${__("First Period Days")}</th>
				<th>${__("First Period Amount")}</th>
				<th>${__("Extra Day Rate")}</th>
				<th>${__("Currency")}</th>
				<th>${__("Effective From")}</th>
				<th>${__("Effective To")}</th>
				<th>${__("Status")}</th>
			</tr></thead>
			<tbody>${rates.map(_sbr_row_html).join("")}</tbody>
		</table>
	`);
}

function _sbr_row_html(rate) {
	const isActive = cint(rate.active);
	const isGlobal = cint(rate.is_global_default);
	const typeClass = (rate.billing_type || "default").toLowerCase();
	const firstAmt = rate.first_period_amount
		? frappe.format(rate.first_period_amount, { fieldtype: "Currency" })
		: "—";
	const extraRate = rate.extra_day_rate
		? frappe.format(rate.extra_day_rate, { fieldtype: "Currency" })
		: "—";
	const effFrom = rate.effective_from
		? frappe.datetime.str_to_user(rate.effective_from)
		: "—";
	const effTo = rate.effective_to
		? frappe.datetime.str_to_user(rate.effective_to)
		: "—";

	return `
		<tr class="sbr-row" data-name="${frappe.utils.escape_html(rate.name)}">
			<td>
				<div class="sbr-cell-primary">${frappe.utils.escape_html(rate.billing_rule_name || rate.name)}${isGlobal ? ` <span class="sbr-global-badge">${__("Global Default")}</span>` : ""}</div>
			</td>
			<td><span class="sbr-type-badge sbr-type--${typeClass}">${frappe.utils.escape_html(rate.billing_type || "—")}</span></td>
			<td>${frappe.utils.escape_html(rate.billing_period_type || "—")}</td>
			<td>${frappe.utils.escape_html(String(rate.first_period_days || "—"))}</td>
			<td>${firstAmt}</td>
			<td>${extraRate}</td>
			<td>${frappe.utils.escape_html(rate.currency || "—")}</td>
			<td>${frappe.utils.escape_html(effFrom)}</td>
			<td>${frappe.utils.escape_html(effTo)}</td>
			<td><span class="sbr-badge sbr-badge--${isActive ? "active" : "inactive"}">${isActive ? __("Active") : __("Inactive")}</span></td>
		</tr>
	`;
}

function cint(v) {
	return parseInt(v || 0, 10);
}

function _sbr_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.sbr_state.total / page.sbr_state.page_length));
	page.sbr_state.page = Math.min(page.sbr_state.page, pages);
	const start = page.sbr_state.total
		? (page.sbr_state.page - 1) * page.sbr_state.page_length + 1
		: 0;
	const end = Math.min(page.sbr_state.page * page.sbr_state.page_length, page.sbr_state.total);
	$(page.body).find(".sbr-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.sbr_state.total])}</span>
		<div>
			<button class="sbr-page-btn" data-page="${page.sbr_state.page - 1}" ${page.sbr_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.sbr_state.page, pages])}</b>
			<button class="sbr-page-btn" data-page="${page.sbr_state.page + 1}" ${page.sbr_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _sbr_clear(page) {
	Object.assign(page.sbr_state, {
		search: "",
		billing_type: "All",
		active: "All",
		page: 1,
	});
	$(page.body).find(".sbr-search").val("");
	$(page.body).find(".sbr-filter-item").removeClass("active");
	$(page.body).find('.sbr-filter-item[data-filter="type"][data-status="All"]').addClass("active");
	$(page.body).find('.sbr-filter-item[data-filter="active"][data-status="All"]').addClass("active");
	$(page.body).find(".sbr-filter-btn-label").text(__("All Rates"));
	$(page.body).find(".sbr-active-btn-label").text(__("All"));
	_sbr_load(page);
}

function _sbr_set_loading(page, show) {
	$(page.body).find(".sbr-loading").toggle(show);
}

function _sbr_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _sbr_inject_styles() {
	if (document.getElementById("seal-billing-rate-list-styles")) return;
	const style = document.createElement("style");
	style.id = "seal-billing-rate-list-styles";
	style.textContent = `
		.sbr-page {
			--sbr-blue: #0284c7;
			--sbr-dark: #075985;
			--sbr-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.sbr-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.sbr-header-stats .sbr-stat-card {
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
		.sbr-header-stats .sbr-stat--default  { border-top-color: var(--sbr-blue); }
		.sbr-header-stats .sbr-stat--special   { border-top-color: #7c3aed; }
		.sbr-header-stats .sbr-stat--active    { border-top-color: #16a34a; }
		.sbr-header-stats .sbr-stat--inactive  { border-top-color: #64748b; }
		.sbr-header-stats .sbr-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.sbr-header-stats .sbr-stat-value {
			color: var(--sbr-ink);
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.sbr-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.sbr-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.sbr-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.sbr-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.sbr-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.sbr-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.sbr-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.sbr-search-inline input:focus {
			outline: none;
			border-color: var(--sbr-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdowns ---- */
		.sbr-filter-dropdown { position: relative; }
		.sbr-filter-btn {
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
		.sbr-filter-btn:hover { border-color: var(--sbr-blue); }
		.sbr-filter-btn-count,
		.sbr-active-btn-count {
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
		.sbr-filter-arrow { color: #94a3b8; font-size: 11px; }
		.sbr-filter-menu {
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
		.sbr-filter-menu.open { display: block; }
		.sbr-filter-item {
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
		.sbr-filter-item:hover { background: #f0f9ff; }
		.sbr-filter-item.active { background: #e0f2fe; color: var(--sbr-blue); }
		.sbr-fcount {
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
		.sbr-filter-item.active .sbr-fcount { background: var(--sbr-blue); color: #fff; }

		/* ---- field wrapper ---- */
		.sbr-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }

		/* ---- actions ---- */
		.sbr-actions { display: flex; gap: 8px; }
		.sbr-clear-btn {
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
		.sbr-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.sbr-table {
			width: 100%;
			min-width: 1400px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.sbr-table th,
		.sbr-table td {
			padding: 14px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.sbr-table th {
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
		.sbr-row { cursor: pointer; }
		.sbr-row:hover { background: rgba(224, 242, 254, .7); }
		.sbr-row td:first-child { border-left: 3px solid transparent; }
		.sbr-row:hover td:first-child { border-left-color: var(--sbr-blue); }
		.sbr-cell-primary {
			color: var(--sbr-ink);
			font-size: 14px;
			font-weight: 700;
			margin-bottom: 3px;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.sbr-cell-secondary {
			color: #64748b;
			font-size: 12px;
		}
		.sbr-global-badge {
			display: inline-flex;
			align-items: center;
			padding: 2px 7px;
			border-radius: 999px;
			background: #fef3c7;
			color: #92400e;
			font-size: 10px;
			font-weight: 800;
			letter-spacing: .03em;
			text-transform: uppercase;
		}
		.sbr-type-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 4px 10px;
			font-size: 11px;
			font-weight: 800;
			white-space: nowrap;
		}
		.sbr-type--default { background: #dbeafe; color: #1d4ed8; }
		.sbr-type--special { background: #ede9fe; color: #6d28d9; }
		.sbr-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 5px 10px;
			font-size: 11px;
			font-weight: 800;
			white-space: nowrap;
		}
		.sbr-badge--active   { background: #dcfce7; color: #166534; }
		.sbr-badge--inactive { background: #e2e8f0; color: #475569; }
		.sbr-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.sbr-empty strong {
			color: var(--sbr-ink);
			font-size: 22px;
		}

		/* ---- pagination ---- */
		.sbr-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.sbr-pagination div { display: flex; align-items: center; gap: 9px; }
		.sbr-pagination b { font-weight: 700; }
		.sbr-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.sbr-page-btn:disabled { cursor: default; opacity: .45; }

		/* ---- loading overlay ---- */
		.sbr-loading {
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
		.sbr-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--sbr-blue);
			border-radius: 50%;
			animation: sbr-spin .7s linear infinite;
		}
		@keyframes sbr-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .sbr-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .sbr-panel,
		[data-theme="dark"] .sbr-table-panel,
		[data-theme="dark"] .sbr-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .sbr-search-inline input,
		[data-theme="dark"] .sbr-filter-btn,
		[data-theme="dark"] .sbr-filter-menu,
		[data-theme="dark"] .sbr-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .sbr-toolbar,
		[data-theme="dark"] .sbr-table th,
		[data-theme="dark"] .sbr-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .sbr-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .sbr-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .sbr-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.sbr-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.sbr-page { padding: 10px 8px 32px; }
			.sbr-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
