frappe.pages["tagging-booking-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Tagging Bookings"),
		single_column: true,
	});

	page.tb_state = {
		search: "",
		status: "All",
		customer: "",
		from_date: "",
		to_date: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _load_tagging_bookings(page));
	page.set_primary_action(__("New Booking"), () => frappe.new_doc("Tagging Booking"));

	const $statsBar = $('<div class="tb-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.tb_stats_bar = $statsBar;

	_inject_tagging_booking_styles();
	_build_tagging_booking_page(page);
	_load_tagging_bookings(page);
};

function _build_tagging_booking_page(page) {
	const statuses = [
		["All", __("All")],
		["Draft", __("Draft")],
		["Pending Account Manager Review", __("Pending Account Manager")],
		["Pending Finance PCB Approval", __("Pending Finance")],
		["Finance PCB Approved", __("Approved")],
		["Finance PCB Rejected", __("Rejected")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="tb-page">
			<section class="tb-panel">
				<div class="tb-toolbar">
					<div class="tb-toolbar-top">
						<label class="tb-field tb-search-inline">
							<input class="tb-search" type="search" placeholder="${__("Booking, client, location or contact")}">
						</label>

						<div class="tb-filter-dropdown">
							<button class="tb-filter-btn">
								<span class="tb-filter-btn-label">${__("All")}</span>
								<span class="tb-filter-btn-count">0</span>
								<span class="tb-filter-arrow">&#9662;</span>
							</button>
							<div class="tb-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="tb-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="tb-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="tb-field tb-customer-field">
							<span>${__("Client")}</span>
							<div class="tb-customer-filter"></div>
						</label>

						<label class="tb-field tb-date-field">
							<span>${__("From")}</span>
							<input class="tb-from-date" type="date">
						</label>
						<label class="tb-field tb-date-field">
							<span>${__("To")}</span>
							<input class="tb-to-date" type="date">
						</label>
						<div class="tb-actions">
							<button class="tb-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="tb-table-panel">
				<div class="tb-table-scroll"><div class="tb-table-wrap"></div></div>
				<div class="tb-pagination"></div>
			</section>

			<div class="tb-loading" style="display:none"><div class="tb-spinner"></div></div>
		</div>
	`);

	page.tb_customer_control = frappe.ui.form.make_control({
		parent: $(page.body).find(".tb-customer-filter"),
		df: {
			fieldname: "customer",
			fieldtype: "Link",
			options: "Customer",
			placeholder: __("All clients"),
		},
		render_input: true,
	});

	const delayedSearch = _tb_debounce(() => {
		page.tb_state.search = ($(page.body).find(".tb-search").val() || "").trim();
		page.tb_state.page = 1;
		_load_tagging_bookings(page);
	}, 350);

	$(page.body).on("input", ".tb-search", delayedSearch);
	page.tb_customer_control.$input.on("change", () => {
		page.tb_state.customer = page.tb_customer_control.get_value() || "";
		page.tb_state.page = 1;
		_load_tagging_bookings(page);
	});

	$(page.body).on("change", ".tb-from-date, .tb-to-date", () => {
		page.tb_state.from_date = $(page.body).find(".tb-from-date").val() || "";
		page.tb_state.to_date = $(page.body).find(".tb-to-date").val() || "";
		page.tb_state.page = 1;
		_load_tagging_bookings(page);
	});

	$(page.body).on("click", ".tb-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".tb-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".tb-filter-item", function () {
		page.tb_state.status = $(this).data("status");
		page.tb_state.page = 1;
		$(page.body).find(".tb-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".tb-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".tb-filter-menu").removeClass("open");
		_load_tagging_bookings(page);
	});

	$(document).on("click.tb-dropdown", function () {
		$(page.body).find(".tb-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".tb-clear-btn", () => _clear_tagging_booking_filters(page));

	$(page.body).on("click", ".tb-booking-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Tagging Booking", name);
	});

	$(page.body).on("click", ".tb-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.tb_state.page = Number.parseInt($(this).data("page"), 10);
		_load_tagging_bookings(page);
	});
}

function _load_tagging_bookings(page) {
	const requestId = ++page.tb_state.request_id;
	_set_tagging_booking_loading(page, true);

	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.get_booking_list",
		args: {
			search: page.tb_state.search,
			status: page.tb_state.status,
			customer: page.tb_state.customer,
			from_date: page.tb_state.from_date,
			to_date: page.tb_state.to_date,
			page: page.tb_state.page,
			page_length: page.tb_state.page_length,
		},
		callback(r) {
			if (requestId !== page.tb_state.request_id) return;
			_set_tagging_booking_loading(page, false);

			const data = r.message || {};
			page.tb_state.total = data.total || 0;
			_render_tagging_booking_stats(page, data.summary || {});
			_render_tagging_booking_table(page, data.bookings || []);
			_render_tagging_booking_pagination(page);
		},
		error() {
			if (requestId !== page.tb_state.request_id) return;
			_set_tagging_booking_loading(page, false);
			frappe.show_alert(
				{ message: __("Could not load tagging bookings"), indicator: "red" },
				5
			);
		},
	});
}

function _render_tagging_booking_stats(page, summary) {
	const html = `
		<div class="tb-stat-card">
			<div class="tb-stat-label">${__("All")}</div>
			<div class="tb-stat-value">${summary.All || 0}</div>
		</div>
		<div class="tb-stat-card tb-stat--pending">
			<div class="tb-stat-label">${__("Pending")}</div>
			<div class="tb-stat-value">${(summary["Pending Account Manager Review"] || 0) + (summary["Pending Finance PCB Approval"] || 0)}</div>
		</div>
		<div class="tb-stat-card tb-stat--approved">
			<div class="tb-stat-label">${__("Approved")}</div>
			<div class="tb-stat-value">${summary["Finance PCB Approved"] || 0}</div>
		</div>
		<div class="tb-stat-card tb-stat--rejected">
			<div class="tb-stat-label">${__("Rejected")}</div>
			<div class="tb-stat-value">${summary["Finance PCB Rejected"] || 0}</div>
		</div>
	`;
	if (page.tb_stats_bar) {
		page.tb_stats_bar.html(html);
	}

	$(page.body).find(".tb-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(summary[key] ?? 0);
	});
	const currentCount = summary[page.tb_state.status] ?? 0;
	$(page.body).find(".tb-filter-btn-count").text(currentCount);
}

function _render_tagging_booking_table(page, bookings) {
	if (!bookings.length) {
		$(page.body).find(".tb-table-wrap").html(`
			<div class="tb-empty">
				<strong>${__("No bookings found")}</strong>
				<span>${__("Try clearing a filter or create a new tagging booking.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".tb-table-wrap").html(`
		<table class="tb-table">
			<thead>
				<tr>
					<th>${__("Booking")}</th>
					<th>${__("Client")}</th>
					<th>${__("Location")}</th>
					<th>${__("Date and Time")}</th>
					<th>${__("Contact Person")}</th>
					<th>${__("Phone")}</th>
					<th>${__("Booking Status")}</th>
				</tr>
			</thead>
			<tbody>${bookings.map(_tagging_booking_row_html).join("")}</tbody>
		</table>
	`);
}

function _tagging_booking_row_html(booking) {
	const status = booking.booking_status || __("Draft");
	const statusClass = _tagging_booking_status_class(status);
	const bookingDate = booking.booking_date_time
		? frappe.datetime.str_to_user(booking.booking_date_time)
		: "—";

	return `
		<tr class="tb-booking-row" data-name="${frappe.utils.escape_html(booking.name)}">
			<td>
				<span class="tb-booking-name">${frappe.utils.escape_html(booking.name)}</span>
			</td>
			<td>${frappe.utils.escape_html(booking.client_name || "—")}</td>
			<td>${frappe.utils.escape_html(booking.location || "—")}</td>
			<td>${frappe.utils.escape_html(bookingDate)}</td>
			<td>${frappe.utils.escape_html(booking.contact_person_name || "—")}</td>
			<td>${frappe.utils.escape_html(booking.contact_person_phone || "—")}</td>
			<td><span class="tb-badge tb-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
		</tr>
	`;
}

function _render_tagging_booking_pagination(page) {
	const totalPages = Math.max(1, Math.ceil(page.tb_state.total / page.tb_state.page_length));
	page.tb_state.page = Math.min(page.tb_state.page, totalPages);
	const start = page.tb_state.total
		? (page.tb_state.page - 1) * page.tb_state.page_length + 1
		: 0;
	const end = Math.min(
		page.tb_state.page * page.tb_state.page_length,
		page.tb_state.total
	);

	$(page.body).find(".tb-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.tb_state.total])}</span>
		<div>
			<button class="tb-page-btn" data-page="${page.tb_state.page - 1}" ${page.tb_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.tb_state.page, totalPages])}</b>
			<button class="tb-page-btn" data-page="${page.tb_state.page + 1}" ${page.tb_state.page >= totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _clear_tagging_booking_filters(page) {
	page.tb_state.search = "";
	page.tb_state.status = "All";
	page.tb_state.customer = "";
	page.tb_state.from_date = "";
	page.tb_state.to_date = "";
	page.tb_state.page = 1;

	$(page.body).find(".tb-search, .tb-from-date, .tb-to-date").val("");
	$(page.body).find(".tb-filter-item").removeClass("active");
	$(page.body).find('.tb-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".tb-filter-btn-label").text(__("All"));
	page.tb_customer_control.set_value("");

	_load_tagging_bookings(page);
}

function _tagging_booking_status_class(status) {
	if (status === "Finance PCB Approved") return "approved";
	if (status === "Finance PCB Rejected") return "rejected";
	if (["Pending Account Manager Review", "Pending Finance PCB Approval"].includes(status)) return "pending";
	if (status === "Cancelled") return "rejected";
	return "draft";
}

function _set_tagging_booking_loading(page, show) {
	$(page.body).find(".tb-loading").toggle(show);
}

function _tb_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _inject_tagging_booking_styles() {
	if (document.getElementById("tagging-booking-list-styles")) return;

	const style = document.createElement("style");
	style.id = "tagging-booking-list-styles";
	style.textContent = `
		.tb-page {
			--tb-ink: #0c4a6e;
			--tb-blue: #0284c7;
			--tb-blue-dark: #075985;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.tb-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.tb-header-stats .tb-stat-card {
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
		.tb-header-stats .tb-stat--pending { border-top-color: #f59e0b; }
		.tb-header-stats .tb-stat--approved { border-top-color: #16a34a; }
		.tb-header-stats .tb-stat--rejected { border-top-color: #dc2626; }
		.tb-header-stats .tb-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.tb-header-stats .tb-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.tb-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.tb-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.tb-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.tb-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.tb-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.tb-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.tb-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.tb-search-inline input:focus {
			outline: none;
			border-color: var(--tb-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.tb-filter-dropdown { position: relative; }
		.tb-filter-btn {
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
		.tb-filter-btn:hover { border-color: var(--tb-blue); }
		.tb-filter-btn-count {
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
		.tb-filter-arrow { color: #94a3b8; font-size: 11px; }
		.tb-filter-menu {
			display: none;
			position: fixed;
			min-width: 240px;
			border: 1px solid #bae6fd;
			border-radius: 12px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .12);
			z-index: 1000;
			overflow: hidden;
		}
		.tb-filter-menu.open { display: block; }
		.tb-filter-item {
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
		.tb-filter-item:hover { background: #f0f9ff; }
		.tb-filter-item.active { background: #e0f2fe; color: var(--tb-blue); }
		.tb-fcount {
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
		.tb-filter-item.active .tb-fcount { background: var(--tb-blue); color: #fff; }

		/* ---- regular fields ---- */
		.tb-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.tb-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.tb-date-field input[type="date"] {
			width: 140px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 10px;
			font-size: 13px;
		}
		.tb-date-field input[type="date"]:focus,
		.tb-customer-filter .control-input:focus-within {
			outline: none;
			border-color: var(--tb-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		.tb-customer-field { min-width: 180px; }
		.tb-customer-filter .control-input {
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			padding: 0;
			overflow: hidden;
		}
		.tb-customer-filter .control-input input {
			border: 0;
			height: 100%;
			padding: 0 12px;
			background: transparent;
			color: var(--text-color, #0c4a6e);
			font-size: 13px;
		}
		.tb-customer-filter .form-group { margin: 0; }
		.tb-customer-filter .control-label,
		.tb-customer-filter .help-box { display: none; }

		/* ---- actions ---- */
		.tb-actions { display: flex; gap: 8px; padding-top: 20px; }
		.tb-clear-btn {
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
		.tb-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.tb-table {
			width: 100%;
			min-width: 1060px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.tb-table th,
		.tb-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.35;
		}
		.tb-table th {
			position: sticky;
			top: 0;
			z-index: 10;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .09em;
			text-transform: uppercase;
		}
		.tb-booking-row { cursor: pointer; }
		.tb-booking-row:hover { background: rgba(224, 242, 254, .7); }
		.tb-booking-row td:first-child { border-left: 3px solid transparent; }
		.tb-booking-row:hover td:first-child { border-left-color: var(--tb-blue); }
		.tb-booking-name {
			display: block;
			color: var(--tb-blue);
			font-weight: 800;
			font-size: 14px;
			line-height: 1.3;
		}
		.tb-table small {
			display: block;
			margin-top: 4px;
			color: var(--text-muted, #64748b);
			font-size: 13px;
			line-height: 1.4;
		}
		.tb-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
		}
		.tb-badge--approved { background: #dcfce7; color: #166534; }
		.tb-badge--rejected { background: #fee2e2; color: #b91c1c; }
		.tb-badge--pending { background: #fef3c7; color: #92400e; }
		.tb-badge--draft { background: #e5e7eb; color: #4b5563; }
		.tb-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.tb-empty strong {
			color: var(--tb-ink);
			font-size: 22px;
		}
		.tb-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.tb-pagination div {
			display: flex;
			align-items: center;
			gap: 9px;
		}
		.tb-pagination b { font-weight: 700; }
		.tb-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.tb-page-btn:disabled { cursor: default; opacity: .45; }
		.tb-loading {
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
		.tb-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--tb-blue);
			border-radius: 50%;
			animation: tb-spin .7s linear infinite;
		}
		@keyframes tb-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .tb-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .tb-panel,
		[data-theme="dark"] .tb-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .tb-search-inline input,
		[data-theme="dark"] .tb-date-field input[type="date"],
		[data-theme="dark"] .tb-customer-filter .control-input,
		[data-theme="dark"] .tb-filter-btn,
		[data-theme="dark"] .tb-filter-menu,
		[data-theme="dark"] .tb-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .tb-field > span { color: #7dd3fc; }
		[data-theme="dark"] .tb-toolbar,
		[data-theme="dark"] .tb-table th,
		[data-theme="dark"] .tb-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .tb-table td {
			border-bottom-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .tb-booking-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .tb-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.tb-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.tb-page { padding: 10px 8px 32px; }
			.tb-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
