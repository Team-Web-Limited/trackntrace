frappe.pages["pcb-job-order-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("PCB Job Orders"),
		single_column: true,
	});

	page.pjo_state = {
		search: "",
		status: "All",
		team_leader: "",
		from_date: "",
		to_date: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Excel"), () => _pjo_export_excel(page), __("Download Report"));
	page.add_inner_button(__("PDF"), () => _pjo_export_pdf(page), __("Download Report"));
	page.add_inner_button(__("Refresh"), () => _pjo_load(page));

	const $statsBar = $('<div class="pjo-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.pjo_stats_bar = $statsBar;

	_pjo_inject_styles();
	_pjo_build_page(page);
	_pjo_load(page);
};

function _pjo_build_page(page) {
	const statuses = [
		["All", __("All Job Orders")],
		["Unassigned", __("Unassigned")],
		["Team Leader Assigned", __("Assigned")],
		["Completed", __("Completed")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="pjo-page">
			<section class="pjo-panel">
				<div class="pjo-toolbar">
					<div class="pjo-toolbar-top">
						<label class="pjo-field pjo-search-inline">
							<input class="pjo-search" type="search" placeholder="${__("Job order, booking, client, location or contact")}">
						</label>

						<div class="pjo-filter-dropdown">
							<button class="pjo-filter-btn">
								<span class="pjo-filter-btn-label">${__("All Job Orders")}</span>
								<span class="pjo-filter-btn-count">0</span>
								<span class="pjo-filter-arrow">&#9662;</span>
							</button>
							<div class="pjo-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="pjo-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="pjo-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>


						<label class="pjo-field pjo-date-field">
							<span>${__("From")}</span>
							<input class="pjo-from-date" type="date">
						</label>
						<label class="pjo-field pjo-date-field">
							<span>${__("To")}</span>
							<input class="pjo-to-date" type="date">
						</label>
						<div class="pjo-actions">
							<button class="pjo-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="pjo-table-panel">
				<div class="pjo-table-scroll"><div class="pjo-table-wrap"></div></div>
				<div class="pjo-pagination"></div>
			</section>

			<div class="pjo-loading" style="display:none"><div class="pjo-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _pjo_debounce(() => {
		page.pjo_state.search = ($(page.body).find(".pjo-search").val() || "").trim();
		page.pjo_state.page = 1;
		_pjo_load(page);
	}, 350);

	$(page.body).on("input", ".pjo-search", delayedSearch);

	$(page.body).on("change", ".pjo-from-date, .pjo-to-date", () => {
		page.pjo_state.from_date = $(page.body).find(".pjo-from-date").val() || "";
		page.pjo_state.to_date = $(page.body).find(".pjo-to-date").val() || "";
		page.pjo_state.page = 1;
		_pjo_load(page);
	});

	$(page.body).on("click", ".pjo-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".pjo-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".pjo-filter-item", function () {
		page.pjo_state.status = $(this).data("status");
		page.pjo_state.page = 1;
		$(page.body).find(".pjo-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".pjo-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".pjo-filter-menu").removeClass("open");
		_pjo_load(page);
	});

	$(document).on("click.pjo-dropdown", function () {
		$(page.body).find(".pjo-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".pjo-clear-btn", () => _pjo_clear_filters(page));

	$(page.body).on("click", ".pjo-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "PCB Job Order", name);
	});

	$(page.body).on("click", ".pjo-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.pjo_state.page = Number.parseInt($(this).data("page"), 10);
		_pjo_load(page);
	});
}

function _pjo_load(page) {
	const requestId = ++page.pjo_state.request_id;
	_pjo_set_loading(page, true);
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.get_job_order_list",
		args: {
			search: page.pjo_state.search,
			status: page.pjo_state.status,
			team_leader: page.pjo_state.team_leader,
			from_date: page.pjo_state.from_date,
			to_date: page.pjo_state.to_date,
			page: page.pjo_state.page,
			page_length: page.pjo_state.page_length,
		},
		callback(r) {
			if (requestId !== page.pjo_state.request_id) return;
			_pjo_set_loading(page, false);
			const data = r.message || {};
			page.pjo_state.total = data.total || 0;
			_pjo_render_stats(page, data.summary || {});
			_pjo_render_table(page, data.job_orders || []);
			_pjo_render_pagination(page);
		},
		error() {
			if (requestId !== page.pjo_state.request_id) return;
			_pjo_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load PCB Job Orders"), indicator: "red" }, 5);
		},
	});
}

