frappe.pages["current-customer-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Current Customers"),
		single_column: true,
	});

	page.customer_state = {
		search: "",
		status: "All",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Back"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _customer_load(page));
	page.set_primary_action(__("New Customer"), () => frappe.new_doc("Customer"));

	const $statsBar = $('<div class="ccl-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.ccl_stats_bar = $statsBar;

	_customer_inject_styles();
	_customer_build_page(page);
	_customer_load(page);
};

function _customer_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Active", __("Active")],
		["Disabled", __("Disabled")],
	];

	$(page.body).html(`
		<div class="ccl-page">
			<section class="ccl-panel">
				<div class="ccl-toolbar">
					<div class="ccl-toolbar-top">
						<label class="ccl-field ccl-search-inline">
							<input class="ccl-search" type="search" placeholder="${__("Customer, phone or email")}">
						</label>

						<div class="ccl-filter-dropdown">
							<button class="ccl-filter-btn">
								<span class="ccl-filter-btn-label">${__("All Customers")}</span>
								<span class="ccl-filter-btn-count">0</span>
								<span class="ccl-filter-arrow">&#9662;</span>
							</button>
							<div class="ccl-filter-menu">
								<div class="ccl-filter-item active" data-status="All" data-label="${__("All Customers")}">${__("All Customers")} <span class="ccl-fcount" data-fcount="All">0</span></div>
								<div class="ccl-filter-item" data-status="Active" data-label="${__("Active")}">${__("Active")} <span class="ccl-fcount" data-fcount="Active">0</span></div>
								<div class="ccl-filter-item" data-status="Disabled" data-label="${__("Disabled")}">${__("Disabled")} <span class="ccl-fcount" data-fcount="Disabled">0</span></div>
							</div>
						</div>

						<div class="ccl-actions">
							<button class="ccl-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="ccl-table-panel">
				<div class="ccl-table-scroll"><div class="ccl-table-wrap"></div></div>
				<div class="ccl-pagination"></div>
			</section>

			<div class="ccl-loading" style="display:none"><div class="ccl-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _customer_debounce(() => {
		page.customer_state.search = ($(page.body).find(".ccl-search").val() || "").trim();
		page.customer_state.page = 1;
		_customer_load(page);
	}, 300);

	$(page.body).on("input", ".ccl-search", delayedSearch);
	
	$(page.body).on("click", ".ccl-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".ccl-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});
	$(page.body).on("click", ".ccl-filter-item", function () {
		page.customer_state.status = $(this).data("status");
		page.customer_state.page = 1;
		$(page.body).find(".ccl-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".ccl-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".ccl-filter-menu").removeClass("open");
		_customer_load(page);
	});
	$(document).on("click.ccl-dropdown", function () {
		$(page.body).find(".ccl-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".ccl-clear-btn", () => _customer_clear(page));
	$(page.body).on("click", ".ccl-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Customer", name);
	});
	$(page.body).on("click", ".ccl-billing-btn", function (event) {
		event.stopPropagation();
		const customer = $(this).data("customer");
		if (customer) _customer_open_billing_modal(page, customer);
	});
	$(page.body).on("click", ".ccl-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.customer_state.page = Number.parseInt($(this).data("page"), 10);
		_customer_load(page);
	});
}

function _customer_load(page) {
	const requestId = ++page.customer_state.request_id;
	_customer_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.get_current_customer_list",
		args: {
			search: page.customer_state.search,
			status: page.customer_state.status,
			page: page.customer_state.page,
			page_length: page.customer_state.page_length,
		},
		callback(r) {
			if (requestId !== page.customer_state.request_id) return;
			_customer_set_loading(page, false);
			const data = r.message || {};
			page.customer_state.total = data.total || 0;
			_customer_render_stats(page, data.summary || {});
			_customer_render_table(page, data.customers || [], data.empty_message);
			_customer_render_pagination(page);
		},
		error() {
			if (requestId !== page.customer_state.request_id) return;
			_customer_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load customers"), indicator: "red" }, 5);
		},
	});
}

function _customer_render_stats(page, summary) {
	const html = `
		<div class="ccl-stat-card">
			<div class="ccl-stat-label">${__("All Customers")}</div>
			<div class="ccl-stat-value">${summary.All || 0}</div>
		</div>
		<div class="ccl-stat-card ccl-stat--active">
			<div class="ccl-stat-label">${__("Active")}</div>
			<div class="ccl-stat-value">${summary.Active || 0}</div>
		</div>
		<div class="ccl-stat-card ccl-stat--disabled">
			<div class="ccl-stat-label">${__("Disabled")}</div>
			<div class="ccl-stat-value">${summary.Disabled || 0}</div>
		</div>
	`;
	if (page.ccl_stats_bar) {
		page.ccl_stats_bar.html(html);
	}

	// Update dropdown counts
	const countMap = {
		All: summary.All || 0,
		Active: summary.Active || 0,
		Disabled: summary.Disabled || 0,
	};
	$(page.body).find(".ccl-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	const currentCount = countMap[page.customer_state.status] ?? 0;
	$(page.body).find(".ccl-filter-btn-count").text(currentCount);
}

function _customer_render_table(page, customers, emptyMessage) {
	if (!customers.length) {
		$(page.body).find(".ccl-table-wrap").html(`
			<div class="ccl-empty">
				<strong>${__("No customers found")}</strong>
				<span>${frappe.utils.escape_html(emptyMessage || __("Try clearing the filters or add a new customer."))}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".ccl-table-wrap").html(`
		<table class="ccl-table">
			<thead>
				<tr>
					<th>${__("Customer")}</th>
					<th>${__("Billing Type")}</th>
					<th>${__("Phone")}</th>
					<th>${__("Email")}</th>
					<th>${__("Status")}</th>
				</tr>
			</thead>
			<tbody>${customers.map((customer) => _customer_row_html(customer)).join("")}</tbody>
		</table>
	`);
}

