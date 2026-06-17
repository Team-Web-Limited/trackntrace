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
		billing_rates: [],
		changed_billing_types: {},
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.customer_save_button = page.add_inner_button(__("Save"), () => _customer_save_billing_types(page));
	_customer_toggle_save_button(page);
	page.set_primary_action(__("New Customer"), () => frappe.new_doc("Customer"));

	_customer_inject_styles();
	_customer_build_page(page);
	_customer_load(page);
};

function _customer_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Active", __("Active")],
	];

	$(page.body).html(`
		<div class="ccl-page">
			<section class="ccl-stats"></section>
			<section class="ccl-panel">
				<div class="ccl-toolbar">
					<div class="ccl-toolbar-row">
						<div class="ccl-status-filters">
							${statuses.map(([value, label]) => `
								<button class="ccl-status-btn ${value === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(value)}">
									${frappe.utils.escape_html(label)}
								</button>
							`).join("")}
						</div>
						<div class="ccl-filter-grid">
							<label class="ccl-field">
								<input class="ccl-search" type="search" placeholder="${__("Customer, phone or email")}">
							</label>
							<div class="ccl-actions">
								<button class="ccl-clear-btn">${__("Clear filters")}</button>
								<button class="ccl-refresh-btn">${__("Refresh")}</button>
							</div>
						</div>
					</div>
				</div>
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
	$(page.body).on("click", ".ccl-status-btn", function () {
		$(page.body).find(".ccl-status-btn").removeClass("active");
		$(this).addClass("active");
		page.customer_state.status = $(this).data("status");
		page.customer_state.page = 1;
		_customer_load(page);
	});
	$(page.body).on("click", ".ccl-refresh-btn", () => _customer_load(page));
	$(page.body).on("click", ".ccl-clear-btn", () => _customer_clear(page));
	$(page.body).on("click", ".ccl-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Customer", name);
	});
	$(page.body).on("click", ".ccl-billing-select", (event) => event.stopPropagation());
	$(page.body).on("change", ".ccl-billing-select", function (event) {
		event.stopPropagation();
		const customer = $(this).data("customer");
		const original = $(this).data("original") || "";
		const billingType = $(this).val() || "";

		if (billingType === original) {
			delete page.customer_state.changed_billing_types[customer];
			$(this).removeClass("is-dirty");
		} else {
			page.customer_state.changed_billing_types[customer] = billingType;
			$(this).addClass("is-dirty");
		}
		_customer_toggle_save_button(page);
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
			page.customer_state.billing_rates = data.billing_rates || [];
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
	const stats = [
		[__("All Customers"), summary.All || 0, "all"],
		[__("Active"), summary.Active || 0, "active"],
	];
	$(page.body).find(".ccl-stats").html(
		stats.map(([label, value, variant]) => `
			<div class="ccl-stat ccl-stat--${variant}">
				<span>${frappe.utils.escape_html(label)}</span>
				<strong>${value}</strong>
			</div>
		`).join("")
	);
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
			<tbody>${customers.map((customer) => (
				_customer_row_html(customer, page.customer_state.billing_rates)
			)).join("")}</tbody>
		</table>
	`);
}

function _customer_row_html(customer, billingRates) {
	const status = customer.disabled ? __("Disabled") : __("Active");
	const statusClass = customer.disabled ? "disabled" : "active";
	const billingType = customer.billing_type || "";
	return `
		<tr class="ccl-row" data-name="${frappe.utils.escape_html(customer.name)}">
			<td>
				<div class="ccl-name-wrap">
					<span class="ccl-name">${frappe.utils.escape_html(customer.customer_name || customer.name)}</span>
					<small>${frappe.utils.escape_html(customer.name)}</small>
				</div>
			</td>
			<td>${_customer_billing_select_html(customer.name, billingType, billingRates)}</td>
			<td>${frappe.utils.escape_html(customer.mobile_no || "—")}</td>
			<td>${frappe.utils.escape_html(customer.email_id || "—")}</td>
			<td><span class="ccl-badge ccl-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
		</tr>
	`;
}

