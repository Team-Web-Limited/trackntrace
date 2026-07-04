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
		</tr>
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

	const dialog = new frappe.ui.Dialog({
		title: __("Set Billing — {0}", [data.customer_name]),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "billing_type",
				label: __("Billing Type"),
				options: ["Subscription", "Leasing"],
				reqd: 1,
				default: initialType,
				description: __("Subscription uses a shared rate card. Leasing is a private, per-customer rate entered here."),
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Select",
				fieldname: "billing_rule_label",
				label: __("Billing Rule"),
				options: subscriptionRuleOptions,
				default: currentLabel || subscriptionRuleOptions[0] || null,
				description: __("Configure rule terms in Seal Billing Rate. This only assigns the rule."),
				depends_on: 'eval:doc.billing_type=="Subscription"',
				mandatory_depends_on: 'eval:doc.billing_type=="Subscription"',
			},
			{
				fieldtype: "Section Break",
				label: __("Rate Terms"),
				description: __(
					"Saved as this customer's own rate — \"{0} BR\".",
					[data.customer_name]
				),
			},
			{
				fieldtype: "Select",
				fieldname: "billing_period_type",
				label: __("Billing Period Type"),
				read_only: 1,
				depends_on: 'eval:doc.billing_type=="Subscription"',
			},
			{
				fieldtype: "Select",
				fieldname: "leasing_currency",
				label: __("Currency"),
				options: "\nKES\nUSD",
				default: currentLeasingTerms.currency || "KES",
				depends_on: 'eval:doc.billing_type=="Leasing"',
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
				fieldtype: "Currency",
				fieldname: "first_period_amount",
				label: __("First Period Amount"),
				default: currentLeasingTerms.first_period_amount,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Currency",
				fieldname: "extra_day_rate",
				label: __("Extra Day Rate (per day)"),
				default: currentLeasingTerms.extra_day_rate,
			},
			{
				fieldtype: "Section Break",
				label: __("Validity"),
				description: __(
					"For Subscription this is the shared rule's company-wide window (edit it in Seal Billing Rate). For Leasing this is the customer's own private rule's window, set directly here."
				),
			},
			{
				fieldtype: "Date",
				fieldname: "rule_effective_from",
				label: __("Effective From"),
				default: currentLeasingTerms.effective_from || null,
			},
			{ fieldtype: "Column Break" },
			{
				fieldtype: "Date",
				fieldname: "rule_effective_to",
				label: __("Effective To"),
				default: currentLeasingTerms.effective_to || null,
			},
			{
				fieldtype: "Section Break",
				label: __("Customer Period"),
				description: __("The customer's own slice of the Validity window above — it cannot extend beyond it."),
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

			// Recurring, seal-count-based fees (PCB Journey Billing Patterns doc,
			// Scenarios 4-6) — independent of journeys, backed by an ERPNext
			// Subscription. Deliberately separate from the per-journey "Leasing"
			// billing_type above. Hidden until "Manage Recurring Fees" is clicked,
			// to keep this modal focused by default. A customer can carry both
			// lines at once (Scenario 6 — merged into one invoice automatically
			// since both live on the same Subscription).
			{
				fieldtype: "Section Break",
				fieldname: "lease_section",
				label: __("Recurring Lease Fee (leased seals)"),
				hidden: 1,
				description: __(
					"A fixed fee per leased seal, billed on a recurring cycle regardless of journey activity — independent of the per-journey billing above."
				),
			},
			{
				fieldtype: "Data",
				fieldname: "lease_status_display",
				label: __("Lease Subscription Status"),
				read_only: 1,
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "lease_col_1", hidden: 1 },
			{
				fieldtype: "Int",
				fieldname: "lease_seal_count",
				label: __("Number of Seals Leased"),
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "lease_col_2", hidden: 1 },
			{
				fieldtype: "Currency",
				fieldname: "lease_rate_per_seal",
				label: __("Rate per Seal"),
				hidden: 1,
			},
			{ fieldtype: "Section Break", fieldname: "lease_section_2", hidden: 1 },
			{
				fieldtype: "Select",
				fieldname: "lease_billing_interval",
				label: __("Billing Interval"),
				options: ["Month", "Quarter", "Year"],
				default: "Month",
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "lease_col_3", hidden: 1 },
			{
				fieldtype: "Select",
				fieldname: "lease_currency",
				label: __("Currency"),
				options: "\nKES\nUSD",
				default: "KES",
				hidden: 1,
			},

			// Scenario 5: owned seals, ongoing platform/service fee across the
			// whole pool regardless of utilization.
			{
				fieldtype: "Section Break",
				fieldname: "ownership_section",
				label: __("Ownership Service Fee (owned seals)"),
				hidden: 1,
				description: __(
					"A fixed service fee across the customer's owned seal pool, billed on a recurring cycle whether the seals are deployed or not."
				),
			},
			{
				fieldtype: "Data",
				fieldname: "ownership_status_display",
				label: __("Ownership Subscription Status"),
				read_only: 1,
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "ownership_col_1", hidden: 1 },
			{
				fieldtype: "Int",
				fieldname: "ownership_seal_count",
				label: __("Number of Seals Owned"),
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "ownership_col_2", hidden: 1 },
			{
				fieldtype: "Currency",
				fieldname: "ownership_rate_per_seal",
				label: __("Service Fee Rate"),
				hidden: 1,
			},
			{ fieldtype: "Section Break", fieldname: "ownership_section_2", hidden: 1 },
			{
				fieldtype: "Select",
				fieldname: "ownership_billing_interval",
				label: __("Billing Interval"),
				options: ["Month", "Quarter", "Semi-Annual", "Year"],
				default: "Month",
				hidden: 1,
			},
			{ fieldtype: "Column Break", fieldname: "ownership_col_3", hidden: 1 },
			{
				fieldtype: "Select",
				fieldname: "ownership_currency",
				label: __("Currency"),
				options: "\nKES\nUSD",
				default: "KES",
				hidden: 1,
			},
		],
		secondary_action_label: __("Manage Recurring Fees"),
		secondary_action() {
			_customer_reveal_recurring_sections(page, dialog, data.customer);
		},
		primary_action_label: __("Save Billing"),
		primary_action() {
			const billingType = dialog.get_value("billing_type");

			const leaseArgs = _customer_collect_lease_args(dialog);
			if (leaseArgs === false) return; // validation failed, message already shown
			const ownershipArgs = _customer_collect_ownership_args(dialog);
			if (ownershipArgs === false) return; // validation failed, message already shown
			const recurringArgs = { leaseArgs, ownershipArgs };

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
				const leasingRule = {
					effective_from: dialog.get_value("rule_effective_from"),
					effective_to: dialog.get_value("rule_effective_to"),
				};
				if (!_customer_validate_period_bounds(dialog, leasingRule)) return;
				_customer_submit_leasing_billing(
					page,
					data.customer,
					{
						first_period_days: days,
						first_period_amount: amount,
						extra_day_rate: extraRate,
						currency: dialog.get_value("leasing_currency") || "KES",
						effective_from: leasingRule.effective_from,
						effective_to: leasingRule.effective_to,
						period_from_date: dialog.get_value("period_from_date"),
						period_to_date: dialog.get_value("period_to_date"),
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
			if (!_customer_validate_period_bounds(dialog, rule)) return;
			_customer_submit_billing(
				page,
				data.customer,
				rule.name,
				billingType,
				dialog.get_value("period_from_date"),
				dialog.get_value("period_to_date"),
				dialog,
				recurringArgs
			);
		},
	});

	const applySubscriptionRuleDetails = () => {
		const rule = subscriptionRuleMap[dialog.get_value("billing_rule_label")];
		dialog.set_value("billing_period_type", rule ? rule.billing_period_type : "");
		dialog.set_value("rule_effective_from", rule ? rule.effective_from : "");
		dialog.set_value("rule_effective_to", rule ? rule.effective_to : "");
		dialog.set_value("first_period_days", rule ? rule.first_period_days : "");
		dialog.set_value("first_period_amount", rule ? rule.first_period_amount : "");
		dialog.set_value("extra_day_rate", rule ? rule.extra_day_rate : "");
	};

	const applyFieldModeForType = () => {
		const isSubscription = dialog.get_value("billing_type") === "Subscription";
		["first_period_days", "first_period_amount", "extra_day_rate", "rule_effective_from", "rule_effective_to"].forEach(
			(fieldname) => {
				dialog.set_df_property(fieldname, "read_only", isSubscription ? 1 : 0);
			}
		);
		if (isSubscription) {
			applySubscriptionRuleDetails();
		} else {
			// Leasing: restore this customer's own saved terms rather than
			// whatever a previously-selected Subscription rule copied in — or,
			// for a brand new Leasing rate, default the Validity window to the
			// current calendar year (matches Seal Billing Rate's own default).
			const year = frappe.datetime.now_date().split("-")[0];
			dialog.set_value("first_period_days", currentLeasingTerms.first_period_days || "");
			dialog.set_value("first_period_amount", currentLeasingTerms.first_period_amount || "");
			dialog.set_value("extra_day_rate", currentLeasingTerms.extra_day_rate || "");
			dialog.set_value("rule_effective_from", currentLeasingTerms.effective_from || `${year}-01-01`);
			dialog.set_value("rule_effective_to", currentLeasingTerms.effective_to || `${year}-12-31`);
		}
	};

	dialog.fields_dict.billing_type.df.onchange = applyFieldModeForType;
	dialog.fields_dict.billing_rule_label.df.onchange = applySubscriptionRuleDetails;

	dialog.show();
	applyFieldModeForType();
}

