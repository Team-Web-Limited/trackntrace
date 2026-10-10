// Maps Billing Period Type (Seal Billing Rate's own vocabulary) to the
// billing_interval values the recurring seat-fee Subscription understands
// (see INTERVAL_MAP in api/seal_lease_billing.py). Frequencies not listed
// here (Custom) bill every First Period Days instead — see
// _cb_seat_fee_interval.
const CB_BILLING_PERIOD_TO_LEASE_INTERVAL = {
	Weekly: "Week",
	"Bi-Weekly": "Bi-Weekly",
	Monthly: "Month",
	Quarterly: "Quarter",
	"Semi-Annually": "Semi-Annual",
	Annually: "Year",
};

// Day count each standard Frequency fixes First Period Days to — mirrors
// PERIOD_TYPE_DAYS in doctype/seal_billing_rate/seal_billing_rate.py.
// Custom isn't listed: First Period Days is typed in instead.
const CB_FREQUENCY_PERIOD_DAYS = {
	Weekly: 7,
	"Bi-Weekly": 14,
	Monthly: 30,
	Quarterly: 90,
	"Semi-Annually": 180,
	Annually: 365,
};
const CB_FREQUENCY_OPTIONS = ["Weekly", "Bi-Weekly", "Monthly", "Quarterly", "Semi-Annually", "Annually", "Custom"];

// A saved Frequency outside the dropdown (the retired "Days" option, Date
// Range, or free text from when this field was an Autocomplete) is shown as
// Custom, keeping the rule's own First Period Days.
function _cb_normalize_frequency(value) {
	if (!value) return "Monthly";
	return CB_FREQUENCY_OPTIONS.includes(value) ? value : "Custom";
}

// Frequency to show for a saved rule's terms. A standard Frequency whose day
// count disagrees with the rule's saved First Period Days is shown as Custom
// instead, so opening the modal never silently rewrites the saved days —
// e.g. a Leasing rule saved before Leasing had a Frequency carries the
// doctype's "Monthly" default alongside whatever days were typed in.
function _cb_frequency_for_terms(terms) {
	const frequency = _cb_normalize_frequency(terms.billing_period_type);
	const mapped = CB_FREQUENCY_PERIOD_DAYS[frequency];
	const savedDays = cint(terms.first_period_days);
	return mapped && savedDays && savedDays !== mapped ? "Custom" : frequency;
}


frappe.pages["customer-billing"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Customer Billing"),
		single_column: true,
	});

	page.cb_state = { view: "customers", search: "", status: "All", billing_type: "All", page: 1, page_length: 25, total: 0, request_id: 0 };

	page.add_inner_button(__("Back"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () =>
		page.cb_state.view === "journeys" ? _cjv_load(page) : _cb_load(page)
	);

	const $statsBar = $(`
		<div class="cbl-header-stats cbl-tabs">
			<button class="cbl-tab active" data-view="customers">${__("Customers")}</button>
			<button class="cbl-tab" data-view="journeys">${__("Completed Journeys")}</button>
		</div>
	`);
	$(wrapper).find(".page-head .page-actions").before($statsBar);
	page.cbl_stats_bar = $statsBar;
	const $cjStats = $('<div class="cj-header-stats cbl-cj-stats"></div>');
	$statsBar.on("click", ".cbl-tab", function () {
		const view = $(this).data("view");
		if (view === page.cb_state.view) return;
		page.cb_state.view = view;
		page.cb_state.page = 1;
		$statsBar.find(".cbl-tab").removeClass("active");
		$(this).addClass("active");
		const journeys = view === "journeys";
		$(page.body).find(".cbl-page").toggle(!journeys);
		$(page.body).find(".cj-page").toggle(journeys);
		if (journeys) page.show_form();
		else page.hide_form();
		$(page.wrapper).find(".page-actions .btn-primary").toggle(!journeys);
		if (journeys) _cjv_load(page);
		else _cb_load(page);
	});

	_cb_inject_styles();
	_cb_build_page(page);
	_cjv_init(page, $cjStats);
	_cb_load(page);
};