// ---------------------------------------------------------------------------
// PDF export — mirrors the Seal Device Dashboard's export (build HTML
// client-side from the full filtered set, POST it to a whitelisted method
// that renders it with get_pdf), styled in the app's blue theme.
// ---------------------------------------------------------------------------

function _pjo_export_pdf(page) {
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.get_all_job_orders_for_export",
		args: {
			search: page.pjo_state.search,
			status: page.pjo_state.status,
			team_leader: page.pjo_state.team_leader,
			from_date: page.pjo_state.from_date,
			to_date: page.pjo_state.to_date,
		},
		freeze: true,
		freeze_message: __("Preparing report…"),
		callback(r) {
			const jobOrders = r.message || [];
			if (!jobOrders.length) {
				frappe.show_alert({ message: __("No PCB Job Orders match the current filters."), indicator: "orange" }, 5);
				return;
			}

			const filterLabel = $(page.body).find(".pjo-filter-btn-label").text() || __("All Job Orders");
			const generatedOn = frappe.datetime.str_to_user(frappe.datetime.now_datetime());

			const rows = jobOrders.map(_pjo_pdf_row_html).join("");
			const html = `
				<html>
					<head>
						<title>${__("PCB Job Order Report")}</title>
						<style>${_pjo_print_styles()}</style>
					</head>
					<body>
						<table class="pjo-print-header">
							<tr>
								<td class="pjo-print-header-title">
									<h2>${__("PCB Job Order Report")}</h2>
									<p class="pjo-print-meta">
										${__("Status")}: ${frappe.utils.escape_html(filterLabel)}
										&nbsp;•&nbsp; ${__("Generated")}: ${generatedOn}
										&nbsp;•&nbsp; ${__("{0} job order(s)", [jobOrders.length])}
									</p>
								</td>
								<td class="pjo-print-header-logo">{{TNT_LOGO}}</td>
							</tr>
						</table>
						<table class="pjo-print-table">
							<thead>
								<tr>
									<th>${__("Job Order")}</th>
									<th>${__("Tagging Booking")}</th>
									<th>${__("Client")}</th>
									<th>${__("Location")}</th>
									<th>${__("Scheduled")}</th>
									<th>${__("Contact Person")}</th>
									<th>${__("Phone")}</th>
									<th>${__("PCB Team Leader")}</th>
									<th>${__("Status")}</th>
								</tr>
							</thead>
							<tbody>${rows}</tbody>
						</table>
					</body>
				</html>
			`;

			open_url_post("/api/method/tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.export_pdf", {
				html: html,
				filename: `PCB Job Order Report - ${frappe.datetime.get_today()}`,
			});
		},
		error() {
			frappe.show_alert({ message: __("Failed to prepare the report"), indicator: "red" }, 5);
		},
	});
}

// ---------------------------------------------------------------------------
// Excel export — the same filtered set as the PDF, but built server-side into
// an .xlsx workbook so the rows stay sortable/filterable in a spreadsheet.
// ---------------------------------------------------------------------------

function _pjo_export_excel(page) {
	// The server throws on an empty result, which would replace this page with
	// an error page (open_url_post posts the current window), so guard here
	// using the count the last load reported for these same filters.
	if (!page.pjo_state.total) {
		frappe.show_alert({ message: __("No PCB Job Orders match the current filters."), indicator: "orange" }, 5);
		return;
	}

	open_url_post("/api/method/tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.export_excel", {
		search: page.pjo_state.search,
		status: page.pjo_state.status,
		team_leader: page.pjo_state.team_leader,
		from_date: page.pjo_state.from_date,
		to_date: page.pjo_state.to_date,
		filename: `PCB Job Order Report - ${frappe.datetime.get_today()}`,
	});
}

