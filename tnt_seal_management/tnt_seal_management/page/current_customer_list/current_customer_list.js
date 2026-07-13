// Maps Billing Period Type (Seal Billing Rate's own vocabulary — Weekly,
// Monthly, Quarterly, Semi-Annually, Annually, Date Range, Days) to the
// billing_interval values the Recurring Lease Fee Subscription understands
// (see INTERVAL_MAP in api/seal_lease_billing.py). Date Range/Days describe a
// per-journey period, not a recurring cadence, so they have no entry here —
// _customer_collect_lease_args treats that as "can't activate the recurring
// fee on this cycle" rather than guessing one.
const BILLING_PERIOD_TO_LEASE_INTERVAL = {
	Weekly: "Week",
	Monthly: "Month",
	Quarterly: "Quarter",
	"Semi-Annually": "Semi-Annual",
	Annually: "Year",
};

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
		can_create_customer: false,
		can_edit_billing: false,
	};

	page.add_inner_button(__("Back"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _customer_load(page));

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
	$(page.body).on("click", ".ccl-portal-access-btn", function (event) {
		event.stopPropagation();
		const customer = $(this).data("customer");
		if (customer) _customer_grant_portal_access(page, customer);
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
			const perms = data.permissions || {};
			page.customer_state.can_create_customer = !!perms.can_create_customer;
			page.customer_state.can_edit_billing = !!perms.can_edit_billing;
			page.customer_state.can_grant_portal_access = !!perms.can_grant_portal_access;
			_customer_apply_permissions(page);
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

function _customer_apply_permissions(page) {
	if (page.customer_state.can_create_customer) {
		page.set_primary_action(__("New Customer"), () => frappe.new_doc("Customer"));
		return;
	}

	$(page.wrapper).find(".page-actions .btn-primary").remove();
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
					<th>${__("Portal Access")}</th>
				</tr>
			</thead>
			<tbody>${customers.map((customer) => _customer_row_html(page, customer)).join("")}</tbody>
		</table>
	`);
}

function _customer_row_html(page, customer) {
	const status = customer.disabled ? __("Disabled") : __("Active");
	const statusClass = customer.disabled ? "disabled" : "active";
	return `
		<tr class="ccl-row" data-name="${frappe.utils.escape_html(customer.name)}">
			<td>
				<div class="ccl-name-wrap">
					<span class="ccl-name">${frappe.utils.escape_html(customer.customer_name || customer.name)}</span>
				</div>
			</td>
			<td>${_customer_billing_button_html(page, customer)}</td>
			<td>${frappe.utils.escape_html(customer.mobile_no || "—")}</td>
			<td>${frappe.utils.escape_html(customer.email_id || "—")}</td>
			<td><span class="ccl-badge ccl-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
			<td>${_customer_portal_access_button_html(page, customer)}</td>
		</tr>
	`;
}

function _customer_portal_access_button_html(page, customer) {
	if (!page.customer_state.can_grant_portal_access) return "—";
	return `
		<button class="ccl-portal-access-btn" data-customer="${frappe.utils.escape_html(customer.name)}">
			${__("Grant Portal Access")}
		</button>
	`;
}

function _customer_billing_button_html(page, customer) {
	const hasRule = !!customer.billing_label;
	const kind = (customer.billing_kind || "").toLowerCase();
	const kindClass = hasRule ? ` ccl-billing-btn--set ccl-billing-btn--${kind}` : "";
	const label = hasRule
		? frappe.utils.escape_html(customer.billing_label)
		: __("Set billing");
	const tag = hasRule && customer.billing_kind
		? `<span class="ccl-billing-tag">${frappe.utils.escape_html(customer.billing_kind)}</span>`
		: "";

	if (!page.customer_state.can_edit_billing) {
		return `
			<span class="ccl-billing-btn ccl-billing-readonly" title="${frappe.utils.escape_html(customer.billing_label || __("Billing rule"))}">
				${tag}<span class="ccl-billing-btn__label">${label}</span>
			</span>
		`;
	}

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

// One-click customer registration: reuse (or create) a Contact, invite it as
// a Website User, and add it to Customer.portal_users — see
// grant_customer_portal_access in api/current_customers.py for the full
// Contact → Invite as User → Portal Users chain this replaces.
function _customer_grant_portal_access(page, customer, contactDetails) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.grant_customer_portal_access",
		args: Object.assign({ customer }, contactDetails || {}),
		freeze: true,
		freeze_message: __("Granting portal access…"),
		callback(r) {
			const result = r.message || {};
			if (result.status === "needs_contact_details") {
				_customer_prompt_contact_details(page, customer);
				return;
			}
			frappe.show_alert({ message: result.message, indicator: "green" }, 7);
		},
		error() {
			frappe.show_alert({ message: __("Could not grant portal access"), indicator: "red" }, 5);
		},
	});
}

function _customer_prompt_contact_details(page, customer) {
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
			_customer_grant_portal_access(page, customer, values);
		},
	});
	dialog.show();
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

	// Subscription rules are configured in Seal Billing Rate and picked from a
	// shared list here. Leasing is a private, per-customer contract — there is
	// nothing to pick, so its terms are entered directly below and saved as the
	// customer's own auto-named rule ("<Customer> BR").
	const subscriptionRules = data.subscription_rules || [];
	const subscriptionRuleMap = Object.fromEntries(
		subscriptionRules.map((r) => [r.billing_rule_name || r.name, r])
	);
	const subscriptionRuleOptions = subscriptionRules.map((r) => r.billing_rule_name || r.name);

	const initialType = cur.billing_type || "Subscription";
	const currentLabel =
		cur.billing_type === "Subscription" && cur.rule ? (cur.rule.billing_rule_name || cur.rule.name) : null;
	const currentLeasingTerms = cur.billing_type === "Leasing" ? cur.rule || {} : {};

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
		"extra_customer_period_section",
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
				fieldtype: "Select",
				fieldname: "billing_rule_label",
				label: __("Billing Rule"),
				options: subscriptionRuleOptions,
				default: currentLabel || subscriptionRuleOptions[0] || null,
				depends_on: 'eval:doc.billing_type=="Subscription"',
				mandatory_depends_on: 'eval:doc.billing_type=="Subscription"',
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
				// _customer_load_seat_data.
				fieldtype: "Currency",
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
				// dialog open by _customer_load_seat_data (see its call site below).
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
				description: __(
					"Saved as this customer's own rate — \"{0} BR\".",
					[data.customer_name]
				),
			},
			{
				// Read-only mirror of the picked Billing Rule's period — for a
				// leased-seat rate this doubles as the leasing billing cycle
				// (pick Default Weekly → billed weekly, Default Monthly →
				// monthly), which is why switching the rule is the intended way
				// to change the cycle without touching the seat-based Rate.
				fieldtype: "Select",
				fieldname: "billing_period_type",
				label: __("Billing Period Type"),
				read_only: 1,
				depends_on: 'eval:doc.billing_type=="Subscription"',
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
				fieldname: "first_period_amount",
				label: __("First Period Amount"),
				options: "leasing_currency",
				default: currentLeasingTerms.first_period_amount,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Currency",
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
			// second Customer Billing Assignment via set_customer_extra_billing.
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
				fieldname: "extra_first_period_amount",
				label: __("First Period Amount"),
				options: "extra_currency",
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "extra_col_3", hidden: 1 },
			{
				fieldtype: "Currency",
				fieldname: "extra_extra_day_rate",
				label: __("Extra Day Rate (per day)"),
				options: "extra_currency",
				hidden: 1,
			},
			{
				fieldtype: "Section Break",
				fieldname: "extra_customer_period_section",
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
			_customer_show_recurring_page(dialog, data.customer);
		},
		primary_action_label: __("Save Billing"),
		primary_action() {
			const billingType = dialog.get_value("billing_type");
			const taxCategory = _customer_get_tax_category(dialog);

			const leaseArgs = _customer_collect_lease_args(dialog);
			if (leaseArgs === false) return; // validation failed, message already shown
			const ownershipArgs = _customer_collect_ownership_args(dialog);
			if (ownershipArgs === false) return; // validation failed, message already shown
			const extraArgs = _customer_collect_extra_billing_args(dialog);
			if (extraArgs === false) return; // validation failed, message already shown
			const recurringArgs = { leaseArgs, ownershipArgs, extraArgs };

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
				if (!days || amount === "" || amount === null || extraRate === "" || extraRate === null) {
					frappe.show_alert(
						{ message: __("Enter First Period Days, First Period Amount and Extra Day Rate."), indicator: "red" },
						5
					);
					return;
				}
				if (!_customer_validate_period_bounds(dialog)) return;
				_customer_submit_leasing_billing(
					page,
					data.customer,
					{
						first_period_days: days,
						first_period_amount: amount,
						extra_day_rate: extraRate,
						currency: dialog.get_value("leasing_currency") || "KES",
						period_from_date: dialog.get_value("period_from_date"),
						period_to_date: dialog.get_value("period_to_date"),
						tax_category: taxCategory,
						outright_purchase: outrightPurchase,
						owned_seal_count: outrightPurchase ? ownedSealCount : 0,
					},
					dialog,
					recurringArgs
				);
				return;
			}

			const rule = subscriptionRuleMap[dialog.get_value("billing_rule_label")];
			if (!rule) {
				frappe.show_alert({ message: __("Choose a billing rule."), indicator: "red" }, 5);
				return;
			}
			if (!_customer_validate_period_bounds(dialog)) return;
			_customer_submit_billing(
				page,
				data.customer,
				rule.name,
				billingType,
				dialog.get_value("period_from_date"),
				dialog.get_value("period_to_date"),
				dialog,
				recurringArgs,
				taxCategory,
				// Rate/Currency are editable for Subscription now — the backend
				// only persists these as a per-customer override when they
				// actually differ from the picked rule's own values.
				dialog.get_value("first_period_amount"),
				dialog.get_value("leasing_currency"),
				outrightPurchase,
				outrightPurchase ? ownedSealCount : 0
			);
		},
	});

	// Stashed on the instance so the standalone _customer_show_recurring_page
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

	const getSelectedRuleSource = () => {
		const selectedLabel = dialog.get_value("billing_rule_label");
		const rule = subscriptionRuleMap[selectedLabel];
		// Still on the rule already assigned to this customer? Prefer cur.rule —
		// the backend patches its first_period_amount/currency to this
		// customer's own Rate/Currency override, if one is set (see
		// get_customer_billing). Switching to a *different* rule always shows
		// that rule's own raw values — a fresh pick has no override yet.
		return selectedLabel && selectedLabel === currentLabel && cur.rule ? cur.rule : rule;
	};

	const applySubscriptionRuleDetails = () => {
		const source = getSelectedRuleSource();
		// Billing Period Type always mirrors the picked rule (its read-only
		// display / the leasing billing cycle).
		dialog.set_value("billing_period_type", source ? source.billing_period_type : "");
		dialog.set_value("leasing_currency", source ? source.currency : "");
		dialog.set_value("first_period_days", source ? source.first_period_days : "");
		// first_period_amount (Rate) is owned solely by applySeatBasedRateOverride
		// below — set it in exactly one place so a seat-based product isn't
		// briefly overwritten by the rule's own rate and then lost to the
		// async set_value / is_value_same race.
		dialog.set_value("extra_day_rate", source ? source.extra_day_rate : "");

		// Set the Rate (product when seat-based, else this rule's own rate) —
		// the single writer of first_period_amount for Subscription.
		applySeatBasedRateOverride();
	};

	const applyFieldModeForType = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		// Billing Period Type is always read-only — it mirrors the picked rule
		// (and, for a leased-seat rate, is the leasing billing cycle). Rate and
		// Currency are editable for both billing types (except when seat-based,
		// where applySeatBasedRateOverride locks Rate to the product): for
		// Subscription an edit is saved as a per-customer override on top of the
		// shared rule (see set_customer_billing), for Leasing it's the
		// customer's own private rate.

		// A Subscription rule is a flat recurring rate — the per-journey day-count
		// fields don't apply, so hide First Period Days and Extra Day Rate and
		// relabel the amount to just "Rate". Leasing keeps the full per-journey
		// terms (First Period Days / Amount / Extra Day Rate).
		dialog.set_df_property("first_period_days", "hidden", isSubscription ? 1 : 0);
		dialog.set_df_property("extra_day_rate", "hidden", isSubscription ? 1 : 0);
		dialog.set_df_property(
			"first_period_amount",
			"label",
			isSubscription ? __("Rate") : __("First Period Amount")
		);

		// The "Saved as this customer's own rate" note only applies to Leasing
		// (a private per-customer rate); Subscription just assigns a shared
		// rule, so hide it there. Section descriptions are rendered once at
		// construction (frappe/form/section.js make()) and aren't re-rendered
		// by set_df_property, so the wrapper is toggled directly.
		const rateTermsSection = dialog.fields_dict.rate_terms_section;
		if (rateTermsSection && rateTermsSection.description_wrapper) {
			rateTermsSection.description_wrapper.toggleClass("hide-control", isSubscription);
		}

		if (isSubscription) {
			// Sets the rule fields and, via applySeatBasedRateOverride, the Rate.
			applySubscriptionRuleDetails();
		} else {
			// Leasing: restore this customer's own saved terms rather than
			// whatever a previously-selected Subscription rule copied in.
			dialog.set_value("first_period_days", currentLeasingTerms.first_period_days || "");
			dialog.set_value("first_period_amount", currentLeasingTerms.first_period_amount || "");
			dialog.set_value("extra_day_rate", currentLeasingTerms.extra_day_rate || "");
			dialog.set_value("leasing_currency", currentLeasingTerms.currency || "KES");
			// Reset the Rate read-only flag (seat-based only applies to
			// Subscription); leaves the leasing amount above untouched.
			applySeatBasedRateOverride();
		}

		// Extra Billing tab is Subscription-only — re-evaluate on billing type change.
		dialog.ccl_apply_extra_tab_visibility && dialog.ccl_apply_extra_tab_visibility();
	};

	// Scenarios 4/5 (leased or owned seats): the single writer of
	// first_period_amount (Rate) for a Subscription customer, so it's set
	// exactly once per pass and never lost to the async set_value /
	// is_value_same race. When Number of Seals (Leased or Owned) + its Rate
	// per Seal are both filled, the Rate is the fixed product count × rate —
	// held regardless of which Billing Rule is picked (the rule only sets the
	// cycle, not the amount). Otherwise it falls back to the picked rule's own
	// rate. Leasing (non-Subscription) manages its own rate, so this leaves it
	// untouched there. This is a display preview only — the real per-journey
	// charge is separately zeroed for seat-based customers (see
	// seal_journey.py::set_billing / customer_has_seat_subscription).
	const applySeatBasedRateOverride = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		const seatBasis = isLeaseSeatBased();
		const isSeatBased = !!seatBasis;

		dialog.set_df_property("first_period_amount", "read_only", isSeatBased ? 1 : 0);
		if (isSeatBased) {
			dialog.set_value("first_period_amount", seatBasis.sealCount * seatBasis.ratePerSeal);
		} else if (isSubscription) {
			const source = getSelectedRuleSource();
			dialog.set_value("first_period_amount", source ? source.first_period_amount : "");
		}
	};

	// A customer who owns their seals outright is always Subscription-billed
	// per journey — any leasing for them goes on the Extra Billing tab instead.
	// Ticking Outright Purchase here drops Leasing from Billing Type and, if it
	// was selected, switches back to Subscription.
	const applyBillingTypeOptionsForOwnership = () => {
		const isOutright = !!dialog.get_value("outright_purchase");
		dialog.set_df_property("billing_type", "options", isOutright ? ["Subscription"] : ["Subscription", "Leasing"]);
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
			if (dialog.get_value("owned_rate_per_seal")) dialog.set_value("owned_rate_per_seal", null);
		}
		applySeatBasedRateOverride();
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

	dialog.fields_dict.billing_type.df.onchange = applyFieldModeForType;
	dialog.fields_dict.billing_rule_label.df.onchange = applySubscriptionRuleDetails;
	dialog.fields_dict.outright_purchase.df.onchange = applyBillingTypeOptionsForOwnership;
	// Number of Seals (Leased or Owned) / Rate per Seal drive both the
	// seat-based Rate override (applySeatBasedRateOverride) and Extra Billing
	// tab eligibility (applyExtraBillingTabVisibility, defined below — safe to
	// reference here since this handler only runs later, once both are
	// assigned).
	const applySeatFieldChange = () => {
		applySeatBasedRateOverride();
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
	// extra_customer_period_section both depend on this) re-evaluate on any
	// field change. activate_extra_billing starts `hidden: 1` and only gets
	// its real <input> built later, once _customer_load_extra_billing_data
	// reveals it (well after that listener was bound) — so toggling it never
	// reaches that listener and depends_on never re-runs. Explicit onchange
	// here calls refresh_dependency() directly instead of relying on it.
	dialog.fields_dict.activate_extra_billing.df.onchange = () => dialog.refresh_dependency();

	const taxRadioHtml = taxCategoryOptions
		.map(
			(opt) => `
				<label class="ccl-tax-radio">
					<input type="radio" name="${TAX_RADIO_NAME}" value="${frappe.utils.escape_html(opt.value)}" ${
				opt.value === currentTaxCategory ? "checked" : ""
			} />
					<span>${opt.label}</span>
				</label>
			`
		)
		.join("");
	dialog.fields_dict.tax_category_html.$wrapper.html(
		`<div class="ccl-tax-radio-group">${taxRadioHtml}</div>`
	);

	dialog.fields_dict.recurring_loading_html.$wrapper.html(
		`<div class="ccl-recurring-loading">${__("Loading extra billing details…")}</div>`
	);

	dialog.fields_dict.tab_nav_html.$wrapper.html(`
		<div class="ccl-page-nav">
			<button type="button" class="ccl-page-nav-btn active" data-page="billing">${__("Billing")}</button>
			<button type="button" class="ccl-page-nav-btn" data-page="recurring">${__("Extra Billing")}</button>
		</div>
	`);
	dialog.fields_dict.tab_nav_html.$wrapper.on("click", ".ccl-page-nav-btn", function () {
		const targetPage = $(this).attr("data-page");
		if (targetPage === "recurring") {
			_customer_show_recurring_page(dialog, data.customer);
		} else {
			_customer_switch_dialog_page(dialog, targetPage, BILLING_PAGE_SECTIONS, RECURRING_PAGE_SECTIONS);
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
		const $btn = dialog.$wrapper.find('.ccl-page-nav-btn[data-page="recurring"]');
		$btn.toggle(!!eligible);
		dialog.get_secondary_btn().toggleClass("hide", !eligible);
		if (!eligible && $btn.hasClass("active")) {
			_customer_switch_dialog_page(dialog, "billing", BILLING_PAGE_SECTIONS, RECURRING_PAGE_SECTIONS);
		}
	};
	dialog.ccl_apply_extra_tab_visibility = applyExtraBillingTabVisibility;

	dialog.show();
	applyBillingTypeOptionsForOwnership();
	applyFieldModeForType();
	applyCurrencyFormatting();
	applyExtraBillingTabVisibility();

	// Eagerly load the customer's existing Scenario 4 lease + Scenario 5
	// ownership subscriptions — their fields live on the always-visible
	// Billing page, so they're populated up front. The Extra Billing agreement
	// is loaded lazily (on first visit to the Extra Billing page) because its
	// Select controls only build their <option> list once actually visible —
	// see _customer_load_extra_billing_data.
	_customer_load_seat_data(dialog, data.customer, () => {
		applyBillingTypeOptionsForOwnership();
		applyCurrencyFormatting();
		applyExtraBillingTabVisibility();
		dialog.refresh_sections();
	});
}

function _customer_get_tax_category(dialog) {
	return dialog.$wrapper.find('input[name="ccl_tax_category"]:checked').val() || "Normal Tax (16% VAT)";
}

// Switches the Set Billing modal between its "Billing" and "Recurring Fees"
// pages — a hand-rolled two-pill nav rather than Frappe's "Tab Break"
// fieldtype, which requires a real frm/doctype to build its DOM id and
// crashes inside a plain frappe.ui.Dialog (see the note above the fields
// array). Hiding/showing each page's named sections and re-running
// ``refresh_sections()`` is the same primitive the lease/ownership fields
// already used to reveal themselves in place.
function _customer_switch_dialog_page(dialog, targetPage, billingSections, recurringSections) {
	const showBilling = targetPage !== "recurring";
	billingSections.forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", showBilling ? 0 : 1));
	recurringSections.forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", showBilling ? 1 : 0));
	dialog.refresh_sections();

	dialog.$wrapper.find(".ccl-page-nav-btn").removeClass("active");
	dialog.$wrapper.find(`.ccl-page-nav-btn[data-page="${targetPage}"]`).addClass("active");
}

// Single entry point for landing on the Extra Billing page, used by both the
// nav pill and the "Manage Extra Billing" footer button. Switch page first,
// then (on first visit) reveal a loading placeholder and fetch the agreement —
// loading here rather than at dialog open because the extra fields' Select
// controls only build their <option> list once actually visible.
function _customer_show_recurring_page(dialog, customer) {
	_customer_switch_dialog_page(dialog, "recurring", dialog.ccl_billing_sections, dialog.ccl_recurring_sections);

	if (dialog.extra_data_loaded) return;

	dialog.set_df_property("recurring_loading_html", "hidden", 0);
	dialog.refresh_sections();

	_customer_load_extra_billing_data(dialog, customer, () => {
		dialog.set_df_property("recurring_loading_html", "hidden", 1);
		dialog.refresh_sections();
	});
}

// Loads the customer's Scenario 4 lease + Scenario 5 ownership subscriptions
// into the Billing-page seat fields (seal_ownership_section, always visible)
// — safe to call eagerly at dialog open. Guarded by ``seat_data_loaded``.
function _customer_load_seat_data(dialog, customer, onComplete) {
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
			dialog.set_value("lease_seal_count", info.seal_count || null);
			dialog.set_value("lease_rate_per_seal", info.rate_per_seal || null);
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
			dialog.set_value("owned_rate_per_seal", info.rate_per_seal || null);
			settle();
		},
		error() {
			frappe.show_alert({ message: __("Could not load ownership subscription details"), indicator: "red" }, 5);
			settle();
		},
	});
}

// Loads the customer's Extra Billing agreement and reveals + fills the Extra
// Billing page. Called from _customer_show_recurring_page (page already shown)
// so the reveal-before-set dance below actually renders the Select options.
// Guarded by ``extra_data_loaded``.
function _customer_load_extra_billing_data(dialog, customer, onComplete) {
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
				"extra_customer_period_section",
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

// Reads the (possibly hidden) lease fields off the dialog. Returns null when
// the section was never revealed or was left blank (nothing to save), a
// terms object when filled in, or false on a validation failure (a message
// has already been shown, so the caller should abort the whole save).
function _customer_collect_lease_args(dialog) {
	const seal_count = dialog.get_value("lease_seal_count");
	const rate_per_seal = dialog.get_value("lease_rate_per_seal");
	const hasSealCount = seal_count !== "" && seal_count !== null && seal_count !== undefined;
	const hasRate = rate_per_seal !== "" && rate_per_seal !== null && rate_per_seal !== undefined;

	if (!hasSealCount && !hasRate) return null; // left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Leased and Rate per Seal, or leave both blank."), indicator: "red" },
			6
		);
		return false;
	}

	// The recurring Subscription bills on a cycle — Billing Period Type's
	// per-journey options (Date Range/Days) don't map to one, so a customer
	// on either can't activate it here. They still get the seat-based Rate
	// Terms amount (applySeatBasedRateOverride); only the recurring line is
	// blocked.
	const billingInterval = BILLING_PERIOD_TO_LEASE_INTERVAL[dialog.get_value("billing_period_type")];
	if (!billingInterval) {
		frappe.show_alert(
			{
				message: __(
					"Recurring Lease Fee needs a Billing Period Type of Weekly, Monthly, Quarterly, Semi-Annually or Annually to bill on a cycle — choose one under Rate Terms, or clear Number of Seals Leased / Rate per Seal."
				),
				indicator: "red",
			},
			8
		);
		return false;
	}

	return {
		seal_count,
		rate_per_seal,
		billing_interval: billingInterval,
		currency: dialog.get_value("leasing_currency") || "KES",
	};
}

// Same shape as _customer_collect_lease_args, for the owned side (Scenario 5
// — Ownership Service Fee). Reads owned_seal_count/owned_rate_per_seal
// instead of the leased pair.
function _customer_collect_ownership_args(dialog) {
	const seal_count = dialog.get_value("owned_seal_count");
	const rate_per_seal = dialog.get_value("owned_rate_per_seal");
	const hasSealCount = seal_count !== "" && seal_count !== null && seal_count !== undefined;
	const hasRate = rate_per_seal !== "" && rate_per_seal !== null && rate_per_seal !== undefined;

	if (!hasSealCount && !hasRate) return null; // left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Owned and Rate per Seal (Owned), or leave both blank."), indicator: "red" },
			6
		);
		return false;
	}

	const billingInterval = BILLING_PERIOD_TO_LEASE_INTERVAL[dialog.get_value("billing_period_type")];
	if (!billingInterval) {
		frappe.show_alert(
			{
				message: __(
					"Ownership Service Fee needs a Billing Period Type of Weekly, Monthly, Quarterly, Semi-Annually or Annually to bill on a cycle — choose one under Rate Terms, or clear Number of Seals Owned / Rate per Seal (Owned)."
				),
				indicator: "red",
			},
			8
		);
		return false;
	}

	return {
		seal_count,
		rate_per_seal,
		billing_interval: billingInterval,
		currency: dialog.get_value("leasing_currency") || "KES",
	};
}

// Collects the Extra Billing (Scenario 6) leasing agreement off the dialog.
// Returns null when nothing to persist and never persisted (skip the call), a
// terms object otherwise (including deactivation), or false on a validation
// failure (message already shown, caller should abort the save). Only relevant
// once the extra data has loaded.
function _customer_collect_extra_billing_args(dialog) {
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
function _customer_finish_billing_save(page, dialog, customer, billingMessage, recurringArgs) {
	const { leaseArgs, ownershipArgs, extraArgs } = recurringArgs || {};
	if (!leaseArgs && !ownershipArgs && !extraArgs) {
		dialog.hide();
		frappe.show_alert({ message: billingMessage, indicator: "green" });
		_customer_load(page);
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
			_customer_load(page);
		})
		.catch(() => {
			dialog.hide();
			frappe.show_alert(
				{ message: __("{0}, but recurring billing could not be saved.", [billingMessage]), indicator: "orange" },
				6
			);
			_customer_load(page);
		});
}

function _customer_submit_leasing_billing(page, customer, terms, dialog, recurringArgs) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_type: "Leasing",
			first_period_days: terms.first_period_days,
			first_period_amount: terms.first_period_amount,
			extra_day_rate: terms.extra_day_rate,
			currency: terms.currency,
			period_from_date: terms.period_from_date || null,
			period_to_date: terms.period_to_date || null,
			tax_category: terms.tax_category,
			outright_purchase: terms.outright_purchase,
			owned_seal_count: terms.owned_seal_count,
		},
		freeze: true,
		freeze_message: __("Saving billing…"),
		callback(r) {
			const name = (r.message && r.message.billing_rule_name) || "";
			const message = name ? __("Billing set to {0}.", [name]) : __("Billing updated.");
			_customer_finish_billing_save(page, dialog, customer, message, recurringArgs);
		},
		error() {
			frappe.show_alert({ message: __("Could not save billing"), indicator: "red" }, 5);
		},
	});
}

function _customer_validate_period_bounds(dialog) {
	const from = dialog.get_value("period_from_date");
	const to = dialog.get_value("period_to_date");

	if (from && to && frappe.datetime.str_to_obj(to) < frappe.datetime.str_to_obj(from)) {
		frappe.show_alert({ message: __("Period To Date cannot be before Period From Date."), indicator: "red" }, 5);
		return false;
	}
	return true;
}

function _customer_submit_billing(
	page,
	customer,
	billingRule,
	billingType,
	periodFromDate,
	periodToDate,
	dialog,
	recurringArgs,
	taxCategory,
	firstPeriodAmount,
	currency,
	outrightPurchase,
	ownedSealCount
) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_rule: billingRule,
			billing_type: billingType,
			period_from_date: periodFromDate || null,
			period_to_date: periodToDate || null,
			tax_category: taxCategory,
			first_period_amount: firstPeriodAmount === "" ? null : firstPeriodAmount,
			currency: currency || null,
			outright_purchase: outrightPurchase,
			owned_seal_count: ownedSealCount,
		},
		freeze: true,
		freeze_message: __("Saving billing…"),
		callback(r) {
			const name = (r.message && r.message.billing_rule_name) || "";
			const message = name ? __("Billing set to {0}.", [name]) : __("Billing updated.");
			_customer_finish_billing_save(page, dialog, customer, message, recurringArgs);
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
			transform: translateY(-1px);
		}

		.ccl-portal-access-btn {
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
		.ccl-portal-access-btn:hover {
			border-color: var(--ccl-blue);
			background: #f0f9ff;
		}

		.ccl-billing-readonly {
			cursor: default;
		}

		.ccl-billing-readonly:hover {
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
		.ccl-tax-radio-group {
			display: flex;
			flex-wrap: wrap;
			gap: 16px;
			padding: 4px 0 8px;
		}
		.ccl-tax-radio {
			display: flex;
			align-items: center;
			gap: 6px;
			font-weight: 500;
			cursor: pointer;
		}
		.ccl-tax-radio input[type="radio"] {
			margin: 0;
			cursor: pointer;
		}
		.ccl-page-nav {
			display: flex;
			gap: 4px;
			border-bottom: 1px solid var(--border-color, #d1d8dd);
			margin-bottom: 16px;
		}
		.ccl-page-nav-btn {
			background: none;
			border: none;
			border-bottom: 2px solid transparent;
			padding: 8px 4px;
			margin-right: 20px;
			font-weight: 500;
			color: var(--text-muted, #8d99a6);
			cursor: pointer;
		}
		.ccl-page-nav-btn.active {
			color: var(--ccl-blue, #0284c7);
			border-bottom-color: var(--ccl-blue, #0284c7);
		}
		.ccl-recurring-loading {
			padding: 24px 0;
			text-align: center;
			color: var(--text-muted, #8d99a6);
		}
	`;
	document.head.appendChild(style);
}