function _customer_billing_select_html(customerName, billingType, billingRates) {
	const currentBillingType = frappe.utils.escape_html(billingType || "");
	const options = [
		`<option value="">${__("Select billing type")}</option>`,
		...(billingRates || []).map((rate) => {
			const value = frappe.utils.escape_html(rate.name || "");
			const label = frappe.utils.escape_html(rate.billing_rule_name || rate.name || "");
			const selected = (rate.name || "") === billingType ? "selected" : "";
			return `<option value="${value}" ${selected}>${label}</option>`;
		}),
	];

	return `
		<select
			class="ccl-billing-select"
			data-customer="${frappe.utils.escape_html(customerName)}"
			data-original="${currentBillingType}"
		>
			${options.join("")}
		</select>
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
	Object.assign(page.customer_state, {
		search: "",
		status: "All",
		page: 1,
	});
	$(page.body).find(".ccl-search").val("");
	$(page.body).find(".ccl-status-btn").removeClass("active");
	$(page.body).find('.ccl-status-btn[data-status="All"]').addClass("active");
	_customer_load(page);
}

function _customer_save_billing_types(page) {
	const changes = page.customer_state.changed_billing_types || {};
	const updates = Object.entries(changes).map(([customer, billing_type]) => ({
		customer,
		billing_type,
	}));

	if (!updates.length) return;

	_customer_toggle_save_button(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.save_customer_billing_types",
		args: { updates },
		callback(r) {
			const saved = (r.message && r.message.saved) || 0;
			page.customer_state.changed_billing_types = {};
			frappe.show_alert({
				message: __("Saved billing type for {0} customer(s)", [saved]),
				indicator: "green",
			});
			_customer_load(page);
			_customer_toggle_save_button(page);
		},
		error() {
			_customer_toggle_save_button(page);
			frappe.show_alert({ message: __("Could not save billing types"), indicator: "red" }, 5);
		},
	});
}

function _customer_toggle_save_button(page, saving = false) {
	if (!page.customer_save_button) return;
	const hasChanges = Object.keys(page.customer_state.changed_billing_types || {}).length > 0;
	page.customer_save_button
		.prop("disabled", saving || !hasChanges)
		.toggleClass("disabled", saving || !hasChanges)
		.text(saving ? __("Saving...") : __("Save"));
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
			max-width: 1520px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}
		.ccl-stats {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 18px;
			margin-bottom: 18px;
		}
		.ccl-stat {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			min-height: 86px;
			padding: 18px 20px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-top: 4px solid #38bdf8;
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.ccl-stat--all,
		.ccl-stat--disabled {
			background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
			border-color: #bae6fd;
		}
		.ccl-stat--all { border-top-color: #075985; }
		.ccl-stat--active { border-top-color: var(--ccl-blue); }
		.ccl-stat--disabled { border-top-color: #64748b; }
		.ccl-stat span {
			max-width: 130px;
			color: #0369a1;
			font-size: 12px;
			font-weight: 800;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.ccl-stat strong {
			color: #0c4a6e;
			font-size: 34px;
			line-height: 1;
		}
		.ccl-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.ccl-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: #f0f9ff;
		}
		.ccl-toolbar-row {
			display: grid;
			grid-template-columns: auto minmax(560px, 1fr);
			gap: 18px;
			align-items: end;
		}
		.ccl-status-filters {
			display: flex;
			gap: 8px;
			overflow-x: auto;
		}
		.ccl-status-btn,
		.ccl-clear-btn,
		.ccl-refresh-btn,
		.ccl-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: #075985;
			padding: 9px 15px;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.ccl-status-btn.active,
		.ccl-refresh-btn {
			border-color: var(--ccl-blue);
			background: var(--ccl-blue);
			color: #fff;
		}
		.ccl-filter-grid {
			display: grid;
			grid-template-columns: minmax(420px, 1fr) auto;
			gap: 12px;
			align-items: end;
		}
		.ccl-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.ccl-field input {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.ccl-billing-select {
			min-width: 190px;
			max-width: 260px;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			padding: 9px 12px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
			font-weight: 600;
		}
		.ccl-billing-select.is-dirty {
			border-color: #f59e0b;
			background: #fffbeb;
		}
		.ccl-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			padding-bottom: 1px;
		}
		.ccl-table-scroll {
			overflow-x: auto;
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
		.ccl-page-btn[disabled] {
			opacity: .45;
			cursor: not-allowed;
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
		[data-theme="dark"] .ccl-table th,
		[data-theme="dark"] .ccl-stat--all,
		[data-theme="dark"] .ccl-stat--disabled {
			background: rgba(14, 116, 144, .18);
		}
		[data-theme="dark"] .ccl-row:hover {
			background: rgba(14, 116, 144, .16);
		}
		@media (max-width: 1100px) {
			.ccl-toolbar-row {
				grid-template-columns: 1fr;
			}
			.ccl-status-filters {
				margin-bottom: 10px;
			}
			.ccl-filter-grid,
			.ccl-stats {
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}
		}
		@media (max-width: 720px) {
			.ccl-page {
				padding: 20px 12px 36px;
			}
			.ccl-stats,
			.ccl-filter-grid {
				grid-template-columns: 1fr;
			}
			.ccl-actions,
			.ccl-pagination {
				flex-direction: column;
				align-items: stretch;
			}
			.ccl-pagination > div {
				justify-content: space-between;
			}
			.ccl-billing-select {
				min-width: 100%;
				max-width: 100%;
			}
		}
	`;
	document.head.appendChild(style);
}
