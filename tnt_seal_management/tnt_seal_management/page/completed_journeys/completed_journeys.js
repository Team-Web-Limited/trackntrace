frappe.pages["completed-journeys"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Completed Journeys"),
		single_column: true,
	});

	page.cj_state = {
		period: "Monthly",
		from_date: frappe.datetime.month_start(),
		to_date: frappe.datetime.get_today(),
		customer: "",
	};

	// Compact stats pills live in the Frappe page header (matching Journey
	// Monitoring / Current Customers), keeping them out of the content area.
	const $statsBar = $('<div class="cj-header-stats"></div>');
	$(wrapper).find(".page-head .page-actions").before($statsBar);
	page.cj_stats_bar = $statsBar;

	_inject_styles();
	_build_filters(page);
	page.add_inner_button(__("Refresh"), () => _load(page));
	_build_skeleton(page);
	_load(page);
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function _build_filters(page) {
	page.period_field = page.add_field({
		fieldname: "period",
		label: __("Period"),
		fieldtype: "Select",
		options: ["Custom", "Daily", "Weekly", "Monthly"],
		default: "Monthly",
		change() {
			const period = page.period_field.get_value();
			page.cj_state.period = period;
			_apply_period(page);
			_load(page);
		},
	});

	page.from_date_field = page.add_field({
		fieldname: "from_date",
		label: __("From Date"),
		fieldtype: "Date",
		default: page.cj_state.from_date,
		change() {
			page.cj_state.from_date = page.from_date_field.get_value();
			_load(page);
		},
	});

	page.to_date_field = page.add_field({
		fieldname: "to_date",
		label: __("To Date"),
		fieldtype: "Date",
		default: page.cj_state.to_date,
		change() {
			page.cj_state.to_date = page.to_date_field.get_value();
			_load(page);
		},
	});

	page.customer_field = page.add_field({
		fieldname: "customer",
		label: __("Customer"),
		fieldtype: "Link",
		options: "Customer",
		change() {
			page.cj_state.customer = page.customer_field.get_value();
			_load(page);
		},
	});
}

function _apply_period(page) {
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

function _load(page) {
	_set_loading(page, true);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.completed_journeys.get_completed_journeys",
		args: {
			from_date: page.cj_state.from_date || null,
			to_date: page.cj_state.to_date || null,
			customer: page.cj_state.customer || null,
		},
		callback(r) {
			_set_loading(page, false);
			_render(page, r.message || { customers: [], grand_total: null });
		},
		error() {
			_set_loading(page, false);
			frappe.show_alert({ message: __("Failed to load completed journeys"), indicator: "red" }, 5);
		},
	});
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _build_skeleton(page) {
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

	$(page.body).on("click", ".cj-journey-link", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Journey", name);
	});

	$(page.body).on("click", ".cj-print-btn", function () {
		const idx = $(this).data("idx");
		_print_customer(page, idx);
	});
}

function _render(page, data) {
	page.cj_data = data;
	const customers = data.customers || [];

	_render_overview(page, customers, data.grand_total);

	if (!customers.length) {
		$(page.body).find(".cj-cards").html(
			`<div class="cj-empty">${__("No completed journeys found for the selected filters.")}</div>`
		);
		return;
	}

	const cardsHtml = customers.map((c, idx) => _customer_card_html(c, idx)).join("");
	const grandHtml = data.grand_total ? _grand_total_html(data.grand_total, customers.length) : "";

	$(page.body).find(".cj-cards").html(cardsHtml + grandHtml);
}