function _pjo_pdf_row_html(order) {
	const esc = frappe.utils.escape_html;
	const dash = "—";
	const status = order.job_order_status || __("Unassigned");
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const scheduled = order.scheduled_date_time
		? frappe.datetime.str_to_user(order.scheduled_date_time)
		: dash;

	return `
		<tr>
			<td>${esc(order.name)}</td>
			<td>${esc(order.tagging_booking || dash)}</td>
			<td>${esc(order.client_name || dash)}</td>
			<td>${esc(order.location || dash)}</td>
			<td>${esc(scheduled)}</td>
			<td>${esc(order.contact_person_name || dash)}</td>
			<td>${esc(order.contact_person_phone || dash)}</td>
			<td>${esc(order.assigned_pcb_team_leader || __("Not assigned"))}</td>
			<td><span class="pjo-print-badge pjo-print-badge--${statusClass}">${esc(status === "Completed" ? __("Assignment Completed") : status)}</span></td>
		</tr>
	`;
}

function _pjo_print_styles() {
	return `
		body { font-family: sans-serif; padding: 24px; color: #0c4a6e; }
		h2 { margin-top: 0; margin-bottom: 2px; color: #075985; }
		/* Table, not flexbox: the wkhtmltopdf on this box predates the patched
		   Qt WebKit and ignores flex, which drops the logo below the title. */
		.pjo-print-header {
			width: 100%;
			border-collapse: collapse;
			margin-bottom: 16px;
		}
		.pjo-print-header td {
			padding: 0 0 14px 0;
			vertical-align: middle;
			border-bottom: 3px solid #0284c7;
		}
		.pjo-print-header-logo { width: 240px; text-align: right; }
		.pjo-print-meta { color: #0369a1; margin-top: 4px; margin-bottom: 0; font-size: 12px; }
		.tnt-pdf-logo { max-height: 60px; max-width: 220px; }
		.pjo-print-table { width: 100%; border-collapse: collapse; font-size: 11px; }
		.pjo-print-table th, .pjo-print-table td {
			border-bottom: 1px solid #e0f2fe;
			padding: 7px 8px;
			text-align: left;
		}
		.pjo-print-table th {
			background: #0284c7;
			color: #fff;
			font-weight: 700;
			text-transform: uppercase;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.pjo-print-table tbody tr:nth-child(even) { background: #f0f9ff; }
		.pjo-print-badge {
			display: inline-block;
			border-radius: 999px;
			padding: 3px 9px;
			font-size: 10px;
			font-weight: 700;
		}
		.pjo-print-badge--unassigned { background: #fef3c7; color: #92400e; }
		.pjo-print-badge--team-leader-assigned { background: #dbeafe; color: #1d4ed8; }
		.pjo-print-badge--completed { background: #dcfce7; color: #166534; }
		.pjo-print-badge--cancelled { background: #fee2e2; color: #b91c1c; }
	`;
}