function _cb_build_page(page) {
	$(page.body).append(`
		<div class="cbl-page">
			<section class="cbl-panel">
				<div class="cbl-toolbar">
					<div class="cbl-toolbar-top">
						<label class="cbl-field cbl-search-inline">
							<input class="cbl-search" type="search" placeholder="${__("Customer, phone or email")}">
						</label>

						<div class="cbl-filter-dropdown">
							<button class="cbl-filter-btn">
								<span class="cbl-filter-btn-label">${__("All Customers")}</span>
								<span class="cbl-filter-btn-count">0</span>
								<span class="cbl-filter-arrow">&#9662;</span>
							</button>
							<div class="cbl-filter-menu">
								<div class="cbl-filter-item active" data-status="All" data-label="${__("All Customers")}">${__("All Customers")} <span class="cbl-fcount" data-fcount="All">0</span></div>
								<div class="cbl-filter-item" data-status="Active" data-label="${__("Active")}">${__("Active")} <span class="cbl-fcount" data-fcount="Active">0</span></div>
								<div class="cbl-filter-item" data-status="Disabled" data-label="${__("Disabled")}">${__("Disabled")} <span class="cbl-fcount" data-fcount="Disabled">0</span></div>
							</div>
						</div>

						<div class="cbl-filter-dropdown">
							<button class="cbl-filter-btn" data-filter="type">
								<span class="cbl-type-btn-label">${__("All Rates")}</span>
								<span class="cbl-type-btn-count">0</span>
								<span class="cbl-filter-arrow">&#9662;</span>
							</button>
							<div class="cbl-filter-menu" data-menu="type">
								<div class="cbl-filter-item cbl-type-item active" data-type="All" data-label="${__("All Rates")}">${__("All Rates")} <span class="cbl-fcount" data-fcount-type="All">0</span></div>
								<div class="cbl-filter-item cbl-type-item" data-type="Subscription" data-label="${__("Subscription")}">${__("Subscription")} <span class="cbl-fcount" data-fcount-type="Subscription">0</span></div>
								<div class="cbl-filter-item cbl-type-item" data-type="Leasing" data-label="${__("Leasing")}">${__("Leasing")} <span class="cbl-fcount" data-fcount-type="Leasing">0</span></div>
							</div>
						</div>

						<div class="cbl-actions">
							<button class="cbl-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="cbl-table-panel">
				<div class="cbl-table-scroll"><div class="cbl-table-wrap"></div></div>
				<div class="cbl-pagination"></div>
			</section>

			<div class="cbl-loading" style="display:none"><div class="cbl-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _cb_debounce(() => {
		page.cb_state.search = ($(page.body).find(".cbl-search").val() || "").trim();
		page.cb_state.page = 1;
		_cb_load(page);
	}, 300);

	$(page.body).on("input", ".cbl-search", delayedSearch);
	// Each dropdown (status / rate type) opens and selects independently.
	$(page.body).on("click", ".cbl-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(this).siblings(".cbl-filter-menu");
		$(page.body).find(".cbl-filter-menu").not($menu).removeClass("open");
		if (!$menu.hasClass("open")) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});
	$(page.body).on("click", ".cbl-filter-item", function () {
		const $menu = $(this).closest(".cbl-filter-menu");
		const $btn = $menu.siblings(".cbl-filter-btn");
		if ($(this).hasClass("cbl-type-item")) {
			page.cb_state.billing_type = $(this).data("type");
			$btn.find(".cbl-type-btn-label").text($(this).data("label"));
		} else {
			page.cb_state.status = $(this).data("status");
			$btn.find(".cbl-filter-btn-label").text($(this).data("label"));
		}
		page.cb_state.page = 1;
		$menu.find(".cbl-filter-item").removeClass("active");
		$(this).addClass("active");
		$menu.removeClass("open");
		_cb_load(page);
	});
	$(document).on("click.cbl-dropdown", () => $(page.body).find(".cbl-filter-menu").removeClass("open"));

	$(page.body).on("click", ".cbl-clear-btn", () => {
		page.cb_state.search = "";
		page.cb_state.status = "All";
		page.cb_state.billing_type = "All";
		page.cb_state.page = 1;
		$(page.body).find(".cbl-search").val("");
		$(page.body).find(".cbl-filter-item").removeClass("active");
		$(page.body).find('.cbl-filter-item[data-status="All"], .cbl-filter-item[data-type="All"]').addClass("active");
		$(page.body).find(".cbl-filter-btn-label").text(__("All Customers"));
		$(page.body).find(".cbl-type-btn-label").text(__("All Rates"));
		_cb_load(page);
	});
	$(page.body).on("click", ".cbl-journey-row", function () {
		frappe.set_route("Form", "Seal Journey", $(this).data("journey"));
	});
	$(page.body).on("click", ".cbl-row:not(.cbl-journey-row)", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Customer", name);
	});
	$(page.body).on("click", ".cbl-activate-btn", function (event) {
		event.stopPropagation();
		if ($(this).prop("disabled")) return;
		_cb_open_activate_dialog(page, $(this).data("name"), $(this).closest(".cbl-row").find(".cbl-name").text());
	});
	$(page.body).on("click", ".cbl-billing-btn", function (event) {
		event.stopPropagation();
		const customer = $(this).data("customer");
		if (customer) _cb_open_billing_modal(page, customer);
	});
	$(page.body).on("click", ".cbl-portal-access-btn", function (event) {
		event.stopPropagation();
		const customer = $(this).data("customer");
		if (!customer) return;
		frappe.confirm(__("Grant portal access to {0}?", [frappe.utils.escape_html(customer)]), () =>
			_cb_grant_portal_access(page, customer)
		);
	});
	$(page.body).on("click", ".cbl-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.cb_state.page = Number.parseInt($(this).data("page"), 10);
		_cb_load(page);
	});
}

function _cb_load(page) {
	const requestId = ++page.cb_state.request_id;
	$(page.body).find(".cbl-loading").show();
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.get_current_customer_list",
		args: {
			search: page.cb_state.search,
			status: page.cb_state.status,
			billing_type: page.cb_state.billing_type,
			page: page.cb_state.page,
			page_length: page.cb_state.page_length,
		},
		callback(r) {
			if (requestId !== page.cb_state.request_id) return;
			$(page.body).find(".cbl-loading").hide();
			const data = r.message || {};
			const perms = data.permissions || {};
			page.cb_state.can_grant_portal_access = !!perms.can_grant_portal_access;
			page.cb_state.can_edit_billing = !!perms.can_edit_billing;
			page.cb_state.can_approve_billing = !!perms.can_approve_billing;
			_cb_apply_permissions(page, !!perms.can_create_customer);
			page.cb_state.total = data.total || 0;
			_cb_render_counts(page, data.summary || {});
			_cb_render_table(page, data.customers || [], data.empty_message);
			_cb_render_pagination(page);
		},
		error() {
			if (requestId !== page.cb_state.request_id) return;
			$(page.body).find(".cbl-loading").hide();
			frappe.show_alert({ message: __("Could not load customers"), indicator: "red" }, 5);
		},
	});
}

function _cb_apply_permissions(page, canCreate) {
	if (canCreate) {
		// New customers start in the ECTS Division so they show up here.
		page.set_primary_action(__("New Customer"), () => frappe.new_doc("Customer", { custom_division: "ECTS Division" }));
	} else {
		$(page.wrapper).find(".page-actions .btn-primary").remove();
	}
}

function _cb_render_counts(page, summary) {
	const countMap = { All: summary.All || 0, Active: summary.Active || 0, Disabled: summary.Disabled || 0 };
	$(page.body).find(".cbl-fcount").each(function () {
		$(this).text(countMap[$(this).data("fcount")] ?? 0);
	});
	$(page.body).find(".cbl-filter-btn-count").text(countMap[page.cb_state.status] ?? 0);

	const typeMap = {
		All: summary.RatesAll || 0,
		Subscription: summary.Subscription || 0,
		Leasing: summary.Leasing || 0,
	};
	$(page.body).find("[data-fcount-type]").each(function () {
		$(this).text(typeMap[$(this).data("fcountType")] ?? 0);
	});
	$(page.body).find(".cbl-type-btn-count").text(typeMap[page.cb_state.billing_type] ?? 0);
}

function _cb_render_table(page, customers, emptyMessage) {
	if (!customers.length) {
		$(page.body).find(".cbl-table-wrap").html(`
			<div class="cbl-empty">
				<strong>${__("No customers found")}</strong>
				<span>${frappe.utils.escape_html(emptyMessage || __("Try clearing the filters."))}</span>
			</div>
		`);
		return;
	}

	const rows = customers
		.map((c) => {
			return `
				<tr class="cbl-row" data-name="${frappe.utils.escape_html(c.name)}">
					<td><div class="cbl-name-wrap"><span class="cbl-name">${frappe.utils.escape_html(c.customer_name || c.name)}</span></div></td>
					<td>${_cb_billing_html(page, c)}</td>
					<td>${_cb_money_html(c, c.first_period_amount)}</td>
					<td>${_cb_money_html(c, c.extra_day_rate)}</td>
					<td>${_cb_status_cell_html(page, c)}</td>
					<td>${_cb_portal_html(page, c)}</td>
				</tr>
			`;
		})
		.join("");

	$(page.body).find(".cbl-table-wrap").html(`
		<table class="cbl-table">
			<thead>
				<tr>
					<th>${__("Customer")}</th>
					<th>${__("Billing Type")}</th>
					<th>${__("First Period Amount")}</th>
					<th>${__("Extra Day Rate")}</th>
					<th>${__("Status")}</th>
					<th>${__("Portal Access")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`);
}

// Rate of the customer's primary (Local) billing rule, formatted in its own currency.
function _cb_money_html(c, value) {
	if (!value) return "—";
	return frappe.format(value, { fieldtype: "Currency", options: "currency" }, null, c);
}

function _cb_billing_html(page, customer) {
	const hasRule = !!customer.billing_label;
	const kind = (customer.billing_kind || "").toLowerCase();
	const kindClass = hasRule ? ` cbl-billing-btn--set cbl-billing-btn--${kind}` : "";
	// Show just the type (Leasing / Subscription); the rule's full name is in the tooltip.
	const label = hasRule
		? frappe.utils.escape_html(customer.billing_kind || customer.billing_label)
		: __("Set billing");
	const fullName = frappe.utils.escape_html(customer.billing_label || "");
	const tag = "";

	if (!page.cb_state.can_edit_billing) {
		return `
			<span class="cbl-billing-btn cbl-billing-readonly" title="${fullName || __("Billing rule")}">
				${tag}<span class="cbl-billing-btn__label">${label}</span>
			</span>
		`;
	}

	return `
		<button class="cbl-billing-btn${kindClass}" data-customer="${frappe.utils.escape_html(customer.name)}" title="${fullName ? fullName + " — " : ""}${__("Set billing rule")}">
			${tag}<span class="cbl-billing-btn__label">${label}</span>
		</button>
	`;
}


// One button per customer for its billing rule's approval: "Activate" while
// the rule is Pending Approval (approving it also re-enables the customer —
// see seal_billing_rate.approve_seal_billing_rate), otherwise a disabled
// button showing the settled state.
function _cb_status_cell_html(page, c) {
	const esc = frappe.utils.escape_html;
	if (!c.billing_rule) return "—";

	const approval = c.approval_status || "Pending Approval";
	if (approval === "Pending Approval") {
		// Only approvers (Managing Director) can act; everyone else, e.g. Finance,
		// just sees that the rule is waiting.
		if (!page.cb_state.can_approve_billing) {
			return `<button class="cbl-activate-btn cbl-activate-btn--pending" disabled title="${__("Waiting for Managing Director approval")}">${__("Pending Approval")}</button>`;
		}
		return `<button class="cbl-activate-btn" data-name="${esc(c.billing_rule)}">${__("Activate")}</button>`;
	}
	const cls = approval === "Rejected" ? "cbl-activate-btn--rejected" : "cbl-activate-btn--approved";
	return `<button class="cbl-activate-btn ${cls}" disabled>${esc(__(approval))}</button>`;
}

// Activate: Managing Director reviews the customer's pending billing rule and
// approves (which also re-enables the customer) or rejects it, with a reason.
function _cb_open_activate_dialog(page, name, customer) {
	const dialog = new frappe.ui.Dialog({
		title: __("Activate {0}", [frappe.utils.escape_html(customer || name)]),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "intro",
				options: `<p class="text-muted">${__("Approve or reject this customer's billing rule. Approving activates the customer.")}</p>`,
			},
			{
				fieldtype: "Small Text",
				fieldname: "remarks",
				label: __("Reason"),
				description: __("Required when rejecting."),
			},
		],
		primary_action_label: __("Approve"),
		primary_action(values) {
			_cb_set_rule_approval(page, dialog, "approve", name, values.remarks);
		},
		secondary_action_label: __("Reject"),
		secondary_action() {
			const remarks = (dialog.get_value("remarks") || "").trim();
			if (!remarks) {
				frappe.msgprint(__("Please give a reason for rejecting."));
				return;
			}
			_cb_set_rule_approval(page, dialog, "reject", name, remarks);
		},
	});
	dialog.get_secondary_btn().removeClass("btn-default").addClass("btn-danger");
	dialog.show();
}

function _cb_set_rule_approval(page, dialog, action, name, remarks) {
	const approve = action === "approve";
	frappe.call({
		method: `tnt_seal_management.tnt_seal_management.doctype.seal_billing_rate.seal_billing_rate.${approve ? "approve" : "reject"}_seal_billing_rate`,
		args: { name, remarks: (remarks || "").trim() || null },
		freeze: true,
		freeze_message: approve ? __("Approving…") : __("Rejecting…"),
		callback() {
			dialog.hide();
			frappe.show_alert({
				message: approve ? __("Customer activated") : __("Billing rule rejected"),
				indicator: approve ? "green" : "orange",
			});
			_cb_load(page);
		},
		error() {
			frappe.show_alert({ message: approve ? __("Could not approve") : __("Could not reject"), indicator: "red" }, 5);
		},
	});
}

function _cb_portal_html(page, c) {
	if (!page.cb_state.can_grant_portal_access) return "—";
	return `<button class="cbl-portal-access-btn" data-customer="${frappe.utils.escape_html(c.name)}">${__("Grant Portal Access")}</button>`;
}

function _cb_grant_portal_access(page, customer, contactDetails) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.grant_customer_portal_access",
		args: Object.assign({ customer }, contactDetails || {}),
		freeze: true,
		freeze_message: __("Granting portal access…"),
		callback(r) {
			const result = r.message || {};
			if (result.status === "needs_contact_details") {
				_cb_prompt_contact_details(page, customer);
				return;
			}
			frappe.show_alert({ message: result.message, indicator: "green" }, 7);
		},
		error() {
			frappe.show_alert({ message: __("Could not grant portal access"), indicator: "red" }, 5);
		},
	});
}

function _cb_prompt_contact_details(page, customer) {
	const dialog = new frappe.ui.Dialog({
		title: __("New Contact for Portal Access"),
		fields: [
			{
				fieldtype: "Data",
				fieldname: "first_name",
				label: __("First Name"),
				reqd: 1,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Data",
				fieldname: "last_name",
				label: __("Last Name"),
			},
			{
				fieldtype: "Data",
				fieldname: "email",
				label: __("Email"),
				options: "Email",
				reqd: 1,
			},
		],
		primary_action_label: __("Grant Access"),
		primary_action(values) {
			dialog.hide();
			_cb_grant_portal_access(page, customer, values);
		},
	});
	dialog.show();
}
function _cb_render_pagination(page) {
	const s = page.cb_state;
	const pages = Math.max(1, Math.ceil(s.total / s.page_length));
	s.page = Math.min(s.page, pages);
	const start = s.total ? (s.page - 1) * s.page_length + 1 : 0;
	const end = Math.min(s.page * s.page_length, s.total);
	$(page.body).find(".cbl-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, s.total])}</span>
		<div>
			<button class="cbl-page-btn" data-page="${s.page - 1}" ${s.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [s.page, pages])}</b>
			<button class="cbl-page-btn" data-page="${s.page + 1}" ${s.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _cb_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _cb_inject_styles() {
	if (document.getElementById("customer-billing-styles")) return;
	const style = document.createElement("style");
	style.id = "customer-billing-styles";
	style.textContent = `
		.cbl-tabs { gap: 8px; }
		.cbl-activate-btn {
			min-width: 96px;
			padding: 6px 14px;
			border: 1px solid #16a34a;
			border-radius: 8px;
			background: #16a34a;
			color: #fff;
			font-size: 12px;
			font-weight: 700;
			cursor: pointer;
			white-space: nowrap;
		}
		.cbl-activate-btn:not([disabled]):hover { background: #15803d; border-color: #15803d; }
		.cbl-activate-btn[disabled] { cursor: not-allowed; opacity: .6; }
		.cbl-activate-btn--approved[disabled] { background: #dcfce7; border-color: #bbf7d0; color: #166534; opacity: 1; }
		.cbl-activate-btn--pending[disabled] { background: #fef3c7; border-color: #fde68a; color: #92400e; opacity: 1; }
		.cbl-activate-btn--rejected[disabled] { background: #fee2e2; border-color: #fecaca; color: #991b1b; opacity: 1; }
		.cbl-cj-form:not(.hide) {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px 0;
		}
		.cbl-cj-form > .frappe-control {
			flex: 0 0 150px;
			max-width: 150px;
		}
		.cbl-cj-form > .frappe-control[data-fieldname="customer"] {
			flex-basis: 200px;
			max-width: 200px;
		}
		.cbl-cj-form > .clearfix { display: none; }
		.cbl-cj-form .cbl-cj-stats {
			flex: 1 1 auto;
			min-width: 0;
			margin-left: auto;
			padding: 0 15px;
			justify-content: flex-end;
		}
		@media (min-width: 992px) {
			.cbl-cj-form:not(.hide) { flex-wrap: nowrap; }
		}
		.cbl-tab {
			flex-shrink: 0;
			padding: 7px 18px;
			border: 1px solid rgba(14, 165, 233, .3);
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-weight: 700;
			font-size: 13px;
			white-space: nowrap;
			cursor: pointer;
		}
		.cbl-tab:hover { background: #f0f9ff; }
		.cbl-tab.active { background: #0284c7; border-color: #0284c7; color: #fff; }
		.cbl-page {
			--cbl-blue: #0284c7;
			max-width: 1300px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			font-family: var(--font-stack);
			position: relative;
		}

		/* ---- header stats bar (injected into Frappe page-head) ---- */
		.cbl-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.cbl-header-stats .cbl-stat-card {
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
		.cbl-header-stats .cbl-stat--active { border-top-color: #16a34a; }
		.cbl-header-stats .cbl-stat--disabled { border-top-color: #dc2626; }
		.cbl-header-stats .cbl-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.cbl-header-stats .cbl-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		.cbl-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.cbl-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.cbl-table-scroll {
			overflow-x: auto;
			overflow-y: auto;
			max-height: calc(100vh - 200px);
		}
		.cbl-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: #f0f9ff;
		}
		.cbl-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.cbl-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.cbl-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.cbl-search-inline input:focus {
			outline: none;
			border-color: var(--cbl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.cbl-filter-dropdown {
			position: relative;
		}
		.cbl-filter-btn {
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
		.cbl-filter-btn:hover { border-color: var(--cbl-blue); }
		.cbl-filter-btn-count {
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
		.cbl-filter-arrow {
			color: #94a3b8;
			font-size: 11px;
		}
		.cbl-filter-menu {
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
		.cbl-filter-menu.open { display: block; }
		.cbl-filter-item {
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
		.cbl-filter-item:hover { background: #f0f9ff; }
		.cbl-filter-item.active {
			background: #e0f2fe;
			color: var(--cbl-blue);
		}
		.cbl-fcount {
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
		.cbl-filter-item.active .cbl-fcount {
			background: var(--cbl-blue);
			color: #fff;
		}

		.cbl-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.cbl-actions {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.cbl-clear-btn {
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
		.cbl-clear-btn:hover {
			background: #f8fafc;
			border-color: #94a3b8;
		}




		.cbl-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			padding-bottom: 1px;
		}
		.cbl-table-scroll {
			max-height: 780px;
			overflow: auto;
			border-bottom: 1px solid #e0f2fe;
		}
		.cbl-table {
			width: 100%;
			min-width: 1080px;
			border-collapse: collapse;
		}
		.cbl-table th,
		.cbl-table td {
			padding: 22px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			white-space: nowrap;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.cbl-table th {
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
		.cbl-row {
			cursor: pointer;
		}
		.cbl-row:hover {
			background: rgba(224, 242, 254, .7);
		}
		.cbl-name-wrap {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		.cbl-name {
			color: var(--cbl-blue);
			font-size: 16px;
			font-weight: 800;
		}
		.cbl-name-wrap small {
			color: #64748b;
		}
		.cbl-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.cbl-badge--active {
			background: #dbeafe;
			color: #1d4ed8;
		}
		.cbl-badge--disabled {
			background: #e2e8f0;
			color: #475569;
		}
		.cbl-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: #f0f9ff;
			color: #075985;
			font-size: 14px;
		}
		.cbl-pagination > div {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.cbl-page-btn {
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
		.cbl-page-btn:not([disabled]):hover {
			background: #f0f9ff;
			border-color: var(--cbl-blue);
			color: var(--cbl-blue);
			transform: translateY(-1px);
			box-shadow: 0 4px 6px rgba(14, 165, 233, .1);
		}
		.cbl-page-btn:not([disabled]):active {
			transform: translateY(0);
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.cbl-page-btn[disabled] {
			opacity: .6;
			cursor: not-allowed;
			background: #f8fafc;
			border-color: #e2e8f0;
			color: #94a3b8;
			box-shadow: none;
		}
		.cbl-empty {
			display: grid;
			place-items: center;
			gap: 10px;
			min-height: 240px;
			padding: 40px 18px;
			color: #64748b;
			text-align: center;
		}
		.cbl-empty strong {
			color: #0c4a6e;
			font-size: 20px;
		}
		.cbl-loading {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			background: rgba(240, 249, 255, .56);
			border-radius: 24px;
			backdrop-filter: blur(2px);
		}
		.cbl-spinner {
			width: 46px;
			height: 46px;
			border: 4px solid rgba(2, 132, 199, .15);
			border-top-color: var(--cbl-blue);
			border-radius: 50%;
			animation: cbl-spin .8s linear infinite;
		}
		@keyframes cbl-spin {
			to { transform: rotate(360deg); }
		}
		[data-theme="dark"] .cbl-toolbar,
		[data-theme="dark"] .cbl-pagination,
		[data-theme="dark"] .cbl-stat--all,
		[data-theme="dark"] .cbl-stat--disabled {
			background: rgba(14, 116, 144, .18);
		}
		[data-theme="dark"] .cbl-table th {
			background: #1e293b;
			background-image: linear-gradient(rgba(14, 116, 144, .18), rgba(14, 116, 144, .18));
		}
		[data-theme="dark"] .cbl-row:hover {
			background: rgba(14, 116, 144, .16);
		}
		@media (max-width: 1100px) {
			.cbl-toolbar-top {
				flex-direction: column;
				align-items: stretch;
			}
		}
		@media (max-width: 720px) {
			.cbl-page {
				padding: 20px 12px 36px;
			}
			.cbl-actions,
			.cbl-pagination {
				flex-direction: column;
				align-items: stretch;
			}
			.cbl-pagination > div {
				justify-content: space-between;
			}
		}

		.cbl-billing-btn {
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
		.cbl-billing-btn:hover {
			transform: translateY(-1px);
		}

		.cbl-portal-access-btn {
			display: inline-flex;
			align-items: center;
			min-height: 38px;
			padding: 7px 14px;
			border: 1px dashed #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			white-space: nowrap;
		}
		.cbl-portal-access-btn:hover {
			border-color: var(--cbl-blue);
			background: #f0f9ff;
		}

		.cbl-billing-readonly {
			cursor: default;
		}

		.cbl-billing-readonly:hover {
			border-color: var(--cbl-blue);
			background: #f0f9ff;
		}
		.cbl-billing-btn__label {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.cbl-billing-btn--set {
			border-style: solid;
			color: #0c4a6e;
		}
		.cbl-billing-tag {
			flex-shrink: 0;
			padding: 2px 8px;
			border-radius: 999px;
			font-size: 10px;
			font-weight: 800;
			letter-spacing: .04em;
			text-transform: uppercase;
		}
		.cbl-billing-btn--default .cbl-billing-tag {
			background: #dbeafe;
			color: #1d4ed8;
		}
		.cbl-billing-btn--special {
			border-color: #f59e0b;
			background: #fffbeb;
		}

		.cbl-billing-btn--special .cbl-billing-tag {
			background: #fef3c7;
			color: #92400e;
		}

		.cbl-tax-radio-group {
			display: flex;
			flex-wrap: wrap;
			gap: 16px;
			padding: 4px 0 8px;
		}
		.cbl-tax-radio {
			display: flex;
			align-items: center;
			gap: 6px;
			font-weight: 500;
			cursor: pointer;
		}
		.cbl-tax-radio input[type="radio"] {
			margin: 0;
			cursor: pointer;
		}
		.cbl-page-nav {
			display: flex;
			gap: 4px;
			border-bottom: 1px solid var(--border-color, #d1d8dd);
			margin-bottom: 16px;
		}
		.cbl-page-nav-btn {
			background: none;
			border: none;
			border-bottom: 2px solid transparent;
			padding: 8px 4px;
			margin-right: 20px;
			font-weight: 500;
			color: var(--text-muted, #8d99a6);
			cursor: pointer;
		}
		.cbl-page-nav-btn.active {
			color: var(--cbl-blue, #0284c7);
			border-bottom-color: var(--cbl-blue, #0284c7);
		}
		.cbl-recurring-loading {
			padding: 24px 0;
			text-align: center;
			color: var(--text-muted, #8d99a6);
		}
	`;
	document.head.appendChild(style);
}


function _cb_open_billing_modal(page, customer) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.get_customer_billing",
		args: { customer },
		freeze: true,
		callback(r) {
			if (!r.message) return;
			_cb_show_billing_dialog(page, r.message);
		},
		error() {
			frappe.show_alert({ message: __("Could not load billing details"), indicator: "red" }, 5);
		},
	});
}

function _cb_show_billing_dialog(page, data) {
	const cur = data.current || {};

	// Neither billing type picks from a shared list anymore — both are
	// private, per-customer contracts entered directly below and saved as the
	// customer's own auto-named rule ("<Customer> BR").
	const initialType = cur.billing_type || "Subscription";
	const currentLeasingTerms = cur.billing_type === "Leasing" ? cur.rule || {} : {};
	const currentSubscriptionTerms = cur.billing_type === "Subscription" ? cur.rule || {} : {};

	// --- Per-journey-type rates -------------------------------------------
	// Rates differ by the kind of seal journey being billed. Import and Export
	// are priced identically, so the three Journey Type options collapse onto
	// two stored rate sets ("buckets") — switching Import <-> Export therefore
	// keeps the same rates, while switching to/from Local swaps them.
	// Mirrors JOURNEY_TYPE_BUCKET in api/current_customers.py.
	const JT_LOCAL = "Local";
	const JT_IMPORT_EXPORT = "Import/Export";
	// The stored "Import/Export" rate set is shown to users as "International".
	const JT_BUCKET = { Local: JT_LOCAL, International: JT_IMPORT_EXPORT, Import: JT_IMPORT_EXPORT, Export: JT_IMPORT_EXPORT };
	// Only the rate *amounts* vary per journey type. Currency and Frequency are
	// contract-level and deliberately carry across a switch untouched.
	const JT_RATE_FIELDS = [
		"first_period_days",
		"first_period_amount",
		"extra_day_rate",
		"owned_rate_per_seal",
		"lease_rate_per_seal",
	];

	const rulesByBucket = data.rules_by_journey_type || {};
	const snapshotRule = (rule) => {
		if (!rule) return null;
		const snap = {};
		JT_RATE_FIELDS.forEach((f) => {
			snap[f] = rule[f] ?? null;
		});
		return snap;
	};
	// Seeded from the server, then kept up to date as the user edits — so
	// switching away and back within one dialog session restores what was typed
	// rather than re-reading stale server values. A null entry means "no rate
	// set stored yet", which is what makes the fields blank out so a new one
	// can be entered.
	const journeyRateCache = {
		[JT_LOCAL]: snapshotRule(rulesByBucket[JT_LOCAL]),
		[JT_IMPORT_EXPORT]: snapshotRule(rulesByBucket[JT_IMPORT_EXPORT]),
	};
	let activeJourneyBucket = JT_LOCAL;

	// Tax treatment for this customer — drives VAT on Completed Journeys and
	// elsewhere. Rendered as radio buttons (Set Billing modal spec), not a
	// Select, since there are only three mutually-exclusive options.
	const TAX_RADIO_NAME = "ccl_tax_category";
	const taxCategoryOptions = [
		{ value: "Normal Tax (16% VAT)", label: __("Normal Tax (16% VAT)") },
		{ value: "Tax Exempt", label: __("Tax Exempt") },
		{ value: "Zero Rated", label: __("Zero Rated") },
	];
	const currentTaxCategory = data.tax_category || "Normal Tax (16% VAT)";

	// Computation (Simple/Compound) — see the computation_html field def
	// below for what each means. Radio buttons for the same reason as Tax:
	// two mutually-exclusive options.
	const COMPUTATION_RADIO_NAME = "ccl_computation";
	const computationOptions = [
		{ value: "Simple", label: __("Simple") },
		{ value: "Compound", label: __("Compound") },
	];
	const currentComputationMethod = (cur.rule || {}).computation_method || "Simple";

	// Frappe's "Tab Break" fieldtype (frappe/public/js/frappe/form/tab.js)
	// requires a real frm/doctype to build its DOM id — a plain frappe.ui.Dialog
	// has neither, and crashes (`frappe.scrub(undefined)`). So "Billing" vs
	// "Recurring Fees" is a hand-rolled two-pill nav instead: each pill just
	// toggles the `hidden` flag on that page's named sections and re-runs
	// ``dialog.refresh_sections()`` to fold/unfold them — the same primitive
	// the existing lease/ownership reveal already relied on.
	const BILLING_PAGE_SECTIONS = [
		"billing_section_1",
		"seal_ownership_section",
		"tax_section",
		"rate_terms_section",
		"customer_period_section",
	];
	const RECURRING_PAGE_SECTIONS = [
		"extra_billing_section",
		"extra_rate_terms_section",
		"extra_cb_period_section",
	];

	const dialog = new frappe.ui.Dialog({
		title: __("Set Billing — {0}", [data.customer_name]),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "tab_nav_html",
			},

			{
				fieldtype: "Section Break",
				fieldname: "billing_section_1",
				hide_border: 1,
			},
			{
				fieldtype: "Select",
				fieldname: "billing_type",
				label: __("Billing Type"),
				options: cur.outright_purchase ? ["Subscription"] : ["Subscription", "Leasing"],
				reqd: 1,
				default: initialType,
			},
			{ fieldtype: "Column Break" },
			{
				// Both billing types. Flat Rate: one fixed Rate per journey
				// (per seal), whatever its length — no Extra Day Rate, no
				// Computation. Non-Flat Rate: day-tiered — a Subscription bills
				// First Period Amount per started period, a Leasing rule First
				// Period Amount + Extra Day Rate per extra day (Simple) or
				// pooled (Compound). See applyFieldModeForType. A Leasing rule
				// saved before it had a Billing Rule is Non-Flat Rate.
				fieldtype: "Select",
				fieldname: "billing_rule_label",
				label: __("Billing Rule"),
				options: ["Flat Rate", "Non-Flat Rate"],
				default: (cur.rule || {}).rate_type || "Non-Flat Rate",
				reqd: 1,
			},
			{ fieldtype: "Column Break" },
			{
				// Simple: each journey billed on its own day count (the
				// historical behavior). Compound: the per-journey charge is
				// zeroed and instead batched across every journey billed
				// together at Sales Order generation time — total seal-days
				// (days × seals) summed, divided by First Period Days, rounded
				// up to a whole period, times First Period Amount (see
				// completed_journeys.py's _compute_compound_charge). Only
				// meaningful for a day-tiered, per-journey rate — Leasing, or a
				// Non-Flat Rate Subscription that isn't seat-based. Visibility
				// is driven by applyComputationMode, not depends_on, since the
				// seat-based check isn't expressible as a doc eval.
				fieldtype: "HTML",
				fieldname: "computation_html",
				label: __("Computation"),
			},
			{ fieldtype: "Column Break" },
			{
				// Not tied to billing_type — shown regardless of Subscription vs
				// Leasing. Introduced here as a placeholder for future billing
				// logic; not yet read anywhere (no depends_on, not part of any
				// primary_action save payload).
				fieldtype: "Select",
				fieldname: "journey_type",
				label: __("Journey Type"),
				options: ["Local", "International"],
				default: "Local",
			},

			// Only relevant for Subscription customers — a customer who owns
			// seals outright is always Subscription-billed per journey, so
			// this section (and whether Leasing is even offered above) only
			// makes sense once Subscription is picked (see
			// applyBillingTypeOptionsForOwnership).
			{
				fieldtype: "Section Break",
				fieldname: "seal_ownership_section",
				label: __("Seal Ownership"),
				depends_on: 'eval:doc.billing_type=="Subscription"',
			},
			{
				fieldtype: "Check",
				fieldname: "outright_purchase",
				label: __("Outright Purchase"),
				default: cur.outright_purchase ? 1 : 0,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Int",
				fieldname: "owned_seal_count",
				label: __("Number of Seals Owned"),
				default: cur.owned_seal_count || null,
				depends_on: "eval:doc.outright_purchase",
				mandatory_depends_on: "eval:doc.outright_purchase",
			},
			{ fieldtype: "Column Break" },
			{
				// The actual field backing the Recurring Ownership Service Fee
				// subscription (Scenario 5) — symmetric to lease_rate_per_seal
				// below, but a separate rate since owned and leased seats are
				// priced independently. Together with owned_seal_count this
				// drives the Rate Terms "Rate" preview — see
				// applySeatBasedRateOverride. Loaded eagerly at dialog open by
				// _cb_load_seat_data.
				fieldtype: "Currency",
				precision: 2,
				fieldname: "owned_rate_per_seal",
				label: __("Rate per Seal (Owned)"),
				options: "leasing_currency",
				depends_on: "eval:doc.outright_purchase",
			},
			{ fieldtype: "Column Break" },
			{
				// The actual field backing the Recurring Lease Fee subscription
				// (Scenario 4). Kept here, visible up front, so the count is
				// captured as part of the normal Billing flow. Loaded eagerly at
				// dialog open by _cb_load_seat_data (see its call site below).
				fieldtype: "Int",
				fieldname: "lease_seal_count",
				label: __("Number of Seals Leased"),
				depends_on: "eval:!doc.outright_purchase",
			},
			{ fieldtype: "Column Break" },
			{
				// Together with lease_seal_count, this drives the Rate under
				// Rate Terms below: once both are filled, that amount is
				// forced to lease_seal_count × lease_rate_per_seal instead of
				// the picked rule's own rate or a manual entry — see
				// applySeatBasedRateOverride. Still billed on whichever cycle
				// Billing Period Type says (e.g. its default Monthly); only
				// the amount is overridden, not the cycle.
				fieldtype: "Currency",
				precision: 2,
				fieldname: "lease_rate_per_seal",
				label: __("Rate per Seal"),
				options: "leasing_currency",
				depends_on: "eval:!doc.outright_purchase",
			},

			{
				fieldtype: "Section Break",
				fieldname: "tax_section",
				label: __("Tax"),
			},
			{
				fieldtype: "HTML",
				fieldname: "tax_category_html",
			},
			{
				fieldtype: "Section Break",
				fieldname: "rate_terms_section",
				label: __("Rate Terms"),
			},
			{
				// The customer's billing cycle, for both billing types. Drives
				// First Period Days: a standard option fixes it
				// (CB_FREQUENCY_PERIOD_DAYS) and locks the field; Custom leaves it
				// to be typed in — see applyFrequencyDays. For a seat-based
				// Subscription customer this is also the recurring fee's cycle
				// (see _cb_seat_fee_interval).
				fieldtype: "Select",
				fieldname: "billing_period_type",
				label: __("Frequency"),
				options: CB_FREQUENCY_OPTIONS,
				default: _cb_frequency_for_terms(cur.rule || {}),
			},
			{ fieldtype: "Column Break" },
			{
				// Shown for both billing types: read-only (from the picked rule)
				// for Subscription, editable for Leasing — see applyFieldModeForType.
				fieldtype: "Select",
				fieldname: "leasing_currency",
				label: __("Currency"),
				options: "\nKES\nUSD",
				default: currentLeasingTerms.currency || "KES",
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Int",
				fieldname: "first_period_days",
				label: __("First Period Days"),
				default: currentLeasingTerms.first_period_days,
			},
			{ fieldtype: "Column Break" },
			{
				// `options` points at the Currency field (leasing_currency)
				// holding this customer's chosen currency, so the symbol/
				// formatting here (Sh vs $) follows it live instead of always
				// showing the company's default currency.
				fieldtype: "Currency",
				precision: 2,
				fieldname: "first_period_amount",
				label: __("First Period Amount"),
				options: "leasing_currency",
				default: currentLeasingTerms.first_period_amount,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Currency",
				precision: 2,
				fieldname: "extra_day_rate",
				label: __("Extra Day Rate (per day)"),
				options: "leasing_currency",
				default: currentLeasingTerms.extra_day_rate,
			},
			{
				fieldtype: "Section Break",
				fieldname: "customer_period_section",
				label: __("Customer Period"),
			},
			{
				fieldtype: "Date",
				fieldname: "period_from_date",
				label: __("Period From Date"),
				default: cur.period_from_date || null,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Date",
				fieldname: "period_to_date",
				label: __("Period To Date"),
				default: cur.period_to_date || null,
			},

			// Extra Billing (Scenario 6) — a per-journey leasing agreement layered
			// ON TOP of this customer's Subscription, for outright-purchase
			// customers who also lease extra seals. Same shape as the main
			// Billing tab's Leasing terms (Rate Terms + Customer Period) minus
			// Tax (already set above). Lives on its own "page"
			// (RECURRING_PAGE_SECTIONS shown, BILLING_PAGE_SECTIONS hidden),
			// gated to outright-purchase Subscription customers (see the tab-nav
			// visibility in applyExtraBillingTabVisibility). Persisted as a
			// second Customer Billing Assignment via set_cb_extra_billing.
			{
				fieldtype: "Section Break",
				fieldname: "extra_billing_section",
				label: __("Extra Billing (leased seals)"),
				hidden: 1,
				hide_border: 1,
			},
			{
				// Child of extra_billing_section (kept non-empty so
				// refresh_sections() doesn't fold it away while detail fields
				// are still hidden pre-load).
				fieldtype: "HTML",
				fieldname: "recurring_loading_html",
				hidden: 1,
			},
			{
				fieldtype: "Check",
				fieldname: "activate_extra_billing",
				label: __("Activate Extra Billing"),
				default: 0,
				hidden: 1,
			},
			{
				fieldtype: "Section Break",
				fieldname: "extra_rate_terms_section",
				label: __("Rate Terms"),
				depends_on: "eval:doc.activate_extra_billing",
				hidden: 1,
			},
			{
				fieldtype: "Select",
				fieldname: "extra_currency",
				label: __("Currency"),
				options: "\nKES\nUSD",
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "extra_col_1", hidden: 1 },
			{
				fieldtype: "Int",
				fieldname: "extra_first_period_days",
				label: __("First Period Days"),
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "extra_col_2", hidden: 1 },
			{
				fieldtype: "Currency",
				precision: 2,
				fieldname: "extra_first_period_amount",
				label: __("First Period Amount"),
				options: "extra_currency",
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "extra_col_3", hidden: 1 },
			{
				fieldtype: "Currency",
				precision: 2,
				fieldname: "extra_extra_day_rate",
				label: __("Extra Day Rate (per day)"),
				options: "extra_currency",
				hidden: 1,
			},
			{
				fieldtype: "Section Break",
				fieldname: "extra_cb_period_section",
				label: __("Customer Period"),
				depends_on: "eval:doc.activate_extra_billing",
				hidden: 1,
			},
			{
				fieldtype: "Date",
				fieldname: "extra_period_from_date",
				label: __("Period From Date"),
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "extra_col_4", hidden: 1 },
			{
				fieldtype: "Date",
				fieldname: "extra_period_to_date",
				label: __("Period To Date"),
				hidden: 1,
			},
		],
		secondary_action_label: __("Manage Extra Billing"),
		secondary_action() {
			_cb_show_recurring_page(dialog, data.customer);
		},
		primary_action_label: __("Save Billing"),
		primary_action() {
			const billingType = dialog.get_value("billing_type");
			const taxCategory = _cb_get_tax_category(dialog);

			const leaseArgs = _cb_collect_lease_args(dialog);
			if (leaseArgs === false) return; // validation failed, message already shown
			const ownershipArgs = _cb_collect_ownership_args(dialog);
			if (ownershipArgs === false) return; // validation failed, message already shown
			const extraArgs = _cb_collect_extra_billing_args(dialog);
			if (extraArgs === false) return; // validation failed, message already shown

			// Which rate set this save targets. Saving the Import/Export set is
			// rates-only: the recurring Lease/Ownership Subscriptions and the
			// Extra Billing agreement are contract-level (billed on a cycle, not
			// per journey), so pushing this tab's per-seal rate into them would
			// silently rewrite the customer's recurring fee. The backend skips
			// the assignment/tax/disabled writes for the same reason.
			const journeyBucket = JT_BUCKET[dialog.get_value("journey_type")] || JT_LOCAL;
			const isPrimaryJourneyType = journeyBucket === JT_LOCAL;
			const recurringArgs = isPrimaryJourneyType
				? { leaseArgs, ownershipArgs, extraArgs }
				: {};
			const journeyRateArgs = {
				journey_type: journeyBucket,
				owned_rate_per_seal: dialog.get_value("owned_rate_per_seal") || 0,
				lease_rate_per_seal: dialog.get_value("lease_rate_per_seal") || 0,
			};

			const outrightPurchase = dialog.get_value("outright_purchase") ? 1 : 0;
			const ownedSealCount = dialog.get_value("owned_seal_count");
			if (outrightPurchase && (!ownedSealCount || cint(ownedSealCount) <= 0)) {
				frappe.show_alert(
					{ message: __("Enter the Number of Seals Owned for an Outright Purchase."), indicator: "red" },
					5
				);
				return;
			}

			if (outrightPurchase && billingType === "Leasing") {
				frappe.show_alert(
					{
						message: __(
							"Customers who own their seals outright cannot be billed as Leasing here. Use the Extra Billing tab instead."
						),
						indicator: "red",
					},
					5
				);
				return;
			}

			if (billingType === "Leasing") {
				const days = dialog.get_value("first_period_days");
				const amount = dialog.get_value("first_period_amount");
				const extraRate = dialog.get_value("extra_day_rate");
				const leasingRateType = dialog.get_value("billing_rule_label") || "Non-Flat Rate";
				const isLeasingFlat = leasingRateType === "Flat Rate";
				// Flat Rate has no day-tiering, so it's always Simple. Neither
				// Flat Rate nor Compound uses Extra Day Rate (a partial period
				// bills a full one), so it's hidden and not required — saved as 0.
				const leasingComputation = isLeasingFlat ? "Simple" : _cb_get_computation_method(dialog);
				const isCompound = leasingComputation === "Compound";
				const usesExtraDayRate = !isLeasingFlat && !isCompound;
				if (!days || amount === "" || amount === null) {
					frappe.show_alert(
						{
							message: isLeasingFlat
								? __("Enter First Period Days and Rate.")
								: __("Enter First Period Days and First Period Amount."),
							indicator: "red",
						},
						5
					);
					return;
				}
				if (usesExtraDayRate && (extraRate === "" || extraRate === null)) {
					frappe.show_alert({ message: __("Enter the Extra Day Rate."), indicator: "red" }, 5);
					return;
				}
				if (!_cb_validate_period_bounds(dialog)) return;
				_cb_submit_leasing_billing(
					page,
					data.customer,
					{
						rate_type: leasingRateType,
						computation_method: leasingComputation,
						billing_period_type: dialog.get_value("billing_period_type"),
						first_period_days: days,
						first_period_amount: amount,
						extra_day_rate: usesExtraDayRate ? extraRate : 0,
						currency: dialog.get_value("leasing_currency") || "KES",
						period_from_date: dialog.get_value("period_from_date"),
						period_to_date: dialog.get_value("period_to_date"),
						tax_category: taxCategory,
						outright_purchase: outrightPurchase,
						owned_seal_count: outrightPurchase ? ownedSealCount : 0,
						...journeyRateArgs,
					},
					dialog,
					recurringArgs
				);
				return;
			}

			const rateType = dialog.get_value("billing_rule_label");
			if (!rateType) {
				frappe.show_alert({ message: __("Choose a Rate Type — Flat Rate or Non-Flat Rate."), indicator: "red" }, 5);
				return;
			}
			const frequency = dialog.get_value("billing_period_type");
			if (!frequency) {
				frappe.show_alert({ message: __("Choose a Frequency."), indicator: "red" }, 5);
				return;
			}
			const subAmount = dialog.get_value("first_period_amount");
			if (subAmount === "" || subAmount === null) {
				frappe.show_alert({ message: __("Enter the Rate."), indicator: "red" }, 5);
				return;
			}
			const subDays = dialog.get_value("first_period_days");
			// Computation only applies where applyComputationMode shows it —
			// Flat Rate has no per-journey day-tiering to batch, and a
			// seat-based customer's journeys aren't billed per journey at all
			// (Compound there would bill on top of the seat fee) — so
			// everything else is forced to Simple.
			const computationMethod = isComputationApplicable() ? _cb_get_computation_method(dialog) : "Simple";
			if (!cint(subDays)) {
				frappe.show_alert({ message: __("Enter First Period Days."), indicator: "red" }, 5);
				return;
			}
			if (!_cb_validate_period_bounds(dialog)) return;
			_cb_submit_billing(
				page,
				data.customer,
				{
					rate_type: rateType,
					computation_method: computationMethod,
					billing_period_type: frequency,
					first_period_days: subDays,
					first_period_amount: subAmount,
					// Subscription never uses Extra Day Rate: past the first
					// period, each started period is a renewal billed in full
					// (billing.compute_billing_amount).
					extra_day_rate: 0,
					currency: dialog.get_value("leasing_currency") || "KES",
					period_from_date: dialog.get_value("period_from_date"),
					period_to_date: dialog.get_value("period_to_date"),
					tax_category: taxCategory,
					outright_purchase: outrightPurchase,
					owned_seal_count: outrightPurchase ? ownedSealCount : 0,
					...journeyRateArgs,
				},
				dialog,
				recurringArgs
			);
		},
	});

	// Stashed on the instance so the standalone _cb_show_recurring_page
	// helper (shared by the nav pill and the footer button) can reach them
	// without needing them threaded through as extra parameters everywhere.
	dialog.ccl_billing_sections = BILLING_PAGE_SECTIONS;
	dialog.ccl_recurring_sections = RECURRING_PAGE_SECTIONS;

	// True once a leased-seat rate is active (Number of Seals Leased + Rate
	// per Seal — or, for an outright customer, Number of Seals Owned + Rate
	// per Seal (Owned) — both filled on a Subscription customer). When so, the
	// Rate under Rate Terms is the fixed product count × rate per seal
	// regardless of which Billing Rule is picked — the rule only supplies the
	// billing cycle (Billing Period Type), never the amount. Returns the
	// {count, rate} pair in use, or null when not seat-based.
	const isLeaseSeatBased = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		if (!isSubscription) return null;

		if (dialog.get_value("outright_purchase")) {
			const sealCount = cint(dialog.get_value("owned_seal_count"));
			const ratePerSeal = flt(dialog.get_value("owned_rate_per_seal"));
			return sealCount > 0 && ratePerSeal > 0 ? { sealCount, ratePerSeal } : null;
		}

		const sealCount = cint(dialog.get_value("lease_seal_count"));
		const ratePerSeal = flt(dialog.get_value("lease_rate_per_seal"));
		return sealCount > 0 && ratePerSeal > 0 ? { sealCount, ratePerSeal } : null;
	};

	// Prefills Frequency/Currency/First Period Days/Extra Day Rate/Rate from
	// this customer's own private Subscription rule (currentSubscriptionTerms)
	// — there's no shared rule to preview anymore, so this only runs once per
	// switch to Subscription (or on initial dialog show), not on every Rate
	// Type change (see applyFieldModeForType).
	const applySubscriptionTermsPrefill = () => {
		dialog.set_value("billing_rule_label", currentSubscriptionTerms.rate_type || "Non-Flat Rate");
		dialog.set_value("billing_period_type", _cb_frequency_for_terms(currentSubscriptionTerms));
		dialog.set_value("leasing_currency", currentSubscriptionTerms.currency || "KES");
		dialog.set_value("first_period_days", currentSubscriptionTerms.first_period_days || "");
		dialog.set_value("first_period_amount", currentSubscriptionTerms.first_period_amount || "");
		dialog.set_value("extra_day_rate", currentSubscriptionTerms.extra_day_rate || "");
		setComputationMethod(currentSubscriptionTerms.computation_method);

		applySeatBasedRateOverride();
	};

	const setComputationMethod = (value) => {
		dialog.$wrapper
			.find(`input[name="${COMPUTATION_RADIO_NAME}"][value="${value || "Simple"}"]`)
			.prop("checked", true);
	};

	// Simple/Compound only means something for a per-journey, day-tiered
	// rate: Leasing, or a Non-Flat Rate Subscription that isn't seat-based
	// (a seat-based customer's journeys are zeroed in favour of the
	// recurring seat fee — see seal_journey.py::set_billing).
	const isComputationApplicable = () => {
		const billingType = dialog.get_value("billing_type");
		if (dialog.get_value("billing_rule_label") !== "Non-Flat Rate") return false;
		if (billingType === "Leasing") return true;
		return billingType === "Subscription" && !isLeaseSeatBased();
	};

	// Shows/hides the Computation radios, and Extra Day Rate with them:
	// Extra Day Rate is only used by Leasing + Non-Flat Rate + Simple. Flat
	// Rate never uses it (one fixed charge per journey), Subscription never
	// uses it (a started period past the first is billed as a full renewal —
	// billing.compute_billing_amount), and neither does Compound (a partial
	// period bills a full one — _compute_compound_charge). Re-run on any
	// change that can flip either: billing type, rule label, seat fields,
	// ownership, or the radio itself.
	const applyComputationMode = () => {
		const applicable = isComputationApplicable();
		dialog.set_df_property("computation_html", "hidden", applicable ? 0 : 1);

		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		const isFlatRate = dialog.get_value("billing_rule_label") !== "Non-Flat Rate";
		const isCompound = applicable && _cb_get_computation_method(dialog) === "Compound";
		dialog.set_df_property("extra_day_rate", "hidden", isSubscription || isFlatRate || isCompound ? 1 : 0);
	};

	// Frequency drives First Period Days on a Subscription: a standard
	// option fixes the day count and locks the field; Custom unlocks it
	// for a typed-in value (kept as-is when switching to it). Same for
	// Subscription and Leasing.
	const applyFrequencyDays = () => {
		const mapped = CB_FREQUENCY_PERIOD_DAYS[dialog.get_value("billing_period_type")];
		dialog.set_df_property("first_period_days", "read_only", mapped ? 1 : 0);
		if (mapped && cint(dialog.get_value("first_period_days")) !== mapped) {
			dialog.set_value("first_period_days", mapped);
		}
	};

	const applyFieldModeForType = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";

		// Flat Rate (either billing type) is a single fixed charge per
		// journey, so the amount is relabelled to just "Rate". First Period
		// Days stays visible for every type — Frequency drives it
		// (applyFrequencyDays), and it's the seat fee's cycle under a Custom
		// Frequency. Extra Day Rate's visibility is owned by
		// applyComputationMode.
		const isFlatRate = dialog.get_value("billing_rule_label") !== "Non-Flat Rate";
		dialog.set_df_property("first_period_amount", "label", isFlatRate ? __("Rate") : __("First Period Amount"));

		if (isSubscription) {
			dialog.ccl_leasing_prefilled = false;
			// Re-hiding/showing the day-tiered fields (Rate Type toggle) should
			// not stomp on values the user already typed — only prefill from
			// the customer's saved rule the first time we land on Subscription.
			if (!dialog.ccl_subscription_prefilled) {
				dialog.ccl_subscription_prefilled = true;
				applySubscriptionTermsPrefill();
			} else {
				applySeatBasedRateOverride();
			}
		} else {
			dialog.ccl_subscription_prefilled = false;
			// Leasing: restore this customer's own saved terms rather than
			// whatever Subscription entry left behind — once per switch to
			// Leasing, so a Billing Rule toggle doesn't stomp on typed values.
			if (!dialog.ccl_leasing_prefilled) {
				dialog.ccl_leasing_prefilled = true;
				dialog.set_value("billing_rule_label", currentLeasingTerms.rate_type || "Non-Flat Rate");
				dialog.set_value("billing_period_type", _cb_frequency_for_terms(currentLeasingTerms));
				dialog.set_value("first_period_days", currentLeasingTerms.first_period_days || "");
				dialog.set_value("first_period_amount", currentLeasingTerms.first_period_amount || "");
				dialog.set_value("extra_day_rate", currentLeasingTerms.extra_day_rate || "");
				dialog.set_value("leasing_currency", currentLeasingTerms.currency || "KES");
				setComputationMethod(currentLeasingTerms.computation_method);
			}
			applySeatBasedRateOverride();
		}

		applyFrequencyDays();
		applyComputationMode();

		// Extra Billing tab is Subscription-only — re-evaluate on billing type change.
		dialog.ccl_apply_extra_tab_visibility && dialog.ccl_apply_extra_tab_visibility();
	};

	// Scenarios 4/5 (leased or owned seats): the single writer of
	// first_period_amount (Rate) for a Subscription customer, so it's set
	// exactly once per pass and never lost to the async set_value /
	// is_value_same race. When Number of Seals (Leased or Owned) + its Rate
	// per Seal are both filled, the Rate is the fixed product count × rate.
	// Otherwise leaves whatever Rate/First Period Amount is already entered
	// untouched — both billing types are direct entry now, there's no shared
	// rule to fall back to. This is a display preview only — the real
	// per-journey charge is separately zeroed for seat-based customers (see
	// seal_journey.py::set_billing / customer_has_seat_subscription).
	const applySeatBasedRateOverride = () => {
		const seatBasis = isLeaseSeatBased();
		const isSeatBased = !!seatBasis;

		dialog.set_df_property("first_period_amount", "read_only", isSeatBased ? 1 : 0);
		if (isSeatBased) {
			dialog.set_value("first_period_amount", seatBasis.sealCount * seatBasis.ratePerSeal);
		}
	};

	// A customer who owns their seals outright is always Subscription-billed
	// per journey — any leasing for them goes on the Extra Billing tab instead.
	// Ticking Outright Purchase here drops Leasing from Billing Type and, if it
	// was selected, switches back to Subscription.
	const applyBillingTypeOptionsForOwnership = () => {
		const isOutright = !!dialog.get_value("outright_purchase");
		dialog.set_df_property("billing_type", "options", isOutright ? ["Subscription"] : ["Subscription", "Leasing"]);
		dialog.set_df_property("owned_seal_count", "hidden", isOutright ? 0 : 1);
		dialog.set_df_property("owned_rate_per_seal", "hidden", isOutright ? 0 : 1);
		dialog.set_df_property("lease_seal_count", "hidden", isOutright ? 1 : 0);
		dialog.set_df_property("lease_rate_per_seal", "hidden", isOutright ? 1 : 0);

		if (isOutright && dialog.get_value("billing_type") === "Leasing") {
			dialog.set_value("billing_type", "Subscription");
		}
		// An outright-purchase customer doesn't lease seals — drop any leased
		// count/rate (own or stale, e.g. loaded from an existing subscription
		// before ownership was flagged) so Save Billing can't resurrect a
		// Recurring Lease Fee line for them.
		if (isOutright) {
			if (dialog.get_value("lease_seal_count")) dialog.set_value("lease_seal_count", null);
			if (dialog.get_value("lease_rate_per_seal")) dialog.set_value("lease_rate_per_seal", null);
		} else {
			// Symmetric: a leasing (non-outright) customer doesn't own seals —
			// drop any stale owned count/rate so Save Billing can't resurrect an
			// Ownership Service Fee line for them.
			if (dialog.get_value("owned_seal_count")) dialog.set_value("owned_seal_count", null);
			if (dialog.get_value("owned_rate_per_seal")) dialog.set_value("owned_rate_per_seal", null);
		}
		applySeatBasedRateOverride();
		applyComputationMode();
		// Extra Billing (Scenario 6) is gated to outright-purchase Subscription
		// customers — re-evaluate the tab when ownership changes.
		dialog.ccl_apply_extra_tab_visibility && dialog.ccl_apply_extra_tab_visibility();
	};

	// The Currency-type fields below use `options: "leasing_currency"` so
	// their symbol/formatting follows whatever currency is picked. Frappe
	// resolves that symbol from `doc[df.options]`, but a plain frappe.ui.Dialog
	// has no backing model doc — the read-only display reads `control.doc`
	// (base_input set_disp_area) and the editable input reads
	// `control.get_doc()` (ControlFloat get_number_format), both of which are
	// empty here, so every Currency field silently falls back to the system
	// default (KES → "Sh") regardless of the dropdown. Give each field a tiny
	// stand-in doc carrying the live currency so both paths resolve it, and
	// re-point + refresh them whenever the currency changes (including
	// programmatic changes, e.g. switching rules/billing type).
	// Each group of Currency fields resolves its symbol from a currency Select
	// (via `options`). Give each group a stand-in doc so both the read-only and
	// editable paths pick it up, and refresh on currency change. Billing-tab
	// fields follow leasing_currency; Extra Billing fields follow extra_currency.
	const bindCurrencyGroup = (currencyField, amountFields) => {
		const doc = {};
		doc[currencyField] = dialog.get_value(currencyField) || "KES";
		amountFields.forEach((fieldname) => {
			const field = dialog.fields_dict[fieldname];
			if (!field) return;
			field.doc = doc;
			field.get_doc = () => doc;
			// Seed the amount: base_input.refresh_input re-reads me.value from
			// me.doc[fieldname] on refresh; without this the first currency
			// refresh would blank a construction-time default. set_value keeps
			// them in sync afterwards (set_model_value writes back into this.doc).
			doc[fieldname] = field.value;
		});
		return () => {
			doc[currencyField] = dialog.get_value(currencyField) || "KES";
			amountFields.forEach((fieldname) => {
				const field = dialog.fields_dict[fieldname];
				field && field.refresh();
			});
		};
	};
	const refreshBillingCurrency = bindCurrencyGroup("leasing_currency", [
		"first_period_amount",
		"extra_day_rate",
		"lease_rate_per_seal",
		"owned_rate_per_seal",
	]);
	const refreshExtraCurrency = bindCurrencyGroup("extra_currency", [
		"extra_first_period_amount",
		"extra_extra_day_rate",
	]);
	const applyCurrencyFormatting = () => {
		refreshBillingCurrency();
		refreshExtraCurrency();
	};

	// Snapshot whatever rate amounts are currently on the form, so they can be
	// restored if the user switches journey type and comes back.
	const captureJourneyRates = () => {
		const snap = {};
		JT_RATE_FIELDS.forEach((f) => {
			const v = dialog.get_value(f);
			snap[f] = v === "" || v === undefined ? null : v;
		});
		return snap;
	};

	// Swaps the rate amounts when Journey Type changes. Import <-> Export is a
	// no-op (same stored bucket, same rates). Local <-> Import/Export stashes
	// the outgoing set and loads the incoming one — blanking the fields when
	// that journey type has no rates yet, which is how a new set is entered.
	const applyJourneyTypeRates = () => {
		const bucket = JT_BUCKET[dialog.get_value("journey_type")] || JT_LOCAL;
		if (bucket === activeJourneyBucket) return;

		journeyRateCache[activeJourneyBucket] = captureJourneyRates();
		activeJourneyBucket = bucket;

		// International defaults to the Local rates until it has its own set; saving
		// then stores it separately, so it can be changed independently later.
		const incoming =
			journeyRateCache[bucket] || (bucket === JT_IMPORT_EXPORT ? journeyRateCache[JT_LOCAL] : null);
		JT_RATE_FIELDS.forEach((f) => {
			dialog.set_value(f, incoming ? incoming[f] ?? "" : "");
		});
		// The seat-based override derives Rate from count x rate-per-seal, so it
		// has to re-run against the newly loaded (or blanked) per-seal rates.
		applySeatBasedRateOverride();
		// Frequency is contract-level — re-fix the incoming set's First Period
		// Days to it rather than showing a stale/blank stored value.
		applyFrequencyDays();
	};
	// Read by _cb_load_seat_data so the live Subscription rates (which are
	// the Local set) never overwrite the Import/Export fields on late arrival.
	dialog.ccl_active_journey_bucket = () => activeJourneyBucket;
	dialog.ccl_local_bucket = JT_LOCAL;
	dialog.ccl_cache_local_seat_rate = (fieldname, value) => {
		journeyRateCache[JT_LOCAL] = journeyRateCache[JT_LOCAL] || {};
		journeyRateCache[JT_LOCAL][fieldname] = value;
	};

	dialog.fields_dict.journey_type.df.onchange = applyJourneyTypeRates;
	dialog.fields_dict.billing_type.df.onchange = applyFieldModeForType;
	dialog.fields_dict.billing_rule_label.df.onchange = applyFieldModeForType;
	dialog.fields_dict.billing_period_type.df.onchange = applyFrequencyDays;
	dialog.fields_dict.outright_purchase.df.onchange = applyBillingTypeOptionsForOwnership;
	// Number of Seals (Leased or Owned) / Rate per Seal drive both the
	// seat-based Rate override (applySeatBasedRateOverride) and Extra Billing
	// tab eligibility (applyExtraBillingTabVisibility, defined below — safe to
	// reference here since this handler only runs later, once both are
	// assigned).
	const applySeatFieldChange = () => {
		applySeatBasedRateOverride();
		applyComputationMode();
		dialog.ccl_apply_extra_tab_visibility && dialog.ccl_apply_extra_tab_visibility();
	};
	dialog.fields_dict.lease_seal_count.df.onchange = applySeatFieldChange;
	dialog.fields_dict.lease_rate_per_seal.df.onchange = applySeatFieldChange;
	dialog.fields_dict.owned_seal_count.df.onchange = applySeatFieldChange;
	dialog.fields_dict.owned_rate_per_seal.df.onchange = applySeatFieldChange;
	dialog.fields_dict.leasing_currency.df.onchange = refreshBillingCurrency;
	dialog.fields_dict.extra_currency.df.onchange = refreshExtraCurrency;

	// FieldGroup.make() binds one generic "change" listener, at construction
	// time, to whatever <input>/<select> elements already exist in the DOM —
	// it's what makes depends_on (extra_rate_terms_section/
	// extra_cb_period_section both depend on this) re-evaluate on any
	// field change. activate_extra_billing starts `hidden: 1` and only gets
	// its real <input> built later, once _cb_load_extra_billing_data
	// reveals it (well after that listener was bound) — so toggling it never
	// reaches that listener and depends_on never re-runs. Explicit onchange
	// here calls refresh_dependency() directly instead of relying on it.
	dialog.fields_dict.activate_extra_billing.df.onchange = () => dialog.refresh_dependency();

	const taxRadioHtml = taxCategoryOptions
		.map(
			(opt) => `
				<label class="cbl-tax-radio">
					<input type="radio" name="${TAX_RADIO_NAME}" value="${frappe.utils.escape_html(opt.value)}" ${
				opt.value === currentTaxCategory ? "checked" : ""
			} />
					<span>${opt.label}</span>
				</label>
			`
		)
		.join("");
	dialog.fields_dict.tax_category_html.$wrapper.html(
		`<div class="cbl-tax-radio-group">${taxRadioHtml}</div>`
	);

	const computationRadioHtml = computationOptions
		.map(
			(opt) => `
				<label class="cbl-tax-radio">
					<input type="radio" name="${COMPUTATION_RADIO_NAME}" value="${frappe.utils.escape_html(opt.value)}" ${
				opt.value === currentComputationMethod ? "checked" : ""
			} />
					<span>${opt.label}</span>
				</label>
			`
		)
		.join("");
	dialog.fields_dict.computation_html.$wrapper.html(
		`<div class="cbl-tax-radio-group">${computationRadioHtml}</div>`
	);
	dialog.fields_dict.computation_html.$wrapper.on(
		"change",
		`input[name="${COMPUTATION_RADIO_NAME}"]`,
		applyComputationMode
	);

	dialog.fields_dict.recurring_loading_html.$wrapper.html(
		`<div class="cbl-recurring-loading">${__("Loading extra billing details…")}</div>`
	);

	dialog.fields_dict.tab_nav_html.$wrapper.html(`
		<div class="cbl-page-nav">
			<button type="button" class="cbl-page-nav-btn active" data-page="billing">${__("Billing")}</button>
			<button type="button" class="cbl-page-nav-btn" data-page="recurring">${__("Extra Billing")}</button>
		</div>
	`);
	dialog.fields_dict.tab_nav_html.$wrapper.on("click", ".cbl-page-nav-btn", function () {
		const targetPage = $(this).attr("data-page");
		if (targetPage === "recurring") {
			_cb_show_recurring_page(dialog, data.customer);
		} else {
			_cb_switch_dialog_page(dialog, targetPage, BILLING_PAGE_SECTIONS, RECURRING_PAGE_SECTIONS);
		}
	});

	// The Extra Billing tab/button is for Subscription customers who already
	// have seals to extend — either they own seals outright, or they're
	// already leasing some seats (Number of Seals Leased + Rate per Seal both
	// filled, Scenario 4) and want to lease additional ones on top. Toggling
	// any of outright_purchase/billing_type/lease_seal_count/lease_rate_per_seal
	// re-evaluates it (wired below and into applyBillingTypeOptionsForOwnership
	// / applyFieldModeForType, which already fire on those changes); if the tab
	// is hidden while active, snap back to the Billing page.
	const applyExtraBillingTabVisibility = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		const hasOwnedSeals = !!dialog.get_value("outright_purchase");
		const hasLeasedSeals =
			!!dialog.get_value("lease_seal_count") && !!dialog.get_value("lease_rate_per_seal");
		const eligible = isSubscription && (hasOwnedSeals || hasLeasedSeals);

		// Two entry points to the Extra Billing page gate together: the nav pill
		// and the "Manage Extra Billing" footer button (the dialog's secondary
		// action). ``get_secondary_btn`` returns that footer button.
		const $btn = dialog.$wrapper.find('.cbl-page-nav-btn[data-page="recurring"]');
		$btn.toggle(!!eligible);
		dialog.get_secondary_btn().toggleClass("hide", !eligible);
		if (!eligible && $btn.hasClass("active")) {
			_cb_switch_dialog_page(dialog, "billing", BILLING_PAGE_SECTIONS, RECURRING_PAGE_SECTIONS);
		}
	};
	dialog.ccl_apply_extra_tab_visibility = applyExtraBillingTabVisibility;

	dialog.show();
	// billing_type's own "default" is applied asynchronously by FieldGroup.make()
	// (set_values(defaults).then(...)), so reading dialog.get_value("billing_type")
	// synchronously here — as applyFieldModeForType/applyExtraBillingTabVisibility
	// do — can still see the <select>'s native first-option value ("Subscription")
	// even for a Leasing customer, which misroutes First Period Days et al. to the
	// Subscription branch. Explicitly (re)setting it first and waiting for that to
	// land guarantees the field is actually in sync before anything reads it.
	dialog.set_value("billing_type", initialType).then(() => {
		applyBillingTypeOptionsForOwnership();
		applyFieldModeForType();
		applyCurrencyFormatting();
		applyExtraBillingTabVisibility();
	});

	// Eagerly load the customer's existing Scenario 4 lease + Scenario 5
	// ownership subscriptions — their fields live on the always-visible
	// Billing page, so they're populated up front. The Extra Billing agreement
	// is loaded lazily (on first visit to the Extra Billing page) because its
	// Select controls only build their <option> list once actually visible —
	// see _cb_load_extra_billing_data.
	_cb_load_seat_data(dialog, data.customer, () => {
		applyBillingTypeOptionsForOwnership();
		applyCurrencyFormatting();
		applyExtraBillingTabVisibility();
		dialog.refresh_sections();
	});
}

function _cb_get_tax_category(dialog) {
	return dialog.$wrapper.find('input[name="ccl_tax_category"]:checked').val() || "Normal Tax (16% VAT)";
}

function _cb_get_computation_method(dialog) {
	return dialog.$wrapper.find('input[name="ccl_computation"]:checked').val() || "Simple";
}

// Switches the Set Billing modal between its "Billing" and "Recurring Fees"
// pages — a hand-rolled two-pill nav rather than Frappe's "Tab Break"
// fieldtype, which requires a real frm/doctype to build its DOM id and
// crashes inside a plain frappe.ui.Dialog (see the note above the fields
// array). Hiding/showing each page's named sections and re-running
// ``refresh_sections()`` is the same primitive the lease/ownership fields
// already used to reveal themselves in place.
function _cb_switch_dialog_page(dialog, targetPage, billingSections, recurringSections) {
	const showBilling = targetPage !== "recurring";
	billingSections.forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", showBilling ? 0 : 1));
	recurringSections.forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", showBilling ? 1 : 0));
	dialog.refresh_sections();

	dialog.$wrapper.find(".cbl-page-nav-btn").removeClass("active");
	dialog.$wrapper.find(`.cbl-page-nav-btn[data-page="${targetPage}"]`).addClass("active");
}

// Single entry point for landing on the Extra Billing page, used by both the
// nav pill and the "Manage Extra Billing" footer button. Switch page first,
// then (on first visit) reveal a loading placeholder and fetch the agreement —
// loading here rather than at dialog open because the extra fields' Select
// controls only build their <option> list once actually visible.
function _cb_show_recurring_page(dialog, customer) {
	_cb_switch_dialog_page(dialog, "recurring", dialog.ccl_billing_sections, dialog.ccl_recurring_sections);

	if (dialog.extra_data_loaded) return;

	dialog.set_df_property("recurring_loading_html", "hidden", 0);
	dialog.refresh_sections();

	_cb_load_extra_billing_data(dialog, customer, () => {
		dialog.set_df_property("recurring_loading_html", "hidden", 1);
		dialog.refresh_sections();
	});
}

// Loads the customer's Scenario 4 lease + Scenario 5 ownership subscriptions
// into the Billing-page seat fields (seal_ownership_section, always visible)
// — safe to call eagerly at dialog open. Guarded by ``seat_data_loaded``.
function _cb_load_seat_data(dialog, customer, onComplete) {
	if (dialog.seat_data_loaded) {
		onComplete && onComplete();
		return;
	}
	dialog.seat_data_loaded = true;

	let pending = 2;
	const settle = () => {
		pending -= 1;
		if (pending === 0) onComplete && onComplete();
	};

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.get_customer_lease_subscription",
		args: { customer },
		callback(r) {
			const info = r.message || {};
			// Seal counts are contract-level (the customer leases N seals however
			// the journey is classified), so this one applies regardless of the
			// journey type on screen.
			dialog.set_value("lease_seal_count", info.seal_count || null);
			_cb_apply_local_seat_rate(dialog, "lease_rate_per_seal", info.rate_per_seal || null);
			settle();
		},
		error() {
			frappe.show_alert({ message: __("Could not load lease subscription details"), indicator: "red" }, 5);
			settle();
		},
	});

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.get_customer_ownership_subscription",
		args: { customer },
		callback(r) {
			const info = r.message || {};
			_cb_apply_local_seat_rate(dialog, "owned_rate_per_seal", info.rate_per_seal || null);
			settle();
		},
		error() {
			frappe.show_alert({ message: __("Could not load ownership subscription details"), indicator: "red" }, 5);
			settle();
		},
	});
}

// The live Subscriptions hold the *Local* per-seal rates (only Local feeds the
// recurring fee — see set_cb_billing). These loads are async, so by the
// time they land the user may already have switched the modal to Import/Export;
// writing straight to the field would then silently overwrite that set's blank
// (or freshly typed) rate. So the value always goes into the Local cache, and
// only reaches the visible field while Local is the journey type on screen.
function _cb_apply_local_seat_rate(dialog, fieldname, value) {
	if (dialog.ccl_cache_local_seat_rate) dialog.ccl_cache_local_seat_rate(fieldname, value);
	const activeBucket = dialog.ccl_active_journey_bucket && dialog.ccl_active_journey_bucket();
	if (!activeBucket || activeBucket === dialog.ccl_local_bucket) {
		dialog.set_value(fieldname, value);
	}
}

// Loads the customer's Extra Billing agreement and reveals + fills the Extra
// Billing page. Called from _cb_show_recurring_page (page already shown)
// so the reveal-before-set dance below actually renders the Select options.
// Guarded by ``extra_data_loaded``.
function _cb_load_extra_billing_data(dialog, customer, onComplete) {
	if (dialog.extra_data_loaded) {
		onComplete && onComplete();
		return;
	}
	dialog.extra_data_loaded = true;

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.get_customer_extra_billing",
		args: { customer },
		callback(r) {
			const info = r.message || {};

			// Reveal the fields BEFORE setting their values. A frappe control
			// only builds its <input>/<select> DOM when it first becomes
			// visible (base_input.js refresh_input calls make_input only when
			// disp_status != "None"). For a Select, calling set_value while
			// still hidden POISONS its `last_options` cache, so it renders empty
			// once un-hidden. Un-hiding first lets make_input build the real
			// <select>. Column Break fieldnames are omitted (not in fields_dict).
			[
				"extra_billing_section",
				"activate_extra_billing",
				"extra_rate_terms_section",
				"extra_currency",
				"extra_first_period_days",
				"extra_first_period_amount",
				"extra_extra_day_rate",
				"extra_cb_period_section",
				"extra_period_from_date",
				"extra_period_to_date",
			].forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", 0));

			dialog.set_value("activate_extra_billing", info.active ? 1 : 0);
			dialog.set_value("extra_currency", info.currency || "KES");
			dialog.set_value("extra_first_period_days", info.first_period_days || null);
			dialog.set_value("extra_first_period_amount", info.first_period_amount || null);
			dialog.set_value("extra_extra_day_rate", info.extra_day_rate || null);
			dialog.set_value("extra_period_from_date", info.period_from_date || null);
			dialog.set_value("extra_period_to_date", info.period_to_date || null);

			dialog.refresh_sections();
			onComplete && onComplete();
		},
		error() {
			frappe.show_alert({ message: __("Could not load extra billing details"), indicator: "red" }, 5);
			onComplete && onComplete();
		},
	});
}

// The recurring seat fee's billing cycle, from Frequency: a standard option
// maps to its calendar interval (Monthly → every month); Custom bills
// every First Period Days. Returns {billing_interval, interval_days}, or null
// (message shown) when a Custom cycle has no First Period Days.
function _cb_seat_fee_interval(dialog) {
	const mapped = CB_BILLING_PERIOD_TO_LEASE_INTERVAL[dialog.get_value("billing_period_type")];
	if (mapped) return { billing_interval: mapped, interval_days: null };

	const days = cint(dialog.get_value("first_period_days"));
	if (days <= 0) {
		frappe.show_alert(
			{ message: __("Enter First Period Days — the recurring seat fee bills every that many days."), indicator: "red" },
			6
		);
		return null;
	}
	return { billing_interval: "Day", interval_days: days };
}

// Reads the (possibly hidden) lease fields off the dialog. Returns null when
// the section was never revealed or was left blank (nothing to save), a
// terms object when filled in, or false on a validation failure (a message
// has already been shown, so the caller should abort the whole save).
function _cb_collect_lease_args(dialog) {
	const seal_count = cint(dialog.get_value("lease_seal_count"));
	const rate_per_seal = flt(dialog.get_value("lease_rate_per_seal"));
	const hasSealCount = seal_count > 0;
	const hasRate = rate_per_seal > 0;

	if (!hasSealCount && !hasRate) return null; // left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Leased and Rate per Seal, or leave both blank."), indicator: "red" },
			6
		);
		return false;
	}

	const interval = _cb_seat_fee_interval(dialog);
	if (!interval) return false;

	return {
		seal_count,
		rate_per_seal,
		...interval,
		currency: dialog.get_value("leasing_currency") || "KES",
	};
}

// Same shape as _cb_collect_lease_args, for the owned side (Scenario 5
// — Ownership Service Fee). Reads owned_seal_count/owned_rate_per_seal
// instead of the leased pair.
function _cb_collect_ownership_args(dialog) {
	if (!dialog.get_value("outright_purchase")) return null;

	const seal_count = cint(dialog.get_value("owned_seal_count"));
	const rate_per_seal = flt(dialog.get_value("owned_rate_per_seal"));
	const hasSealCount = seal_count > 0;
	const hasRate = rate_per_seal > 0;

	if (!hasSealCount && !hasRate) return null; // left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Owned and Rate per Seal (Owned), or leave both blank."), indicator: "red" },
			6
		);
		return false;
	}

	const interval = _cb_seat_fee_interval(dialog);
	if (!interval) return false;

	return {
		seal_count,
		rate_per_seal,
		...interval,
		currency: dialog.get_value("leasing_currency") || "KES",
	};
}

// Collects the Extra Billing (Scenario 6) leasing agreement off the dialog.
// Returns null when nothing to persist and never persisted (skip the call), a
// terms object otherwise (including deactivation), or false on a validation
// failure (message already shown, caller should abort the save). Only relevant
// once the extra data has loaded.
function _cb_collect_extra_billing_args(dialog) {
	// Never opened the Extra Billing tab this session → nothing to persist.
	if (!dialog.extra_data_loaded) return null;

	const activate = dialog.get_value("activate_extra_billing") ? 1 : 0;
	const days = dialog.get_value("extra_first_period_days");
	const amount = dialog.get_value("extra_first_period_amount");
	const extraRate = dialog.get_value("extra_extra_day_rate");
	const hasTerms =
		!!days && amount !== "" && amount !== null && amount !== undefined && extraRate !== "" && extraRate !== null && extraRate !== undefined;

	if (!activate && !hasTerms) return null; // nothing entered, nothing to switch off

	if (activate && !hasTerms) {
		frappe.show_alert(
			{ message: __("Enter First Period Days, First Period Amount and Extra Day Rate for Extra Billing, or untick Activate Extra Billing."), indicator: "red" },
			7
		);
		return false;
	}

	return {
		activate,
		first_period_days: days,
		first_period_amount: amount,
		extra_day_rate: extraRate,
		currency: dialog.get_value("extra_currency") || "KES",
		period_from_date: dialog.get_value("extra_period_from_date") || null,
		period_to_date: dialog.get_value("extra_period_to_date") || null,
	};
}

// Shared tail end of both billing-save paths: saves the Scenario 4 lease
// subscription, the Scenario 5 ownership subscription, and/or the Scenario 6
// Extra Billing agreement (whichever the caller collected) before closing the
// dialog and reloading, so "Save Billing" acts as one combined save.
function _cb_finish_billing_save(page, dialog, customer, billingMessage, recurringArgs) {
	const { leaseArgs, ownershipArgs, extraArgs } = recurringArgs || {};
	if (!leaseArgs && !ownershipArgs && !extraArgs) {
		dialog.hide();
		frappe.show_alert({ message: billingMessage, indicator: "green" });
		_cb_load(page);
		return;
	}

	const calls = [];
	if (leaseArgs) {
		calls.push(
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.set_customer_lease_subscription",
				args: {
					customer,
					seal_count: leaseArgs.seal_count,
					rate_per_seal: leaseArgs.rate_per_seal,
					billing_interval: leaseArgs.billing_interval,
					interval_days: leaseArgs.interval_days,
					currency: leaseArgs.currency,
				},
				freeze: true,
				freeze_message: __("Saving lease subscription…"),
			})
		);
	}
	if (ownershipArgs) {
		calls.push(
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.set_customer_ownership_subscription",
				args: {
					customer,
					seal_count: ownershipArgs.seal_count,
					rate_per_seal: ownershipArgs.rate_per_seal,
					billing_interval: ownershipArgs.billing_interval,
					interval_days: ownershipArgs.interval_days,
					currency: ownershipArgs.currency,
				},
				freeze: true,
				freeze_message: __("Saving ownership subscription…"),
			})
		);
	}
	if (extraArgs) {
		calls.push(
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_extra_billing",
				args: {
					customer,
					activate: extraArgs.activate,
					first_period_days: extraArgs.first_period_days,
					first_period_amount: extraArgs.first_period_amount,
					extra_day_rate: extraArgs.extra_day_rate,
					currency: extraArgs.currency,
					period_from_date: extraArgs.period_from_date,
					period_to_date: extraArgs.period_to_date,
				},
				freeze: true,
				freeze_message: __("Saving extra billing…"),
			})
		);
	}

	Promise.all(calls)
		.then(() => {
			dialog.hide();
			frappe.show_alert({ message: __("{0} Recurring billing saved.", [billingMessage]), indicator: "green" });
			_cb_load(page);
		})
		.catch(() => {
			dialog.hide();
			frappe.show_alert(
				{ message: __("{0}, but recurring billing could not be saved.", [billingMessage]), indicator: "orange" },
				6
			);
			_cb_load(page);
		});
}

function _cb_submit_leasing_billing(page, customer, terms, dialog, recurringArgs) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_type: "Leasing",
			rate_type: terms.rate_type,
			computation_method: terms.computation_method,
			billing_period_type: terms.billing_period_type,
			first_period_days: terms.first_period_days,
			first_period_amount: terms.first_period_amount,
			extra_day_rate: terms.extra_day_rate,
			currency: terms.currency,
			period_from_date: terms.period_from_date || null,
			period_to_date: terms.period_to_date || null,
			tax_category: terms.tax_category,
			outright_purchase: terms.outright_purchase,
			owned_seal_count: terms.owned_seal_count,
			journey_type: terms.journey_type,
			owned_rate_per_seal: terms.owned_rate_per_seal,
			lease_rate_per_seal: terms.lease_rate_per_seal,
		},
		freeze: true,
		freeze_message: __("Saving billing…"),
		callback(r) {
			const name = (r.message && r.message.billing_rule_name) || "";
			const message = name ? __("Billing set to {0}.", [name]) : __("Billing updated.");
			_cb_finish_billing_save(page, dialog, customer, message, recurringArgs);
		},
		error() {
			frappe.show_alert({ message: __("Could not save billing"), indicator: "red" }, 5);
		},
	});
}

function _cb_validate_period_bounds(dialog) {
	const from = dialog.get_value("period_from_date");
	const to = dialog.get_value("period_to_date");

	if (from && to && frappe.datetime.str_to_obj(to) < frappe.datetime.str_to_obj(from)) {
		frappe.show_alert({ message: __("Period To Date cannot be before Period From Date."), indicator: "red" }, 5);
		return false;
	}
	return true;
}

function _cb_submit_billing(page, customer, terms, dialog, recurringArgs) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_type: "Subscription",
			rate_type: terms.rate_type,
			computation_method: terms.computation_method,
			billing_period_type: terms.billing_period_type,
			first_period_days: terms.first_period_days,
			first_period_amount: terms.first_period_amount,
			extra_day_rate: terms.extra_day_rate,
			currency: terms.currency,
			period_from_date: terms.period_from_date || null,
			period_to_date: terms.period_to_date || null,
			tax_category: terms.tax_category,
			outright_purchase: terms.outright_purchase,
			owned_seal_count: terms.owned_seal_count,
			journey_type: terms.journey_type,
			owned_rate_per_seal: terms.owned_rate_per_seal,
			lease_rate_per_seal: terms.lease_rate_per_seal,
		},
		freeze: true,
		freeze_message: __("Saving billing…"),
		callback(r) {
			const name = (r.message && r.message.billing_rule_name) || "";
			const message = name ? __("Billing set to {0}.", [name]) : __("Billing updated.");
			_cb_finish_billing_save(page, dialog, customer, message, recurringArgs);
		},
		error() {
			frappe.show_alert({ message: __("Could not save billing"), indicator: "red" }, 5);
		},
	});
}


// ---------------------------------------------------------------------------
// Completed Journeys view — same content as /app/completed-journeys
// ---------------------------------------------------------------------------

function _cjv_init(page, $stats) {
	page.cj_state = {
		period: "Monthly",
		from_date: frappe.datetime.month_start(),
		to_date: frappe.datetime.get_today(),
		customer: "",
		page: 1,
	};
	page.cj_stats_bar = $stats;
	_cjv_inject_styles();
	_cjv_build_filters(page);
	_cjv_build_skeleton(page);
	$(page.body).find(".cj-page").hide();
	// Filters on the left, journey stats pushed to the right of the same row.
	$(page.page_form).addClass("cbl-cj-form").append($stats);
	page.hide_form();
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function _cjv_build_filters(page) {
	page.period_field = page.add_field({
		fieldname: "period",
		label: __("Period"),
		fieldtype: "Select",
		options: ["Custom", "Daily", "Weekly", "Monthly"],
		default: "Monthly",
		change() {
			const period = page.period_field.get_value();
			page.cj_state.period = period;
			_cjv_apply_period(page);
			_cjv_load(page);
		},
	});

	page.from_date_field = page.add_field({
		fieldname: "from_date",
		label: __("From Date"),
		fieldtype: "Date",
		default: page.cj_state.from_date,
		change() {
			page.cj_state.from_date = page.from_date_field.get_value();
			page.cj_state.page = 1;
			_cjv_refresh_customer_options(page);
			_cjv_load(page);
		},
	});

	page.to_date_field = page.add_field({
		fieldname: "to_date",
		label: __("To Date"),
		fieldtype: "Date",
		default: page.cj_state.to_date,
		change() {
			page.cj_state.to_date = page.to_date_field.get_value();
			page.cj_state.page = 1;
			_cjv_refresh_customer_options(page);
			_cjv_load(page);
		},
	});

	// Searchable dropdown: typing narrows the suggestions to similar names and
	// picking one filters to that customer. "All" (the default) means everyone.
	// The suggestions are the customers with completed journeys in the period.
	page.customer_field = page.add_field({
		fieldname: "customer",
		label: __("Customer"),
		fieldtype: "Autocomplete",
		options: [CJV_ALL],
		default: CJV_ALL,
		change() {
			const value = (page.customer_field.get_value() || "").trim();
			// Half-typed text doesn't filter; only a suggestion (or All / empty) does.
			if (value && value !== CJV_ALL && !(page.cj_customers || []).includes(value)) return;
			const customer = !value || value === CJV_ALL ? "" : value;
			if (customer === page.cj_state.customer) return;
			page.cj_state.customer = customer;
			page.cj_state.page = 1;
			_cjv_load(page);
		},
	});
	_cjv_refresh_customer_options(page);
}

const CJV_ALL = "All";

// Reload the suggestions for the current dates; if the selected customer has
// nothing in them, fall back to All.
function _cjv_refresh_customer_options(page) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.completed_journeys.get_filter_customers",
		args: { from_date: page.cj_state.from_date || null, to_date: page.cj_state.to_date || null },
		callback(r) {
			const customers = r.message || [];
			page.cj_customers = customers;
			page.customer_field.set_data([CJV_ALL, ...customers]);
			if (page.cj_state.customer && !customers.includes(page.cj_state.customer)) {
				page.cj_state.customer = "";
				page.cj_state.page = 1;
				page.customer_field.set_value(CJV_ALL);
				_cjv_load(page);
			}
		},
	});
}

function _cjv_apply_period(page) {
	const period = page.cj_state.period;
	if (!period || period === "Custom") return;

	let from_date;
	const to_date = frappe.datetime.get_today();

	if (period === "Daily") {
		from_date = frappe.datetime.get_today();
	} else if (period === "Weekly") {
		from_date = frappe.datetime.week_start();
	} else if (period === "Monthly") {
		from_date = frappe.datetime.month_start();
	}

	page.cj_state.from_date = from_date;
	page.cj_state.to_date = to_date;
	page.from_date_field.set_value(from_date);
	page.to_date_field.set_value(to_date);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const CJV_PAGE_LENGTH = 50;

function _cjv_load(page) {
	_cjv_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.completed_journeys.get_completed_journeys",
		args: {
			from_date: page.cj_state.from_date || null,
			to_date: page.cj_state.to_date || null,
			customer: page.cj_state.customer || null,
			page: page.cj_state.page,
			page_length: CJV_PAGE_LENGTH,
		},
		callback(r) {
			_cjv_set_loading(page, false);
			_cjv_render(page, r.message || { customers: [], grand_total: null });
		},
		error() {
			_cjv_set_loading(page, false);
			frappe.show_alert({ message: __("Failed to load completed journeys"), indicator: "red" }, 5);
		},
	});
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _cjv_build_skeleton(page) {
	// page.body IS page.page_form's parent (Frappe's Page class prepends the
	// filter fields into page.body itself) — replacing page.body's whole
	// innerHTML would wipe out the Period/Date/Customer fields added via
	// add_field. Append a dedicated content container instead.
	const $content = $('<div class="cj-page"></div>').appendTo(page.body);
	$content.html(`
		<div class="cj-cards"></div>
		<div class="cj-loading" style="display:none">
			<div class="cj-spinner"></div>
		</div>
	`);

	$(page.body).on("click", ".cj-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.cj_state.page = Number.parseInt($(this).data("page"), 10) || 1;
		_cjv_load(page);
		window.scrollTo({ top: 0, behavior: "smooth" });
	});

	$(page.body).on("click", ".cj-journey-link", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Journey", name);
	});

	$(page.body).on("click", ".cj-export-pdf", function (e) {
		e.preventDefault();
		const idx = $(this).data("idx");
		_cjv_export_pdf(page, idx);
	});

	$(page.body).on("click", ".cj-export-excel", function (e) {
		e.preventDefault();
		const idx = $(this).data("idx");
		_cjv_export_excel(page, idx);
	});

	$(page.body).on("click", ".cj-charges-btn", function () {
		const idx = $(this).data("idx");
		_cjv_show_charges_modal(page, idx);
	});

	$(page.body).on("click", ".cj-generate-so-btn", function () {
		const idx = $(this).data("idx");
		_cjv_generate_sales_order(page, idx);
	});
}

function _cjv_render(page, data) {
	page.cj_data = data;
	const customers = data.customers || [];

	_cjv_render_overview(page, customers, data.grand_total);

	if (!customers.length) {
		const st = page.cj_state;
		const from = st.from_date ? frappe.datetime.str_to_user(st.from_date) : "…";
		const to = st.to_date ? frappe.datetime.str_to_user(st.to_date) : "…";
		const message = st.customer
			? __('No completed journeys found for "{0}" between {1} and {2}.', [frappe.utils.escape_html(st.customer), from, to])
			: __("No completed journeys found between {0} and {1}.", [from, to]);
		$(page.body).find(".cj-cards").html(`<div class="cj-empty">${message}</div>`);
		return;
	}

	let cardsHtml = "";
	let summaryHtml = "";

	if (customers.length === 1) {
		// One customer: their detailed card (summary, charges, Sales Order, export).
		cardsHtml = _cjv_customer_card_html(customers[0], 0);
	} else {
		// All (or several customers): one list of the seal journeys, with the
		// grand-total summary below it.
		let g = data.grand_total;
		summaryHtml = g ? _cjv_summary_cards_html(g, customers.length, false) : "";
		cardsHtml = _cjv_all_journeys_html(data);
	}

	$(page.body).find(".cj-cards").html(cardsHtml + summaryHtml);
}

// One table of the seal journeys across the matching customers, a page of
// CJV_PAGE_LENGTH at a time (the server pages it).
function _cjv_all_journeys_html(data) {
	const esc = frappe.utils.escape_html;
	const journeys = data.rows || [];
	if (!journeys.length) {
		return `<div class="cj-empty">${__("No completed journeys found for the selected filters.")}</div>`;
	}
	const rows = journeys
		.map((j) =>
			_cjv_journey_row_html(j).replace(/<tr[^>]*>/, (tr) => `${tr}<td class="cj-col-customer">${esc(j.customer)}</td>`)
		)
		.join("");
	return `
		<section class="cj-card">
			<div class="cj-table-wrap">
				<table class="cj-table">
					<thead>
						<tr>
							<th>${__("Customer")}</th>
							<th>${__("Journey")}</th>
							<th>${__("Container/Truck #")}</th>
							<th>${__("Origin")}</th>
							<th>${__("Destination")}</th>
							<th>${__("Tagging Date")}</th>
							<th>${__("Arrival Date")}</th>
							<th>${__("Un-tagging Date")}</th>
							<th class="cj-col-seal">${__("Seal Number")}</th>
							<th>${__("File Number")}</th>
							<th>${__("Hours/Days Taken")}</th>
							<th>${__("Contact Person")}</th>
							<th class="cj-col-departure">${__("Departure Card #")}</th>
							<th class="cj-col-retrieval">${__("Retrieval Card #")}</th>
							<th class="cj-col-amount">${__("Amount")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
			${_cjv_all_journeys_pagination(data)}
		</section>
	`;
}

function _cjv_all_journeys_pagination(data) {
	const total = data.total_journeys || 0;
	const size = data.page_length || CJV_PAGE_LENGTH;
	const pages = Math.max(1, Math.ceil(total / size));
	const current = Math.min(data.page || 1, pages);
	const first = total ? (current - 1) * size + 1 : 0;
	const last = Math.min(current * size, total);
	return `
		<div class="cj-pagination">
			<span>${__("Showing {0}-{1} of {2}", [first, last, total])}</span>
			<div>
				<button class="cj-page-btn" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>${__("Previous")}</button>
				<b>${__("Page {0} of {1}", [current, pages])}</b>
				<button class="cj-page-btn" data-page="${current + 1}" ${current >= pages ? "disabled" : ""}>${__("Next")}</button>
			</div>
		</div>
	`;
}

function _cjv_render_overview(page, customers, grand_total) {
	const totalJourneys = customers.reduce((sum, c) => sum + c.journey_count, 0);
	const summary = grand_total || (customers[0] && customers[0].summary) || {};
	const totalPayable = summary.total_payable || 0;
	const currencyNote = summary.mixed_currency ? ` <span class="cj-muted">(${__("mixed currencies")})</span>` : "";

	const html = `
		<div class="cj-stat-card">
			<div class="cj-stat-label">${__("Customers")}</div>
			<div class="cj-stat-value">${customers.length}</div>
		</div>
		<div class="cj-stat-card cj-stat--teal">
			<div class="cj-stat-label">${__("Completed Journeys")}</div>
			<div class="cj-stat-value">${totalJourneys}</div>
		</div>
		<div class="cj-stat-card cj-stat--green">
			<div class="cj-stat-label">${__("Total")}</div>
			<div class="cj-stat-value">${format_currency(totalPayable, summary.currency)}${currencyNote}</div>
		</div>
	`;
	if (page.cj_stats_bar) {
		page.cj_stats_bar.html(html);
	}
}

function _cjv_customer_card_html(c, idx) {
	const esc = frappe.utils.escape_html;
	const rows = c.journeys.map(_cjv_journey_row_html).join("");
	const is_all_billed = c.journeys.length > 0 && c.journeys.every(j => j.sales_order_reference);
	const btn_so = is_all_billed
		? `<button class="cj-generate-so-btn" disabled style="background-color: #cbd5e1; color: #64748b; border: 1px solid #cbd5e1; cursor: not-allowed; pointer-events: none;">${__("Billed")}</button>`
		: `<button class="cj-generate-so-btn" data-idx="${idx}">${__("Generate Sales Order")}</button>`;

	return `
		<section class="cj-card" id="cj-card-${idx}">
			<header class="cj-card-header">
				<div class="cj-card-title">
					<span class="cj-card-customer">${esc(c.customer)}</span>
					<span class="cj-badge">${c.journey_count} ${c.journey_count === 1 ? __("journey") : __("journeys")}</span>
					<span class="cj-card-days">${__("{0} days total", [_cjv_flt_display(c.total_days_taken)])}</span>
				</div>
				<div class="cj-card-actions">
					${btn_so}
					<button class="cj-charges-btn" data-idx="${idx}">${__("Charges")}</button>
					<div class="dropdown" style="display: inline-block;">
						<button class="cj-print-btn dropdown-toggle" data-toggle="dropdown" aria-expanded="false">${__("Export")}</button>
						<ul class="dropdown-menu dropdown-menu-right">
							<li><a class="dropdown-item cj-export-pdf" data-idx="${idx}" href="#">${__("PDF")}</a></li>
							<li><a class="dropdown-item cj-export-excel" data-idx="${idx}" href="#">${__("Excel")}</a></li>
						</ul>
					</div>
				</div>
			</header>

			${c.journeys.length ? `
			<div class="cj-table-wrap">
				<table class="cj-table">
					<thead>
						<tr>
							<th>${__("Journey")}</th>
							<th>${__("Container/Truck #")}</th>
							<th>${__("Origin")}</th>
							<th>${__("Destination")}</th>
							<th>${__("Tagging Date")}</th>
							<th>${__("Arrival Date")}</th>
							<th>${__("Un-tagging Date")}</th>
							<th class="cj-col-seal">${__("Seal Number")}</th>
							<th>${__("File Number")}</th>
							<th>${__("Hours/Days Taken")}</th>
							<th>${__("Contact Person")}</th>
							<th class="cj-col-departure">${__("Departure Card #")}</th>
							<th class="cj-col-retrieval">${__("Retrieval Card #")}</th>
							<th class="cj-col-amount">${__("Amount")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>` : `<div class="cj-no-journeys">${__("No completed journeys in this period — recurring subscription fee only.")}</div>`}

			<div class="cj-card-charges-section" style="display: none;">
				${_cjv_recurring_html(c.recurring_fees)}
				${_cjv_summary_html(c.summary)}
			</div>
		</section>
	`;
}

function _cjv_recurring_html(fees) {
	if (!fees || !fees.length) return "";
	const rows = fees.map((f) => `
		<div class="cj-recurring-row">
			<span class="cj-recurring-label">
				${frappe.utils.escape_html(f.label)}
				<span class="cj-recurring-meta">${f.seal_count} ${f.seal_count === 1 ? __("seal") : __("seals")} × ${format_currency(f.rate, f.currency)} / ${__(f.billing_interval)}</span>
			</span>
			<span>${format_currency(f.amount, f.currency)}</span>
		</div>
	`).join("");
	return `
		<div class="cj-recurring">
			<div class="cj-recurring-title">${__("Recurring Subscription Fees")}</div>
			${rows}
		</div>
	`;
}

function _cjv_journey_row_html(j) {
	const esc = frappe.utils.escape_html;
	const dash = `<span class="cj-muted">—</span>`;
	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : dash);

	let journey_cell = `<span class="cj-journey-link" data-name="${esc(j.name)}">${esc(j.name)}</span>`;
	if (j.sales_order_reference) {
		journey_cell += `
			<div class="cj-so-ref" style="font-size: 10px; margin-top: 3px; white-space: nowrap;">
				<span class="indicator green" style="padding: 1px 4px; font-size: 9px; font-weight: bold; border-radius: 3px; background-color: #d1fae5; color: #065f46; display: inline-block; margin-right: 4px;">${__("Billed")}</span>
				<a href="/app/sales-order/${esc(j.sales_order_reference)}" style="color: #059669; font-weight: bold; text-decoration: underline;">${esc(j.sales_order_reference)}</a>
			</div>
		`;
	}

	return `
		<tr>
			<td>${journey_cell}</td>
			<td>${j.container_number ? esc(j.container_number) : dash}</td>
			<td>${j.origin ? esc(j.origin) : dash}</td>
			<td>${j.destination ? esc(j.destination) : dash}</td>
			<td>${dt(j.tagging_date_time)}</td>
			<td>${dt(j.arrival_date_time)}</td>
			<td>${dt(j.untagging_completed_date_time)}</td>
			<td class="cj-col-seal">${j.seal_number ? esc(j.seal_number) : dash}</td>
			<td>${j.file_number ? esc(j.file_number) : dash}</td>
			<td>${j.days_taken_display ? esc(j.days_taken_display) : dash}</td>
			<td>${j.contact_person_name ? esc(j.contact_person_name) : dash}</td>
			<td class="cj-col-departure">${j.departure_card_number ? esc(j.departure_card_number) : dash}</td>
			<td class="cj-col-retrieval">${j.retrieval_card_number ? esc(j.retrieval_card_number) : dash}</td>
			<td class="cj-col-amount">${format_currency(j.total_charge || 0, j.currency)}</td>
		</tr>
	`;
}

function _cjv_summary_html(s) {
	const pct = Math.round((s.vat_rate || 0) * 100);
	const vatLabel = s.mixed_vat_rates ? __("VAT") : __("VAT @{0}%", [pct]);
	const taxLabel =
		s.tax_category && s.tax_category !== "Normal Tax (16% VAT)" ? ` (${__(s.tax_category)})` : "";
	const hasJourneyCharges = (s.normal_charges || 0) !== 0 || (s.extra_charges || 0) !== 0 || (s.journey_total || 0) !== 0;
	const hasExtraBilling = (s.extra_billing_total || 0) !== 0;
	const hasRecurring = (s.recurring_total || 0) !== 0;
	// Snapshotted per-journey currency (Seal Journey.currency) — None when the
	// customer's journeys/recurring fees in this period were billed in more
	// than one currency (their billing currency changed mid-period).
	const cur = s.currency;
	const mixedNote = s.mixed_currency
		? `<div class="cj-summary-row"><span class="cj-muted">${__("Mixed currencies in this period — amounts shown unconverted")}</span></div>`
		: "";

	const journeyRows = hasJourneyCharges ? `
		<div class="cj-summary-row">
			<span>${__("Normal Charges")}</span>
			<span>${format_currency(s.normal_charges, cur)}</span>
		</div>
		<div class="cj-summary-row">
			<span>${__("Extra Charges for Extra Days")}</span>
			<span>${format_currency(s.extra_charges, cur)}</span>
		</div>
	` : "";

	// Scenario 6 — an additional leasing charge for seals leased beyond an
	// outright-purchase customer's owned pool, computed per journey at tagging
	// (see billing.resolve_customer_extra_billing / seal_journey.set_extra_billing).
	// Split into base (first period) vs extra-days, same distinction as the
	// Normal/Extra Charges rows above, instead of one lump amount.
	const hasExtraBillingExtraDays = (s.extra_billing_extra_day_total || 0) !== 0;
	const extraBillingRow = hasExtraBilling ? `
		<div class="cj-summary-row">
			<span>${__("Extra Billing (leased seals)")}</span>
			<span>${format_currency(s.extra_billing_base, cur)}</span>
		</div>
		${hasExtraBillingExtraDays ? `
		<div class="cj-summary-row">
			<span>${__("Extra Billing - Extra Days")}</span>
			<span>${format_currency(s.extra_billing_extra_day_total, cur)}</span>
		</div>
		` : ""}
	` : "";

	const recurringRow = hasRecurring ? `
		<div class="cj-summary-row">
			<span>${__("Recurring Subscription Fees")}</span>
			<span>${format_currency(s.recurring_total, cur)}</span>
		</div>
	` : "";

	// Computation = Compound (Set Billing modal, Non-Flat Rate Subscription):
	// each journey's own charge was zeroed at billing time — this is the one
	// batched amount for the whole period (days summed, divided by First
	// Period Days, rounded up, times First Period Amount).
	const hasCompound = (s.compound_charges || 0) !== 0;
	const compoundRow = hasCompound ? `
		<div class="cj-summary-row">
			<span>${__("Compound Billing ({0} seal-days)", [cint(s.compound_days)])}</span>
			<span>${format_currency(s.compound_charges, cur)}</span>
		</div>
	` : "";

	return `
		<div class="cj-summary">
			${journeyRows}
			${extraBillingRow}
			${recurringRow}
			${compoundRow}
			<div class="cj-summary-row cj-summary-row--total">
				<span>${__("Total Cost")}</span>
				<span>${format_currency(s.total_cost, cur)}</span>
			</div>
			<div class="cj-summary-row">
				<span>${vatLabel}${taxLabel}</span>
				<span>${format_currency(s.vat, cur)}</span>
			</div>
			<div class="cj-summary-row cj-summary-row--payable">
				<span>${__("Total Payable")}</span>
				<span>${format_currency(s.total_payable, cur)}</span>
			</div>
			${mixedNote}
		</div>
	`;
}

function _cjv_summary_cards_html(g, customerCount, isDrillDown) {
	if (!g) return "";

	const pct = Math.round((g.vat_rate || 0) * 100);
	const vatLabel = g.mixed_vat_rates ? __("VAT") : __("VAT @{0}%", [pct]);
	const taxLabel = g.tax_category && g.tax_category !== "Normal Tax (16% VAT)" ? ` (${__(g.tax_category)})` : "";
	const cur = g.currency;

	const title = isDrillDown ? __("Customer Summary") : __("Grand Total Summary");
	const badge = isDrillDown
		? __("{0} journeys", [g.journey_count])
		: __("{0} customers, {1} journeys", [customerCount, g.journey_count]);

	return `
		<div class="cj-summary-cards-container">
			<div class="cj-summary-cards-header">
				<div class="cj-card-title">
					<span class="cj-card-customer">${title}</span>
					<span class="cj-badge">${badge}</span>
					${g.mixed_currency ? `<span class="cj-badge">${__("Mixed currencies — unconverted")}</span>` : ""}
				</div>
			</div>
			<div class="cj-summary-cards-grid">
				<section class="cj-summary-card">
					<div class="cj-summary-card-title">${__("Journeys")}</div>
					<div class="cj-summary-row">
						<span>${__("Normal Charges")}</span>
						<span>${format_currency(g.normal_charges || 0, cur)}</span>
					</div>
					<div class="cj-summary-row">
						<span>${__("Extra Charges for Extra Days")}</span>
						<span>${format_currency(g.extra_charges || 0, cur)}</span>
					</div>
				</section>
				<section class="cj-summary-card">
					<div class="cj-summary-card-title">${__("Subscriptions & Extras")}</div>
					<div class="cj-summary-row">
						<span>${__("Recurring Subscription Fees")}</span>
						<span>${format_currency(g.recurring_total || 0, cur)}</span>
					</div>
					<div class="cj-summary-row">
						<span>${__("Extra Billing (leased seals)")}</span>
						<span>${format_currency(g.extra_billing_base || 0, cur)}</span>
					</div>
					${(g.extra_billing_extra_day_total || 0) !== 0 ? `
					<div class="cj-summary-row">
						<span>${__("Extra Billing - Extra Days")}</span>
						<span>${format_currency(g.extra_billing_extra_day_total || 0, cur)}</span>
					</div>
					` : ""}
					${(g.compound_charges || 0) !== 0 ? `
					<div class="cj-summary-row">
						<span>${__("Compound Billing")}</span>
						<span>${format_currency(g.compound_charges || 0, cur)}</span>
					</div>
					` : ""}
				</section>
				<section class="cj-summary-card cj-summary-card--total">
					<div class="cj-summary-card-title">${__("Total Payable")}</div>
					<div class="cj-summary-row">
						<span>${__("Total Cost")}</span>
						<span>${format_currency(g.total_cost || 0, cur)}</span>
					</div>
					<div class="cj-summary-row">
						<span>${vatLabel}${taxLabel}</span>
						<span>${format_currency(g.vat || 0, cur)}</span>
					</div>
					<div class="cj-summary-row cj-summary-row--payable">
						<span>${__("Total Payable")}</span>
						<span>${format_currency(g.total_payable || 0, cur)}</span>
					</div>
				</section>
			</div>
		</div>
	`;
}

function _cjv_export_pdf(page, idx) {
	const c = (page.cj_data.customers || [])[idx];
	if (!c) return;

	const $cardClone = $(page.body).find(`#cj-card-${idx}`).clone();
	$cardClone.find(".cj-col-seal, .cj-col-departure, .cj-col-retrieval").remove();
	const cardHtml = $cardClone.prop("outerHTML");
	const from_date_str = page.cj_state.from_date ? frappe.datetime.str_to_user(page.cj_state.from_date) : "";
	const to_date_str = page.cj_state.to_date ? frappe.datetime.str_to_user(page.cj_state.to_date) : "";
	let date_range = from_date_str && to_date_str ? `${from_date_str} to ${to_date_str}` : (from_date_str || to_date_str);
	if (!date_range) date_range = frappe.datetime.str_to_user(frappe.datetime.get_today());

	const html = `
		<html>
			<head>
				<title>${frappe.utils.escape_html(c.customer)} — ${__("Completed Journeys")}</title>
				<style>${_cjv_print_styles()}</style>
			</head>
			<body>
				<h2>${frappe.utils.escape_html(c.customer)}</h2>
				<p class="cj-print-meta">${__("Completed Journeys Statement")} — ${date_range}</p>
				${cardHtml}
			</body>
		</html>
	`;

	open_url_post("/api/method/tnt_seal_management.tnt_seal_management.api.completed_journeys.export_pdf", {
		html: html,
		filename: `${c.customer} - Completed Journeys`
	});
}

function _cjv_show_charges_modal(page, idx) {
	const c = (page.cj_data.customers || [])[idx];
	if (!c) return;

	const html = `
		<div class="cj-modal-charges cj-page" style="padding: 0; background: transparent;">
			${_cjv_recurring_html(c.recurring_fees)}
			${_cjv_summary_html(c.summary)}
		</div>
	`;

	const dialog = new frappe.ui.Dialog({
		title: __("Charges Summary — {0}", [frappe.utils.escape_html(c.customer)]),
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "charges_html",
				options: html
			}
		]
	});

	dialog.show();
}

function _cjv_export_excel(page, idx) {
	const c = (page.cj_data.customers || [])[idx];
	if (!c) return;
	
	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : "");
	const num = (v) => (v ? (Math.round(v * 100) / 100) : 0);

	const data = [
		["Customer", c.customer],
		["Total Journeys", c.journey_count],
		["Total Days Taken", num(c.total_days_taken)],
		[],
		["Journey", "Container/Truck #", "Origin", "Destination", "Tagging Date", "Arrival Date", "Un-tagging Date", "Seal Number", "File Number", "Hours/Days Taken", "Contact Person", "Departure Card #", "Retrieval Card #", "Amount"]
	];

	c.journeys.forEach(j => {
		data.push([
			j.name, j.container_number, j.origin, j.destination,
			dt(j.tagging_date_time), dt(j.arrival_date_time), dt(j.untagging_completed_date_time),
			j.seal_number, j.file_number, j.days_taken_display,
			j.contact_person_name, j.departure_card_number, j.retrieval_card_number,
			num(j.total_charge)
		]);
	});

	data.push([]);
	data.push(["Summary"]);
	if (c.recurring_fees && c.recurring_fees.length) {
		data.push(["Recurring Subscription Fees"]);
		c.recurring_fees.forEach(f => {
			data.push([f.label, num(f.amount)]);
		});
	}

	data.push(["Normal Charges", num(c.summary.normal_charges)]);
	data.push(["Extra Charges for Extra Days", num(c.summary.extra_charges)]);
	if (num(c.summary.extra_billing_base)) {
		data.push(["Extra Billing (leased seals)", num(c.summary.extra_billing_base)]);
	}
	if (num(c.summary.extra_billing_extra_day_total)) {
		data.push(["Extra Billing - Extra Days", num(c.summary.extra_billing_extra_day_total)]);
	}
	if (num(c.summary.recurring_total)) {
		data.push(["Recurring Subscription Fees", num(c.summary.recurring_total)]);
	}
	data.push(["Total Cost", num(c.summary.total_cost)]);
	
	const pct = Math.round((c.summary.vat_rate || 0) * 100);
	let vatLabel = c.summary.mixed_vat_rates ? "VAT" : `VAT @${pct}%`;
	const taxLabel = c.summary.tax_category && c.summary.tax_category !== "Normal Tax (16% VAT)" ? ` (${__(c.summary.tax_category)})` : "";
	vatLabel += taxLabel;
	data.push([vatLabel, num(c.summary.vat)]);
	data.push(["Total Payable", num(c.summary.total_payable)]);

	open_url_post("/api/method/tnt_seal_management.tnt_seal_management.api.completed_journeys.export_xlsx", {
		data: JSON.stringify(data),
		filename: `${c.customer} - Completed Journeys`
	});
}

function _cjv_generate_sales_order(page, idx) {
	const c = (page.cj_data.customers || [])[idx];
	if (!c) return;

	frappe.confirm(__("Generate Sales Order for {0}?", [frappe.utils.escape_html(c.customer)]), () => {
		_cjv_set_loading(page, true);
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.completed_journeys.generate_sales_order",
			args: {
				customer: c.customer,
				from_date: page.cj_state.from_date || null,
				to_date: page.cj_state.to_date || null,
			},
			callback(r) {
				_cjv_set_loading(page, false);
				if (r.message) {
					frappe.msgprint({
						title: __("Success"),
						indicator: "green",
						message: __("Sales Order <a href='/app/sales-order/{0}'><b>{0}</b></a> created successfully.", [r.message])
					});
					_cjv_load(page);
				}
			},
			error() {
				_cjv_set_loading(page, false);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _cjv_flt_display(value) {
	return (Math.round((value || 0) * 100) / 100).toString();
}

function _cjv_set_loading(page, on) {
	$(page.body).find(".cj-loading").toggle(on);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function _cjv_print_styles() {
	return `
		body { font-family: sans-serif; padding: 24px; color: #1e293b; }
		h2 { margin-bottom: 2px; }
		.cj-print-meta { color: #64748b; margin-top: 0; margin-bottom: 20px; }
		.cj-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
		.cj-card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #f1f5f9; }
		.cj-card-actions { display: none; }
		.cj-card-charges-section { display: block !important; }
		.cj-badge { background: #e2e8f0; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin-left: 8px; }
		.cj-card-days { color: #0369a1; font-size: 12px; font-weight: 700; margin-left: 8px; }
		.cj-table { width: 100%; border-collapse: collapse; font-size: 11px; }
		.cj-table th, .cj-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
		.cj-table th { background: #f8fafc; }
		.cj-col-amount { text-align: right; }
		.cj-summary { padding: 12px 16px; max-width: 320px; margin-left: auto; }
		.cj-summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
		.cj-summary-row--total { border-top: 1px solid #cbd5e1; font-weight: 700; }
		.cj-summary-row--payable { background: #0f172a; color: #fff; font-weight: 800; padding: 8px 10px; margin-top: 4px; border-radius: 4px; }
	`;
}

function _cjv_inject_styles() {
	if (document.getElementById("cj-completed-journeys-styles")) return;
	const style = document.createElement("style");
	style.id = "cj-completed-journeys-styles";
	style.textContent = `
		.cj-page {
			--cj-blue: #0284c7;
			--cj-dark: #075985;
			max-width: 1480px;
			margin: 0 auto;
			padding: 24px 24px 48px;
			font-family: var(--font-stack);
			position: relative;
		}

		/* ---- compact header stats bar (injected into Frappe page-head) ---- */
		.cj-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.cj-header-stats .cj-stat-card {
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
		.cj-header-stats .cj-stat--teal { border-top-color: #0d9488; }
		.cj-header-stats .cj-stat--green { border-top-color: #16a34a; }
		.cj-header-stats .cj-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.cj-header-stats .cj-stat-value {
			color: #0c4a6e;
			font-size: 16px;
			font-weight: 900;
			line-height: 1;
		}

		.cj-cards {
			display: flex;
			flex-direction: column;
			gap: 20px;
		}
		.cj-card {
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.cj-card--grand {
			border-color: var(--cj-blue);
			border-width: 2px;
		}
		.cj-card-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 10px;
			padding: 16px 20px;
			background: #f0f9ff;
			border-bottom: 1px solid #e0f2fe;
		}
		.cj-card-title {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.cj-card-customer {
			font-size: 16px;
			font-weight: 800;
			color: var(--cj-blue);
		}
		.cj-badge {
			display: inline-flex;
			align-items: center;
			padding: 4px 11px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #075985;
			font-size: 11px;
			font-weight: 800;
		}
		.cj-card-actions {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.cj-card-days {
			display: inline-flex;
			align-items: center;
			padding: 4px 11px;
			border-radius: 999px;
			background: #f1f5f9;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
		}
		.cj-print-btn, .cj-charges-btn, .cj-generate-so-btn {
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--cj-dark);
			padding: 7px 15px;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			transition: border-color .15s;
		}
		.cj-charges-btn, .cj-generate-so-btn {
			border-color: #0284c7;
			background: #f0f9ff;
			color: #0369a1;
		}
		.cj-generate-so-btn {
			background: #0ea5e9;
			color: #fff;
			border-color: #0284c7;
		}
		.cj-generate-so-btn:hover {
			background: #0284c7;
		}
		.cj-print-btn:hover, .cj-charges-btn:hover { border-color: var(--cj-blue); }
		/* Fixed-height scroll area: long journey lists scroll inside the card with
		   the column headings pinned, instead of stretching the page. */
		.cj-table-wrap {
			overflow: auto;
			max-height: 60vh;
		}
		.cj-table {
			width: 100%;
			min-width: 1400px;
			border-collapse: collapse;
		}
		.cj-table th, .cj-table td {
			padding: 14px 16px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			font-size: 14px;
			line-height: 1.45;
			white-space: nowrap;
			color: var(--text-color, #334155);
		}
		.cj-table th {
			position: sticky;
			top: 0;
			z-index: 2;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.cj-col-amount { text-align: right; }
		.cj-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.cj-pagination div { display: flex; align-items: center; gap: 9px; }
		.cj-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.cj-page-btn:disabled { cursor: default; opacity: .45; }
		[data-theme="dark"] .cj-pagination { background: #0f172a; color: #7dd3fc; }
		[data-theme="dark"] .cj-page-btn { background: #1e293b; border-color: #334155; color: #cbd5e1; }
		.cj-journey-link {
			color: var(--cj-blue);
			cursor: pointer;
			font-weight: 700;
		}
		.cj-journey-link:hover { text-decoration: underline; }
		.cj-muted { color: #94a3b8; }
		.cj-no-journeys {
			padding: 18px 20px;
			color: #64748b;
			font-size: 13px;
			font-style: italic;
			border-bottom: 1px solid #e0f2fe;
		}
		.cj-recurring {
			padding: 14px 20px 4px;
			border-top: 1px dashed #bae6fd;
		}
		.cj-recurring-title {
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .06em;
			text-transform: uppercase;
			color: #0369a1;
			margin-bottom: 8px;
		}
		.cj-recurring-row {
			display: flex;
			justify-content: space-between;
			align-items: baseline;
			gap: 12px;
			padding: 5px 4px;
			font-size: 13px;
			color: var(--text-color, #334155);
		}
		.cj-recurring-label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-weight: 600;
		}
		.cj-recurring-meta {
			font-size: 11px;
			font-weight: 500;
			color: #64748b;
		}
		.cj-summary {
			max-width: 340px;
			margin: 0 0 0 auto;
			padding: 16px 20px 20px;
		}
		.cj-summary-row {
			display: flex;
			justify-content: space-between;
			padding: 5px 4px;
			font-size: 13px;
			color: var(--text-color, #334155);
		}
		.cj-summary-row--total {
			border-top: 1px solid #bae6fd;
			margin-top: 4px;
			padding-top: 8px;
			font-weight: 700;
			color: #0c4a6e;
		}
		.cj-summary-row--payable {
			background: var(--cj-dark);
			color: #fff;
			font-weight: 800;
			padding: 10px 12px;
			margin-top: 6px;
			border-radius: 10px;
		}
		.cj-empty {
			padding: 60px 20px;
			text-align: center;
			color: #64748b;
			font-size: 15px;
			border: 1px dashed #bae6fd;
			border-radius: 22px;
		}
		.cj-summary-cards-container {
			border: 1px solid #bae6fd;
			border-radius: 12px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
			margin-top: 16px;
		}
		.cj-summary-cards-header {
			padding: 10px 16px;
			background: #f0f9ff;
			border-bottom: 1px solid #e0f2fe;
			display: flex;
			align-items: center;
			justify-content: space-between;
		}
		.cj-summary-cards-grid {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 12px;
			padding: 12px 16px;
		}
		.cj-summary-card {
			background: #f8fafc;
			border: 1px solid #e2e8f0;
			border-radius: 10px;
			padding: 10px 14px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		.cj-summary-card--total {
			background: #f0f9ff;
			border-color: #bae6fd;
		}
		.cj-summary-card-title {
			font-size: 12px;
			font-weight: 800;
			color: #0369a1;
			text-transform: uppercase;
			letter-spacing: .05em;
			margin-bottom: 6px;
			border-bottom: 1px solid rgba(14, 165, 233, 0.2);
			padding-bottom: 4px;
		}
		.cj-loading {
			position: absolute;
			inset: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(240, 249, 255, .72);
			backdrop-filter: blur(2px);
		}
		.cj-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--cj-blue);
			border-radius: 50%;
			animation: cj-spin .7s linear infinite;
		}
		@keyframes cj-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .cj-card,
		[data-theme="dark"] .cj-header-stats .cj-stat-card {
			background: #1e293b;
			border-color: #334155;
		}
		[data-theme="dark"] .cj-card-header,
		[data-theme="dark"] .cj-table th {
			background: rgba(14, 116, 144, .18);
			border-color: #334155;
		}
		[data-theme="dark"] .cj-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .cj-badge { background: #334155; color: #e0f2fe; }
		[data-theme="dark"] .cj-loading { background: rgba(15, 23, 42, .65); }
		[data-theme="dark"] .cj-summary-row--payable { background: #0284c7; color: #fff; }
		[data-theme="dark"] .cj-summary-cards-container {
			background: #1e293b;
			border-color: #0284c7;
		}
		[data-theme="dark"] .cj-summary-cards-header {
			background: rgba(14, 116, 144, .18);
			border-color: #334155;
		}
		[data-theme="dark"] .cj-summary-card {
			background: #0f172a;
			border-color: #334155;
		}
		[data-theme="dark"] .cj-summary-card--total {
			background: rgba(2, 132, 199, 0.1);
			border-color: #0284c7;
		}
		@media (max-width: 900px) {
			.cj-summary { max-width: 100%; }
			.cj-summary-cards-grid {
				grid-template-columns: 1fr;
			}
		}
	`;
	document.head.appendChild(style);
}
