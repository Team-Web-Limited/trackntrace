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
	page.set_primary_action(__("New Booking"), () => frappe.new_doc("Tagging Booking"));

	_inject_tagging_booking_styles();
	_build_tagging_booking_page(page);
	_load_tagging_bookings(page);
};

function _build_tagging_booking_page(page) {
	const statuses = [
		["All", __("All")],
		["Draft", __("Draft")],
		["Pending Finance PCB Approval", __("Pending Finance")],
		["Finance PCB Approved", __("Approved")],
		["Finance PCB Rejected", __("Rejected")],
	];

	$(page.body).html(`
		<div class="tb-page">
			<section class="tb-panel">
				<div class="tb-toolbar">
					<div class="tb-toolbar-top">
						<div class="tb-status-filters">
						${statuses
							.map(
								([value, label]) => `
									<button class="tb-status-btn ${value === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(value)}">
										${frappe.utils.escape_html(label)}
									</button>
								`
							)
							.join("")}
						</div>
						<section class="tb-stat-row"></section>
					</div>

					<div class="tb-filter-grid">
						<label class="tb-field tb-field--search">
							<span>${__("Search")}</span>
							<input class="tb-search" type="search" placeholder="${__("Booking, client, location or contact")}">
						</label>
						<label class="tb-field">
							<span>${__("Client")}</span>
							<div class="tb-customer-filter"></div>
						</label>
						<label class="tb-field">
							<span>${__("From")}</span>
							<input class="tb-from-date" type="date">
						</label>
						<label class="tb-field">
							<span>${__("To")}</span>
							<input class="tb-to-date" type="date">
						</label>
						<div class="tb-filter-actions">
							<button class="tb-clear-btn">${__("Clear filters")}</button>
							<button class="tb-refresh-btn">${__("Refresh")}</button>
						</div>
					</div>
				</div>

				<div class="tb-table-scroll">
					<div class="tb-table-wrap"></div>
				</div>
				<div class="tb-pagination"></div>
			</section>

			<div class="tb-loading" style="display:none">
				<div class="tb-spinner"></div>
			</div>
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

	$(page.body).on("click", ".tb-status-btn", function () {
		$(page.body).find(".tb-status-btn").removeClass("active");
		$(this).addClass("active");
		page.tb_state.status = $(this).data("status");
		page.tb_state.page = 1;
		_load_tagging_bookings(page);
	});

	$(page.body).on("click", ".tb-refresh-btn", () => _load_tagging_bookings(page));
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
	const stats = [
		[__("All bookings"), summary.All || 0, "all"],
		[__("Awaiting Finance"), summary["Pending Finance PCB Approval"] || 0, "pending"],
		[__("Approved"), summary["Finance PCB Approved"] || 0, "approved"],
		[__("Rejected"), summary["Finance PCB Rejected"] || 0, "rejected"],
	];

	$(page.body).find(".tb-stat-row").html(
		stats
			.map(
				([label, value, variant]) => `
					<div class="tb-stat-card tb-stat-card--${variant}">
						<span>${frappe.utils.escape_html(label)}</span>
						<strong>${value}</strong>
					</div>
				`
			)
			.join("")
	);
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
	$(page.body).find(".tb-status-btn").removeClass("active");
	$(page.body).find('.tb-status-btn[data-status="All"]').addClass("active");
	page.tb_customer_control.set_value("");
	_load_tagging_bookings(page);
}

function _tagging_booking_status_class(status) {
	if (status === "Finance PCB Approved") return "approved";
	if (status === "Finance PCB Rejected") return "rejected";
	if (status === "Pending Finance PCB Approval") return "pending";
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
			--tb-sky: #e0f2fe;
			--tb-sky-light: #f0f9ff;
			max-width: 1380px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			color: var(--tb-ink);
			font-family: var(--font-stack);
		}
		.tb-stat-row {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px;
			min-width: 0;
		}
		.tb-stat-card {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			min-height: 78px;
			padding: 16px 18px;
			border-radius: 20px;
			border: 1px solid rgba(14, 165, 233, 0.2);
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, 0.05);
		}
		.tb-stat-card span {
			max-width: 110px;
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: .05em;
		}
		.tb-stat-card strong {
			color: var(--tb-ink);
			font-size: 34px;
			line-height: 1;
		}
		.tb-stat-card--all,
		.tb-stat-card--approved {
			background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
			border-color: #bae6fd;
		}
		.tb-stat-card--pending { border-top: 4px solid #0ea5e9; }
		.tb-stat-card--approved { border-top: 4px solid var(--tb-blue); }
		.tb-stat-card--rejected { border-top: 4px solid #38bdf8; }
		.tb-stat-card--all { border-top: 4px solid var(--tb-blue-dark); }
		.tb-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, 0.2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, 0.05);
		}
		.tb-toolbar {
			padding: 18px;
			border-bottom: 1px solid #e0f2fe;
			background: var(--tb-sky-light);
		}
		.tb-toolbar-top {
			display: grid;
			grid-template-columns: minmax(0, auto) minmax(680px, 1fr);
			align-items: start;
			gap: 18px;
			margin-bottom: 14px;
		}
		.tb-status-filters {
			display: flex;
			gap: 7px;
			overflow-x: auto;
			padding-bottom: 2px;
		}
		.tb-status-btn,
		.tb-clear-btn,
		.tb-refresh-btn,
		.tb-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: var(--tb-blue-dark);
			padding: 9px 15px;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.tb-status-btn.active {
			border-color: var(--tb-blue);
			background: var(--tb-blue);
			color: #fff;
		}
		.tb-filter-grid {
			display: grid;
			grid-template-columns: minmax(300px, 1.7fr) minmax(240px, 1fr) minmax(170px, .72fr) minmax(170px, .72fr) auto;
			align-items: end;
			gap: 12px;
		}
		.tb-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			margin: 0;
		}
		.tb-field > span {
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: .05em;
		}
		.tb-field input,
		.tb-customer-filter .control-input {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.tb-customer-filter .form-group { margin: 0; }
		.tb-customer-filter .control-label,
		.tb-customer-filter .help-box { display: none; }
		.tb-filter-actions {
			display: flex;
			gap: 7px;
			padding-bottom: 1px;
		}
		.tb-clear-btn { color: #0369a1; }
		.tb-refresh-btn {
			border-color: var(--tb-blue);
			background: var(--tb-blue);
			color: #fff;
		}
		.tb-table-scroll { overflow-x: auto; }
		.tb-table {
			width: 100%;
			min-width: 1240px;
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
			font-size: 15px;
			line-height: 1.45;
		}
		.tb-table th {
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
			font-size: 18px;
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
		[data-theme="dark"] .tb-page {
			--tb-ink: #f8fafc;
			--tb-blue: #38bdf8;
			--tb-blue-dark: #7dd3fc;
		}
		[data-theme="dark"] .tb-stat-card,
		[data-theme="dark"] .tb-panel,
		[data-theme="dark"] .tb-status-btn,
		[data-theme="dark"] .tb-clear-btn,
		[data-theme="dark"] .tb-page-btn,
		[data-theme="dark"] .tb-field input,
		[data-theme="dark"] .tb-customer-filter .control-input {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .tb-stat-card--all,
		[data-theme="dark"] .tb-stat-card--approved {
			background: linear-gradient(135deg, #075985 0%, #0369a1 100%);
			border-color: #0284c7;
		}
		[data-theme="dark"] .tb-stat-card span,
		[data-theme="dark"] .tb-field > span { color: #7dd3fc; }
		[data-theme="dark"] .tb-stat-card strong { color: #f1f5f9; }
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
		@media (max-width: 1000px) {
			.tb-toolbar-top { grid-template-columns: 1fr; }
			.tb-stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.tb-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.tb-filter-actions { grid-column: 1 / -1; }
		}
		@media (max-width: 720px) {
			.tb-page { padding: 10px 8px 32px; }
			.tb-stat-row { grid-template-columns: 1fr; }
			.tb-filter-grid { grid-template-columns: 1fr; }
			.tb-filter-actions { grid-column: auto; }
			.tb-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