function _customer_row_html(customer) {
	const status = customer.disabled ? __("Disabled") : __("Active");
	const statusClass = customer.disabled ? "disabled" : "active";
	return `
		<tr class="ccl-row" data-name="${frappe.utils.escape_html(customer.name)}">
			<td>
				<div class="ccl-name-wrap">
					<span class="ccl-name">${frappe.utils.escape_html(customer.customer_name || customer.name)}</span>
				</div>
			</td>
			<td>${_customer_billing_button_html(customer)}</td>
			<td>${frappe.utils.escape_html(customer.mobile_no || "—")}</td>
			<td>${frappe.utils.escape_html(customer.email_id || "—")}</td>
			<td><span class="ccl-badge ccl-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
		</tr>
	`;
}

function _customer_billing_button_html(customer) {
	const hasRule = !!customer.billing_label;
	const kind = (customer.billing_kind || "").toLowerCase();
	const kindClass = hasRule ? ` ccl-billing-btn--set ccl-billing-btn--${kind}` : "";
	const label = hasRule
		? frappe.utils.escape_html(customer.billing_label)
		: __("Set billing");
	const tag = hasRule && customer.billing_kind
		? `<span class="ccl-billing-tag">${frappe.utils.escape_html(customer.billing_kind)}</span>`
		: "";

	return `
		<button class="ccl-billing-btn${kindClass}" data-customer="${frappe.utils.escape_html(customer.name)}" title="${__("Set billing rule")}">
			${tag}<span class="ccl-billing-btn__label">${label}</span>
		</button>
	`;
}

function _customer_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.customer_state.total / page.customer_state.page_length));
	page.customer_state.page = Math.min(page.customer_state.page, pages);
	const start = page.customer_state.total
		? (page.customer_state.page - 1) * page.customer_state.page_length + 1
		: 0;
	const end = Math.min(page.customer_state.page * page.customer_state.page_length, page.customer_state.total);
	$(page.body).find(".ccl-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.customer_state.total])}</span>
		<div>
			<button class="ccl-page-btn" data-page="${page.customer_state.page - 1}" ${page.customer_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.customer_state.page, pages])}</b>
			<button class="ccl-page-btn" data-page="${page.customer_state.page + 1}" ${page.customer_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _customer_clear(page) {
	page.customer_state.search = "";
	page.customer_state.status = "All";
	page.customer_state.page = 1;
	$(page.body).find(".ccl-search").val("");
	$(page.body).find(".ccl-filter-item").removeClass("active");
	$(page.body).find('.ccl-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".ccl-filter-btn-label").text(__("All Customers"));
	_customer_load(page);
}

// Standard day counts per fixed contract period. The amounts are always
// set per rule, never derived from the period.
const CCL_PERIOD_DAYS = {
	Weekly: 7,
	Monthly: 30,
	Quarterly: 90,
	"Semi-Annually": 180,
	Annually: 365,
};

// Inclusive whole-day span between two date strings: Jun 1 -> Jun 10 = 10.
function _ccl_inclusive_day_span(from_date, to_date) {
	if (!from_date || !to_date) return 0;
	const a = frappe.datetime.str_to_obj(from_date);
	const b = frappe.datetime.str_to_obj(to_date);
	if (!a || !b || b < a) return 0;
	return Math.round((b - a) / 86400000) + 1;
}

function _customer_open_billing_modal(page, customer) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.get_customer_billing",
		args: { customer },
		freeze: true,
		callback(r) {
			if (!r.message) return;
			_customer_show_billing_dialog(page, r.message);
		},
		error() {
			frappe.show_alert({ message: __("Could not load billing details"), indicator: "red" }, 5);
		},
	});
}