// Fetches the customer's existing Lease + Ownership subscription lines (if
// any) and reveals both hidden sections in place, rather than opening a
// second dialog — keeps everything in the one Set Billing modal per
// customer. A customer can fill in either, both (Scenario 6), or neither.
function _customer_reveal_recurring_sections(page, dialog, customer) {
	if (dialog.recurring_sections_revealed) return;

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.get_customer_lease_subscription",
		args: { customer },
		freeze: true,
		callback(r) {
			const info = r.message || {};
			dialog.set_value("lease_status_display", info.lease_status || __("Not activated"));
			dialog.set_value("lease_seal_count", info.seal_count || null);
			dialog.set_value("lease_rate_per_seal", info.rate_per_seal || null);
			dialog.set_value("lease_billing_interval", info.billing_interval || "Month");
			dialog.set_value("lease_currency", info.currency || "KES");

			[
				"lease_section",
				"lease_status_display",
				"lease_col_1",
				"lease_seal_count",
				"lease_col_2",
				"lease_rate_per_seal",
				"lease_section_2",
				"lease_billing_interval",
				"lease_col_3",
				"lease_currency",
			].forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", 0));
		},
		error() {
			frappe.show_alert({ message: __("Could not load lease subscription details"), indicator: "red" }, 5);
		},
	});

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.seal_lease_billing.get_customer_ownership_subscription",
		args: { customer },
		freeze: true,
		callback(r) {
			const info = r.message || {};
			dialog.set_value("ownership_status_display", info.ownership_status || __("Not activated"));
			dialog.set_value("ownership_seal_count", info.seal_count || null);
			dialog.set_value("ownership_rate_per_seal", info.rate_per_seal || null);
			dialog.set_value("ownership_billing_interval", info.billing_interval || "Month");
			dialog.set_value("ownership_currency", info.currency || "KES");

			[
				"ownership_section",
				"ownership_status_display",
				"ownership_col_1",
				"ownership_seal_count",
				"ownership_col_2",
				"ownership_rate_per_seal",
				"ownership_section_2",
				"ownership_billing_interval",
				"ownership_col_3",
				"ownership_currency",
			].forEach((fieldname) => dialog.set_df_property(fieldname, "hidden", 0));

			dialog.recurring_sections_revealed = true;
			dialog.set_secondary_action_label(__("Recurring Fees Shown"));
			dialog.get_secondary_btn().prop("disabled", true);
		},
		error() {
			frappe.show_alert({ message: __("Could not load ownership subscription details"), indicator: "red" }, 5);
		},
	});
}