function _render_overview(page, customers, grand_total) {
	const totalJourneys = customers.reduce((sum, c) => sum + c.journey_count, 0);
	const totalPayable = grand_total
		? grand_total.total_payable
		: (customers[0] && customers[0].summary.total_payable) || 0;

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
			<div class="cj-stat-label">${__("Total Payable")}</div>
			<div class="cj-stat-value">${format_currency(totalPayable)}</div>
		</div>
	`;
	if (page.cj_stats_bar) {
		page.cj_stats_bar.html(html);
	}
}

function _customer_card_html(c, idx) {
	const esc = frappe.utils.escape_html;
	const rows = c.journeys.map(_journey_row_html).join("");

	return `
		<section class="cj-card" id="cj-card-${idx}">
			<header class="cj-card-header">
				<div class="cj-card-title">
					<span class="cj-card-customer">${esc(c.customer)}</span>
					<span class="cj-badge">${c.journey_count} ${c.journey_count === 1 ? __("journey") : __("journeys")}</span>
				</div>
				<div class="cj-card-actions">
					<span class="cj-card-days">${__("{0} days total", [flt_display(c.total_days_taken)])}</span>
					<button class="cj-print-btn" data-idx="${idx}">${__("Print")}</button>
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
							<th>${__("Seal Number")}</th>
							<th>${__("File Number")}</th>
							<th>${__("Hours/Days Taken")}</th>
							<th>${__("Contact Person")}</th>
							<th>${__("Departure Card #")}</th>
							<th>${__("Retrieval Card #")}</th>
							<th class="cj-col-amount">${__("Amount")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>` : `<div class="cj-no-journeys">${__("No completed journeys in this period — recurring subscription fee only.")}</div>`}

			${_recurring_html(c.recurring_fees)}
			${_summary_html(c.summary)}
		</section>
	`;
}

function _recurring_html(fees) {
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

function _journey_row_html(j) {
	const esc = frappe.utils.escape_html;
	const dash = `<span class="cj-muted">—</span>`;
	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : dash);

	return `
		<tr>
			<td><span class="cj-journey-link" data-name="${esc(j.name)}">${esc(j.name)}</span></td>
			<td>${j.container_number ? esc(j.container_number) : dash}</td>
			<td>${j.origin ? esc(j.origin) : dash}</td>
			<td>${j.destination ? esc(j.destination) : dash}</td>
			<td>${dt(j.tagging_date_time)}</td>
			<td>${dt(j.arrival_date_time)}</td>
			<td>${dt(j.untagging_completed_date_time)}</td>
			<td>${j.seal_number ? esc(j.seal_number) : dash}</td>
			<td>${j.file_number ? esc(j.file_number) : dash}</td>
			<td>${j.days_taken_display ? esc(j.days_taken_display) : dash}</td>
			<td>${j.contact_person_name ? esc(j.contact_person_name) : dash}</td>
			<td>${j.departure_card_number ? esc(j.departure_card_number) : dash}</td>
			<td>${j.retrieval_card_number ? esc(j.retrieval_card_number) : dash}</td>
			<td class="cj-col-amount">${format_currency(j.total_charge || 0)}</td>
		</tr>
	`;
}

function _summary_html(s) {
	const pct = Math.round((s.vat_rate || 0) * 100);
	const hasJourneyCharges = (s.normal_charges || 0) !== 0 || (s.extra_charges || 0) !== 0 || (s.journey_total || 0) !== 0;
	const hasRecurring = (s.recurring_total || 0) !== 0;

	const journeyRows = hasJourneyCharges ? `
		<div class="cj-summary-row">
			<span>${__("Normal Charges")}</span>
			<span>${format_currency(s.normal_charges)}</span>
		</div>
		<div class="cj-summary-row">
			<span>${__("Extra Charges for Extra Days")}</span>
			<span>${format_currency(s.extra_charges)}</span>
		</div>
	` : "";

	const recurringRow = hasRecurring ? `
		<div class="cj-summary-row">
			<span>${__("Recurring Subscription Fees")}</span>
			<span>${format_currency(s.recurring_total)}</span>
		</div>
	` : "";

	return `
		<div class="cj-summary">
			${journeyRows}
			${recurringRow}
			<div class="cj-summary-row cj-summary-row--total">
				<span>${__("Total Cost")}</span>
				<span>${format_currency(s.total_cost)}</span>
			</div>
			<div class="cj-summary-row">
				<span>${__("VAT @{0}%", [pct])}</span>
				<span>${format_currency(s.vat)}</span>
			</div>
			<div class="cj-summary-row cj-summary-row--payable">
				<span>${__("Total Payable")}</span>
				<span>${format_currency(s.total_payable)}</span>
			</div>
		</div>
	`;
}

function _grand_total_html(g, customerCount) {
	return `
		<section class="cj-card cj-card--grand">
			<header class="cj-card-header">
				<div class="cj-card-title">
					<span class="cj-card-customer">${__("Grand Total")}</span>
					<span class="cj-badge">${__("{0} customers, {1} journeys", [customerCount, g.journey_count])}</span>
				</div>
			</header>
			${_summary_html(g)}
		</section>
	`;
}

function _print_customer(page, idx) {
	const c = (page.cj_data.customers || [])[idx];
	if (!c) return;

	const cardHtml = $(page.body).find(`#cj-card-${idx}`).prop("outerHTML");
	const win = window.open("", "_blank");
	win.document.write(`
		<html>
			<head>
				<title>${frappe.utils.escape_html(c.customer)} — ${__("Completed Journeys")}</title>
				<style>${_print_styles()}</style>
			</head>
			<body>
				<h2>${frappe.utils.escape_html(c.customer)}</h2>
				<p class="cj-print-meta">${__("Completed Journeys Statement")} — ${frappe.datetime.str_to_user(frappe.datetime.get_today())}</p>
				${cardHtml}
			</body>
		</html>
	`);
	win.document.close();
	win.focus();
	setTimeout(() => win.print(), 300);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flt_display(value) {
	return (Math.round((value || 0) * 100) / 100).toString();
}

function _set_loading(page, on) {
	$(page.body).find(".cj-loading").toggle(on);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function _print_styles() {
	return `
		body { font-family: sans-serif; padding: 24px; color: #1e293b; }
		h2 { margin-bottom: 2px; }
		.cj-print-meta { color: #64748b; margin-top: 0; margin-bottom: 20px; }
		.cj-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
		.cj-card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #f1f5f9; }
		.cj-card-actions { display: none; }
		.cj-badge { background: #e2e8f0; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin-left: 8px; }
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

function _inject_styles() {
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
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
		}
		.cj-print-btn {
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
		.cj-print-btn:hover { border-color: var(--cj-blue); }
		.cj-table-wrap {
			overflow-x: auto;
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
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.cj-col-amount { text-align: right; }
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
		@media (max-width: 900px) {
			.cj-summary { max-width: 100%; }
		}
	`;
	document.head.appendChild(style);
}