function _customer_show_billing_dialog(page, data) {
	const cur = data.current || {};

	const dialog = new frappe.ui.Dialog({
		title: __("Set Billing — {0}", [data.customer_name]),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "billing_type",
				label: __("Billing Type"),
				options: ["Default", "Special"],
				reqd: 1,
				default: cur.billing_type || "Default",
				description: __("Default uses a shared rate card. Special defines a contract just for this customer."),
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Link",
				fieldname: "default_rule",
				label: __("Default Billing Rule"),
				options: "Seal Billing Rate",
				depends_on: "eval:doc.billing_type=='Default'",
				mandatory_depends_on: "eval:doc.billing_type=='Default'",
				default: cur.default_rule || null,
				get_query: () => ({ filters: { billing_type: "Default", active: 1 } }),
			},
			{
				fieldtype: "Section Break",
				label: __("Contract Rules"),
				depends_on: "eval:doc.billing_type=='Special'",
			},
			{
				fieldtype: "Select",
				fieldname: "billing_period_type",
				label: __("Billing Period Type"),
				options: ["Weekly", "Monthly", "Quarterly", "Semi-Annually", "Annually", "Date Range"],
				depends_on: "eval:doc.billing_type=='Special'",
				default: cur.billing_period_type || "Monthly",
			},
			{
				fieldtype: "Date",
				fieldname: "period_from_date",
				label: __("Period From Date"),
				depends_on: "eval:doc.billing_type=='Special' && doc.billing_period_type=='Date Range'",
				mandatory_depends_on: "eval:doc.billing_type=='Special' && doc.billing_period_type=='Date Range'",
				default: cur.period_from_date || null,
			},
			{
				fieldtype: "Date",
				fieldname: "period_to_date",
				label: __("Period To Date"),
				depends_on: "eval:doc.billing_type=='Special' && doc.billing_period_type=='Date Range'",
				mandatory_depends_on: "eval:doc.billing_type=='Special' && doc.billing_period_type=='Date Range'",
				default: cur.period_to_date || null,
			},
			{
				fieldtype: "Int",
				fieldname: "first_period_days",
				label: __("First Period Days"),
				depends_on: "eval:doc.billing_type=='Special'",
				default: cur.first_period_days || 30,
				read_only: 1,
				description: __("Auto-set from the billing period type. Editable when the period type is Date Range."),
			},
			{ fieldtype: "Column Break", depends_on: "eval:doc.billing_type=='Special'" },
			{
				fieldtype: "Currency",
				fieldname: "first_period_amount",
				label: __("First Period Amount"),
				depends_on: "eval:doc.billing_type=='Special'",
				default: cur.first_period_amount || 0,
			},
			{
				fieldtype: "Currency",
				fieldname: "extra_day_rate",
				label: __("Extra Day Rate (per day)"),
				depends_on: "eval:doc.billing_type=='Special'",
				default: cur.extra_day_rate || 0,
			},
			{ fieldtype: "Data", fieldname: "currency", hidden: 1, default: cur.currency || "KES" },
		],
		primary_action_label: __("Save Billing"),
		primary_action(values) {
			_customer_submit_billing(page, data.customer, values, dialog);
		},
	});

	let lastAutoDays = null;
	const applyPeriodLock = () => {
		if (dialog.get_value("billing_type") !== "Special") return;
		const period = dialog.get_value("billing_period_type");

		if (period === "Date Range") {
			dialog.set_df_property("first_period_days", "read_only", 0);
			const days = _ccl_inclusive_day_span(
				dialog.get_value("period_from_date"),
				dialog.get_value("period_to_date")
			);
			const current = dialog.get_value("first_period_days");
			// Only auto-fill if the user hasn't manually overridden the value.
			if (days && (!current || current === lastAutoDays)) {
				dialog.set_value("first_period_days", days);
				lastAutoDays = days;
			}
			return;
		}

		dialog.set_df_property("first_period_days", "read_only", 1);
		const mapped = CCL_PERIOD_DAYS[period];
		if (mapped) {
			dialog.set_value("first_period_days", mapped);
			lastAutoDays = mapped;
		}
	};
	dialog.fields_dict.billing_period_type.df.onchange = applyPeriodLock;
	dialog.fields_dict.billing_type.df.onchange = applyPeriodLock;
	dialog.fields_dict.period_from_date.df.onchange = applyPeriodLock;
	dialog.fields_dict.period_to_date.df.onchange = applyPeriodLock;

	dialog.show();
	applyPeriodLock();
}