// Reads the (possibly hidden) lease fields off the dialog. Returns null when
// the section was never revealed or was left blank (nothing to save), a
// terms object when filled in, or false on a validation failure (a message
// has already been shown, so the caller should abort the whole save).
function _customer_collect_lease_args(dialog) {
	if (!dialog.recurring_sections_revealed) return null;

	const seal_count = dialog.get_value("lease_seal_count");
	const rate_per_seal = dialog.get_value("lease_rate_per_seal");
	const hasSealCount = seal_count !== "" && seal_count !== null && seal_count !== undefined;
	const hasRate = rate_per_seal !== "" && rate_per_seal !== null && rate_per_seal !== undefined;

	if (!hasSealCount && !hasRate) return null; // revealed but left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Leased and Rate per Seal, or leave the Recurring Lease Fee section blank."), indicator: "red" },
			6
		);
		return false;
	}

	return {
		seal_count,
		rate_per_seal,
		billing_interval: dialog.get_value("lease_billing_interval") || "Month",
		currency: dialog.get_value("lease_currency") || "KES",
	};
}

// Same shape as _customer_collect_lease_args, for the Ownership Service Fee section.
function _customer_collect_ownership_args(dialog) {
	if (!dialog.recurring_sections_revealed) return null;

	const seal_count = dialog.get_value("ownership_seal_count");
	const rate_per_seal = dialog.get_value("ownership_rate_per_seal");
	const hasSealCount = seal_count !== "" && seal_count !== null && seal_count !== undefined;
	const hasRate = rate_per_seal !== "" && rate_per_seal !== null && rate_per_seal !== undefined;

	if (!hasSealCount && !hasRate) return null; // revealed but left blank — nothing to do

	if (!hasSealCount || !hasRate) {
		frappe.show_alert(
			{ message: __("Enter both Number of Seals Owned and Service Fee Rate, or leave the Ownership Service Fee section blank."), indicator: "red" },
			6
		);
		return false;
	}

	return {
		seal_count,
		rate_per_seal,
		billing_interval: dialog.get_value("ownership_billing_interval") || "Month",
		currency: dialog.get_value("ownership_currency") || "KES",
	};
}