function _pjo_render_stats(page, summary) {
	const html = `
		<div class="pjo-stat-card">
			<div class="pjo-stat-label">${__("All")}</div>
			<div class="pjo-stat-value">${summary.All || 0}</div>
		</div>
		<div class="pjo-stat-card pjo-stat--unassigned">
			<div class="pjo-stat-label">${__("Unassigned")}</div>
			<div class="pjo-stat-value">${summary.Unassigned || 0}</div>
		</div>
		<div class="pjo-stat-card pjo-stat--assigned">
			<div class="pjo-stat-label">${__("Assigned")}</div>
			<div class="pjo-stat-value">${summary["Team Leader Assigned"] || 0}</div>
		</div>
		<div class="pjo-stat-card pjo-stat--completed">
			<div class="pjo-stat-label">${__("Completed")}</div>
			<div class="pjo-stat-value">${summary.Completed || 0}</div>
		</div>
	`;
	if (page.pjo_stats_bar) {
		page.pjo_stats_bar.html(html);
	}

	const countMap = {
		"All": summary.All || 0,
		"Unassigned": summary.Unassigned || 0,
		"Team Leader Assigned": summary["Team Leader Assigned"] || 0,
		"Completed": summary.Completed || 0,
		"Cancelled": summary.Cancelled || 0,
	};
	$(page.body).find(".pjo-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	const currentCount = countMap[page.pjo_state.status] ?? 0;
	$(page.body).find(".pjo-filter-btn-count").text(currentCount);
}

function _pjo_render_table(page, jobOrders) {
	if (!jobOrders.length) {
		$(page.body).find(".pjo-table-wrap").html(`
			<div class="pjo-empty">
				<strong>${__("No PCB Job Orders found")}</strong>
				<span>${__("Job orders are created automatically when Finance approves a tagging booking.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".pjo-table-wrap").html(`
		<table class="pjo-table">
			<thead><tr>
				<th>${__("Status")}</th>
				<th>${__("Tagging Booking")}</th>
				<th>${__("Client")}</th>
				<th>${__("Location")}</th>
				<th>${__("Scheduled")}</th>
				<th>${__("Contact Person")}</th>
				<th>${__("Phone")}</th>
				<th>${__("PCB Team Leader")}</th>
				<th>${__("Job Order")}</th>
			</tr></thead>
			<tbody>${jobOrders.map(_pjo_row_html).join("")}</tbody>
		</table>
	`);
}

function _pjo_row_html(order) {
	const status = order.job_order_status || __("Unassigned");
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const scheduled = order.scheduled_date_time
		? frappe.datetime.str_to_user(order.scheduled_date_time)
		: "—";
	const displayStatus = status === "Completed" ? __("Assignment Completed") : status;

	const rawClient = order.client_name || "";
	const clientWords = rawClient.split(" ");
	let displayClient = rawClient;
	if (clientWords.length > 3) {
		displayClient = clientWords.slice(0, 3).join(" ") + "...";
	}

	return `
		<tr class="pjo-row" data-name="${frappe.utils.escape_html(order.name)}">
			<td><span class="pjo-badge pjo-badge--${statusClass}">${frappe.utils.escape_html(displayStatus)}</span></td>
			<td>${frappe.utils.escape_html(order.tagging_booking || "—")}</td>
			<td title="${frappe.utils.escape_html(rawClient)}">${frappe.utils.escape_html(displayClient || "—")}</td>
			<td>${frappe.utils.escape_html(order.location || "—")}</td>
			<td>${frappe.utils.escape_html(scheduled)}</td>
			<td>${frappe.utils.escape_html(order.contact_person_name || "—")}</td>
			<td>${frappe.utils.escape_html(order.contact_person_phone || "—")}</td>
			<td>${frappe.utils.escape_html(order.assigned_pcb_team_leader || __("Not assigned"))}</td>
			<td><span class="pjo-name">${frappe.utils.escape_html(order.name)}</span></td>
		</tr>
	`;
}

function _pjo_render_pagination(page) {
	const totalPages = Math.max(1, Math.ceil(page.pjo_state.total / page.pjo_state.page_length));
	page.pjo_state.page = Math.min(page.pjo_state.page, totalPages);
	const start = page.pjo_state.total
		? (page.pjo_state.page - 1) * page.pjo_state.page_length + 1
		: 0;
	const end = Math.min(page.pjo_state.page * page.pjo_state.page_length, page.pjo_state.total);
	$(page.body).find(".pjo-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.pjo_state.total])}</span>
		<div>
			<button class="pjo-page-btn" data-page="${page.pjo_state.page - 1}" ${page.pjo_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.pjo_state.page, totalPages])}</b>
			<button class="pjo-page-btn" data-page="${page.pjo_state.page + 1}" ${page.pjo_state.page >= totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _pjo_clear_filters(page) {
	Object.assign(page.pjo_state, {
		search: "",
		status: "All",
		team_leader: "",
		from_date: "",
		to_date: "",
		page: 1,
	});
	$(page.body).find(".pjo-search, .pjo-from-date, .pjo-to-date").val("");
	$(page.body).find(".pjo-filter-item").removeClass("active");
	$(page.body).find('.pjo-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".pjo-filter-btn-label").text(__("All Job Orders"));
	_pjo_load(page);
}

function _pjo_set_loading(page, show) {
	$(page.body).find(".pjo-loading").toggle(show);
}

function _pjo_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _pjo_inject_styles() {
	if (document.getElementById("pcb-job-order-list-styles")) return;
	const style = document.createElement("style");
	style.id = "pcb-job-order-list-styles";
	style.textContent = `
		.pjo-page {
			--pjo-blue: #0284c7;
			--pjo-dark: #075985;
			--pjo-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.pjo-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.pjo-header-stats .pjo-stat-card {
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
		.pjo-header-stats .pjo-stat--unassigned { border-top-color: #f59e0b; }
		.pjo-header-stats .pjo-stat--assigned { border-top-color: var(--pjo-blue); }
		.pjo-header-stats .pjo-stat--completed { border-top-color: #16a34a; }
		.pjo-header-stats .pjo-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.pjo-header-stats .pjo-stat-value {
			color: var(--pjo-ink);
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.pjo-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.pjo-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.pjo-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.pjo-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.pjo-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.pjo-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.pjo-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.pjo-search-inline input:focus {
			outline: none;
			border-color: var(--pjo-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.pjo-filter-dropdown { position: relative; }
		.pjo-filter-btn {
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
		.pjo-filter-btn:hover { border-color: var(--pjo-blue); }
		.pjo-filter-btn-count {
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
		.pjo-filter-arrow { color: #94a3b8; font-size: 11px; }
		.pjo-filter-menu {
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
		.pjo-filter-menu.open { display: block; }
		.pjo-filter-item {
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
		.pjo-filter-item:hover { background: #f0f9ff; }
		.pjo-filter-item.active { background: #e0f2fe; color: var(--pjo-blue); }
		.pjo-fcount {
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
		.pjo-filter-item.active .pjo-fcount { background: var(--pjo-blue); color: #fff; }

		/* ---- regular fields ---- */
		.pjo-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.pjo-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.pjo-date-field input[type="date"] {
			width: 140px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 10px;
			font-size: 13px;
		}
		.pjo-date-field input[type="date"]:focus,
		.pjo-team-leader-filter .control-input:focus-within {
			outline: none;
			border-color: var(--pjo-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		.pjo-team-leader-field { min-width: 180px; }
		.pjo-team-leader-filter .control-input {
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			padding: 0;
			overflow: hidden;
		}
		.pjo-team-leader-filter .control-input input {
			border: 0;
			height: 100%;
			padding: 0 12px;
			background: transparent;
			color: var(--text-color, #0c4a6e);
			font-size: 13px;
		}
		.pjo-team-leader-filter .form-group { margin: 0; }
		.pjo-team-leader-filter .control-label,
		.pjo-team-leader-filter .help-box { display: none; }

		/* ---- actions ---- */
		.pjo-actions { display: flex; gap: 8px; }
		.pjo-clear-btn {
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
		.pjo-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.pjo-table {
			width: 100%;
			min-width: 1480px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.pjo-table th,
		.pjo-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
			white-space: nowrap;
		}
		.pjo-table th {
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
		.pjo-row { cursor: pointer; }
		.pjo-row:hover { background: rgba(224, 242, 254, .7); }
		.pjo-row td:first-child { border-left: 3px solid transparent; }
		.pjo-row:hover td:first-child { border-left-color: var(--pjo-blue); }
		.pjo-name { color: var(--pjo-blue); font-size: 14px; font-weight: 800; }
		.pjo-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.pjo-badge--unassigned { background: #fef3c7; color: #92400e; }
		.pjo-badge--team-leader-assigned { background: #dbeafe; color: #1d4ed8; }
		.pjo-badge--completed { background: #dcfce7; color: #166534; }
		.pjo-badge--cancelled { background: #fee2e2; color: #b91c1c; }
		.pjo-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.pjo-empty strong {
			color: var(--pjo-ink);
			font-size: 22px;
		}

		/* ---- pagination ---- */
		.pjo-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.pjo-pagination div { display: flex; align-items: center; gap: 9px; }
		.pjo-pagination b { font-weight: 700; }
		.pjo-page-btn {
			padding: 6px 12px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #075985;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.pjo-page-btn:disabled { cursor: default; opacity: .45; }

		/* ---- loading overlay ---- */
		.pjo-loading {
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
		.pjo-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--pjo-blue);
			border-radius: 50%;
			animation: pjo-spin .7s linear infinite;
		}
		@keyframes pjo-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .pjo-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .pjo-panel,
		[data-theme="dark"] .pjo-table-panel,
		[data-theme="dark"] .pjo-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .pjo-search-inline input,
		[data-theme="dark"] .pjo-date-field input[type="date"],
		[data-theme="dark"] .pjo-team-leader-filter .control-input,
		[data-theme="dark"] .pjo-filter-btn,
		[data-theme="dark"] .pjo-filter-menu,
		[data-theme="dark"] .pjo-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .pjo-field > span { color: #7dd3fc; }
		[data-theme="dark"] .pjo-toolbar,
		[data-theme="dark"] .pjo-table th,
		[data-theme="dark"] .pjo-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .pjo-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .pjo-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .pjo-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.pjo-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.pjo-page { padding: 10px 8px 32px; }
			.pjo-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