function _customer_submit_billing(page, customer, values, dialog) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_type: values.billing_type,
			default_rule: values.default_rule || null,
			billing_period_type: values.billing_period_type || null,
			first_period_days: values.first_period_days || null,
			first_period_amount: values.first_period_amount || 0,
			extra_day_rate: values.extra_day_rate || 0,
			period_from_date: values.period_from_date || null,
			period_to_date: values.period_to_date || null,
			currency: values.currency || "KES",
		},
		freeze: true,
		freeze_message: __("Saving billing…"),
		callback(r) {
			dialog.hide();
			const name = (r.message && r.message.billing_rule_name) || "";
			frappe.show_alert({
				message: name
					? __("Billing set to {0}", [name])
					: __("Billing updated"),
				indicator: "green",
			});
			_customer_load(page);
		},
		error() {
			frappe.show_alert({ message: __("Could not save billing"), indicator: "red" }, 5);
		},
	});
}

function _customer_set_loading(page, show) {
	$(page.body).find(".ccl-loading").toggle(show);
}

function _customer_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _customer_inject_styles() {
	if (document.getElementById("current-customer-list-styles")) return;
	const style = document.createElement("style");
	style.id = "current-customer-list-styles";
	style.textContent = `
		.ccl-page {
			--ccl-blue: #0284c7;
			max-width: 1300px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			font-family: var(--font-stack);
			position: relative;
		}

		/* ---- header stats bar (injected into Frappe page-head) ---- */
		.ccl-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.ccl-header-stats .ccl-stat-card {
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
		.ccl-header-stats .ccl-stat--active { border-top-color: #16a34a; }
		.ccl-header-stats .ccl-stat--disabled { border-top-color: #dc2626; }
		.ccl-header-stats .ccl-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.ccl-header-stats .ccl-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		.ccl-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.ccl-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.ccl-table-scroll {
			overflow-x: auto;
			overflow-y: auto;
			max-height: calc(100vh - 200px);
		}
		.ccl-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: #f0f9ff;
		}
		.ccl-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.ccl-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.ccl-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.ccl-search-inline input:focus {
			outline: none;
			border-color: var(--ccl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.ccl-filter-dropdown {
			position: relative;
		}
		.ccl-filter-btn {
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
		.ccl-filter-btn:hover { border-color: var(--ccl-blue); }
		.ccl-filter-btn-count {
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
		.ccl-filter-arrow {
			color: #94a3b8;
			font-size: 11px;
		}
		.ccl-filter-menu {
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
		.ccl-filter-menu.open { display: block; }
		.ccl-filter-item {
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
		.ccl-filter-item:hover { background: #f0f9ff; }
		.ccl-filter-item.active {
			background: #e0f2fe;
			color: var(--ccl-blue);
		}
		.ccl-fcount {
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
		.ccl-filter-item.active .ccl-fcount {
			background: var(--ccl-blue);
			color: #fff;
		}

		.ccl-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.ccl-actions {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.ccl-clear-btn {
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
		.ccl-clear-btn:hover {
			background: #f8fafc;
			border-color: #94a3b8;
		}
		.ccl-billing-btn {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			min-width: 150px;
			max-width: 280px;
			min-height: 38px;
			padding: 7px 14px;
			border: 1px dashed #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			text-align: left;
		}
		.ccl-billing-btn:hover {
			border-color: var(--ccl-blue);
			background: #f0f9ff;
		}
		.ccl-billing-btn__label {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.ccl-billing-btn--set {
			border-style: solid;
			color: #0c4a6e;
		}
		.ccl-billing-tag {
			flex-shrink: 0;
			padding: 2px 8px;
			border-radius: 999px;
			font-size: 10px;
			font-weight: 800;
			letter-spacing: .04em;
			text-transform: uppercase;
		}
		.ccl-billing-btn--default .ccl-billing-tag {
			background: #dbeafe;
			color: #1d4ed8;
		}
		.ccl-billing-btn--special {
			border-color: #f59e0b;
			background: #fffbeb;
		}
		.ccl-billing-btn--special .ccl-billing-tag {
			background: #fef3c7;
			color: #92400e;
		}
		.ccl-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			padding-bottom: 1px;
		}
		.ccl-table-scroll {
			max-height: 600px;
			overflow: auto;
			border-bottom: 1px solid #e0f2fe;
		}
		.ccl-table {
			width: 100%;
			min-width: 1080px;
			border-collapse: collapse;
		}
		.ccl-table th,
		.ccl-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			white-space: nowrap;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.ccl-table th {
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
		.ccl-row {
			cursor: pointer;
		}
		.ccl-row:hover {
			background: rgba(224, 242, 254, .7);
		}
		.ccl-name-wrap {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		.ccl-name {
			color: var(--ccl-blue);
			font-size: 16px;
			font-weight: 800;
		}
		.ccl-name-wrap small {
			color: #64748b;
		}
		.ccl-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.ccl-badge--active {
			background: #dbeafe;
			color: #1d4ed8;
		}
		.ccl-badge--disabled {
			background: #e2e8f0;
			color: #475569;
		}
		.ccl-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: #f0f9ff;
			color: #075985;
			font-size: 14px;
		}
		.ccl-pagination > div {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.ccl-page-btn {
			padding: 8px 16px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			transition: all .2s ease;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.ccl-page-btn:not([disabled]):hover {
			background: #f0f9ff;
			border-color: var(--ccl-blue);
			color: var(--ccl-blue);
			transform: translateY(-1px);
			box-shadow: 0 4px 6px rgba(14, 165, 233, .1);
		}
		.ccl-page-btn:not([disabled]):active {
			transform: translateY(0);
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.ccl-page-btn[disabled] {
			opacity: .6;
			cursor: not-allowed;
			background: #f8fafc;
			border-color: #e2e8f0;
			color: #94a3b8;
			box-shadow: none;
		}
		.ccl-empty {
			display: grid;
			place-items: center;
			gap: 10px;
			min-height: 240px;
			padding: 40px 18px;
			color: #64748b;
			text-align: center;
		}
		.ccl-empty strong {
			color: #0c4a6e;
			font-size: 20px;
		}
		.ccl-loading {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			background: rgba(240, 249, 255, .56);
			border-radius: 24px;
			backdrop-filter: blur(2px);
		}
		.ccl-spinner {
			width: 46px;
			height: 46px;
			border: 4px solid rgba(2, 132, 199, .15);
			border-top-color: var(--ccl-blue);
			border-radius: 50%;
			animation: ccl-spin .8s linear infinite;
		}
		@keyframes ccl-spin {
			to { transform: rotate(360deg); }
		}
		[data-theme="dark"] .ccl-toolbar,
		[data-theme="dark"] .ccl-pagination,
		[data-theme="dark"] .ccl-stat--all,
		[data-theme="dark"] .ccl-stat--disabled {
			background: rgba(14, 116, 144, .18);
		}
		[data-theme="dark"] .ccl-table th {
			background: #1e293b;
			background-image: linear-gradient(rgba(14, 116, 144, .18), rgba(14, 116, 144, .18));
		}
		[data-theme="dark"] .ccl-row:hover {
			background: rgba(14, 116, 144, .16);
		}
		@media (max-width: 1100px) {
			.ccl-toolbar-top {
				flex-direction: column;
				align-items: stretch;
			}
		}
		@media (max-width: 720px) {
			.ccl-page {
				padding: 20px 12px 36px;
			}
			.ccl-actions,
			.ccl-pagination {
				flex-direction: column;
				align-items: stretch;
			}
			.ccl-pagination > div {
				justify-content: space-between;
			}
			.ccl-billing-btn {
				min-width: 100%;
				max-width: 100%;
			}
		}
	`;
	document.head.appendChild(style);
}