// Shared tail end of both billing-save paths: saves the Lease and/or
// Ownership subscription lines (whichever the caller collected) before
// closing the dialog and reloading the list, so "Save Billing" acts as one
// combined save. Both lines land on the same Subscription — Scenario 6.
function _customer_finish_billing_save(page, dialog, customer, billingMessage, recurringArgs) {
	const { leaseArgs, ownershipArgs } = recurringArgs || {};
	if (!leaseArgs && !ownershipArgs) {
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
				freeze_message: __("Saving ownership service fee…"),
			})
		);
	}

	Promise.all(calls)
		.then(() => {
			dialog.hide();
			frappe.show_alert({ message: __("{0} Recurring fees saved.", [billingMessage]), indicator: "green" });
			_customer_load(page);
		})
		.catch(() => {
			dialog.hide();
			frappe.show_alert(
				{ message: __("{0}, but a recurring fee could not be saved.", [billingMessage]), indicator: "orange" },
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
			rule_effective_from: terms.effective_from || null,
			rule_effective_to: terms.effective_to || null,
			period_from_date: terms.period_from_date || null,
			period_to_date: terms.period_to_date || null,
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

// Keeps the customer's period inside the rule's company-wide validity window
// (either bound may be unset on the rule, meaning open-ended on that side).
function _customer_validate_period_bounds(dialog, rule) {
	const from = dialog.get_value("period_from_date");
	const to = dialog.get_value("period_to_date");

	if (from && to && frappe.datetime.str_to_obj(to) < frappe.datetime.str_to_obj(from)) {
		frappe.show_alert({ message: __("Period To Date cannot be before Period From Date."), indicator: "red" }, 5);
		return false;
	}
	if (from && rule.effective_from && frappe.datetime.str_to_obj(from) < frappe.datetime.str_to_obj(rule.effective_from)) {
		frappe.show_alert(
			{ message: __("Period From Date cannot be before the rule's Effective From Date ({0}).", [rule.effective_from]), indicator: "red" },
			6
		);
		return false;
	}
	if (to && rule.effective_to && frappe.datetime.str_to_obj(to) > frappe.datetime.str_to_obj(rule.effective_to)) {
		frappe.show_alert(
			{ message: __("Period To Date cannot be after the rule's Effective To Date ({0}).", [rule.effective_to]), indicator: "red" },
			6
		);
		return false;
	}
	return true;
}

function _customer_submit_billing(page, customer, billingRule, billingType, periodFromDate, periodToDate, dialog, recurringArgs) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.current_customers.set_customer_billing",
		args: {
			customer,
			billing_rule: billingRule,
			billing_type: billingType,
			period_from_date: periodFromDate || null,
			period_to_date: periodToDate || null,
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
	`;
	document.head.appendChild(style);
}
