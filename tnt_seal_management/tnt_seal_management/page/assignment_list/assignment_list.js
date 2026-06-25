frappe.pages["assignment-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Assignments"),
		single_column: true,
	});

	page.asg_state = {
		search: "",
		status: "All",
		field_technician: "",
		from_date: "",
		to_date: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _asg_load(page));

	const $statsBar = $('<div class="asg-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.asg_stats_bar = $statsBar;

	_asg_inject_styles();
	_asg_build_page(page);
	_asg_load(page);
};

function _asg_build_page(page) {
	const statuses = [
		["All", __("All Assignments")],
		["Pending", __("TO Assigned")],
		["Assigned", __("Assigned")],
		["Awaiting Untagging Assignment", __("Awaiting Untagging")],
		["TO Assigned for Untagging", __("TO Assigned for Untagging")],
		["Untagging Assigned", __("Untagging Assigned")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="asg-page">
			<section class="asg-panel">
				<div class="asg-toolbar">
					<div class="asg-toolbar-top">
						<label class="asg-field asg-search-inline">
							<input class="asg-search" type="search" placeholder="${__("Assignment, job order, booking, client or location")}">
						</label>

						<div class="asg-filter-dropdown">
							<button class="asg-filter-btn">
								<span class="asg-filter-btn-label">${__("All Assignments")}</span>
								<span class="asg-filter-btn-count">0</span>
								<span class="asg-filter-arrow">&#9662;</span>
							</button>
							<div class="asg-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="asg-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="asg-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="asg-field asg-technician-field">
							<span>${__("Tag Operator")}</span>
							<div class="asg-technician-filter"></div>
						</label>

						<label class="asg-field asg-date-field">
							<span>${__("From")}</span>
							<input class="asg-from-date" type="date">
						</label>
						<label class="asg-field asg-date-field">
							<span>${__("To")}</span>
							<input class="asg-to-date" type="date">
						</label>
						<div class="asg-actions">
							<button class="asg-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="asg-table-panel">
				<div class="asg-table-scroll"><div class="asg-table-wrap"></div></div>
				<div class="asg-pagination"></div>
			</section>

			<div class="asg-loading" style="display:none"><div class="asg-spinner"></div></div>
		</div>
	`);

	page.asg_technician_control = frappe.ui.form.make_control({
		parent: $(page.body).find(".asg-technician-filter"),
		df: {
			fieldname: "field_technician",
			fieldtype: "Link",
			options: "User",
			placeholder: __("All Tag Operators"),
			get_query: () => ({
				query:
					"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.field_technician_query",
			}),
		},
		render_input: true,
	});

	const delayedSearch = _asg_debounce(() => {
		page.asg_state.search = ($(page.body).find(".asg-search").val() || "").trim();
		page.asg_state.page = 1;
		_asg_load(page);
	}, 350);

	$(page.body).on("input", ".asg-search", delayedSearch);

	page.asg_technician_control.$input.on("change", () => {
		page.asg_state.field_technician = page.asg_technician_control.get_value() || "";
		page.asg_state.page = 1;
		_asg_load(page);
	});

	$(page.body).on("change", ".asg-from-date, .asg-to-date", () => {
		page.asg_state.from_date = $(page.body).find(".asg-from-date").val() || "";
		page.asg_state.to_date = $(page.body).find(".asg-to-date").val() || "";
		page.asg_state.page = 1;
		_asg_load(page);
	});

	$(page.body).on("click", ".asg-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".asg-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".asg-filter-item", function () {
		page.asg_state.status = $(this).data("status");
		page.asg_state.page = 1;
		$(page.body).find(".asg-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".asg-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".asg-filter-menu").removeClass("open");
		_asg_load(page);
	});

	$(document).on("click.asg-dropdown", function () {
		$(page.body).find(".asg-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".asg-clear-btn", () => _asg_clear(page));

	$(page.body).on("click", ".asg-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "PCB Assignment", name);
	});

	$(page.body).on("click", ".asg-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.asg_state.page = Number.parseInt($(this).data("page"), 10);
		_asg_load(page);
	});
}

function _asg_load(page) {
	const requestId = ++page.asg_state.request_id;
	_asg_set_loading(page, true);
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment.get_assignment_list",
		args: {
			search: page.asg_state.search,
			status: page.asg_state.status,
			field_technician: page.asg_state.field_technician,
			from_date: page.asg_state.from_date,
			to_date: page.asg_state.to_date,
			page: page.asg_state.page,
			page_length: page.asg_state.page_length,
		},
		callback(r) {
			if (requestId !== page.asg_state.request_id) return;
			_asg_set_loading(page, false);
			const data = r.message || {};
			page.asg_state.total = data.total || 0;
			_asg_render_stats(page, data.summary || {});
			_asg_render_table(page, data.assignments || []);
			_asg_render_pagination(page);
		},
		error() {
			if (requestId !== page.asg_state.request_id) return;
			_asg_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load assignments"), indicator: "red" }, 5);
		},
	});
}

function _asg_render_stats(page, summary) {
	const html = `
		<div class="asg-stat-card">
			<div class="asg-stat-label">${__("All")}</div>
			<div class="asg-stat-value">${summary.All || 0}</div>
		</div>
		<div class="asg-stat-card asg-stat--pending">
			<div class="asg-stat-label">${__("TO Assigned")}</div>
			<div class="asg-stat-value">${summary.Pending || 0}</div>
		</div>
		<div class="asg-stat-card asg-stat--assigned">
			<div class="asg-stat-label">${__("Assigned")}</div>
			<div class="asg-stat-value">${summary.Assigned || 0}</div>
		</div>
		<div class="asg-stat-card asg-stat--untagging">
			<div class="asg-stat-label">${__("Awaiting Untagging")}</div>
			<div class="asg-stat-value">${summary["Awaiting Untagging Assignment"] || 0}</div>
		</div>
		<div class="asg-stat-card asg-stat--untagging">
			<div class="asg-stat-label">${__("To Approve Untagging")}</div>
			<div class="asg-stat-value">${summary["TO Assigned for Untagging"] || 0}</div>
		</div>
		<div class="asg-stat-card asg-stat--cancelled">
			<div class="asg-stat-label">${__("Cancelled")}</div>
			<div class="asg-stat-value">${summary.Cancelled || 0}</div>
		</div>
	`;
	if (page.asg_stats_bar) {
		page.asg_stats_bar.html(html);
	}

	const countMap = {
		"All": summary.All || 0,
		"Pending": summary.Pending || 0,
		"Assigned": summary.Assigned || 0,
		"Awaiting Untagging Assignment": summary["Awaiting Untagging Assignment"] || 0,
		"TO Assigned for Untagging": summary["TO Assigned for Untagging"] || 0,
		"Untagging Assigned": summary["Untagging Assigned"] || 0,
		"Cancelled": summary.Cancelled || 0,
	};
	$(page.body).find(".asg-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(countMap[key] ?? 0);
	});
	const currentCount = countMap[page.asg_state.status] ?? 0;
	$(page.body).find(".asg-filter-btn-count").text(currentCount);
}

function _asg_render_table(page, assignments) {
	if (!assignments.length) {
		$(page.body).find(".asg-table-wrap").html(`
			<div class="asg-empty">
				<strong>${__("No assignments found")}</strong>
				<span>${__("Assign a PCB Job Order to a Field Technician from the PCB Job Orders page.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".asg-table-wrap").html(`
		<table class="asg-table">
			<thead><tr>
				<th>${__("Type")}</th>
				<th>${__("Job Order / Journey")}</th>
				<th>${__("Client")}</th>
				<th>${__("Location")}</th>
				<th>${__("Scheduled")}</th>
				<th>${__("Contact Person")}</th>
				<th>${__("Phone")}</th>
				<th>${__("Tag Operator")}</th>
				<th>${__("Status")}</th>
			</tr></thead>
			<tbody>${assignments.map(_asg_row_html).join("")}</tbody>
		</table>
	`);
}

function _asg_row_html(assignment) {
	const status = assignment.assignment_status || "Pending";
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const statusLabel = status === "Pending" ? __("To Assigned") : (status === "Assigned" ? __("Assigned") : status);
	const scheduled = assignment.scheduled_date_time
		? frappe.datetime.str_to_user(assignment.scheduled_date_time)
		: "—";

	const isUntagging = assignment.request_type === "Untagging";
	const typeBadge = isUntagging
		? `<span class="asg-type asg-type--untagging">${__("Untagging")}</span>`
		: `<span class="asg-type asg-type--tagging">${__("Tagging")}</span>`;
	const source = isUntagging
		? (assignment.seal_journey || "—")
		: (assignment.pcb_job_order || "—");

	let clientHtml = frappe.utils.escape_html(assignment.client_name || "—");
	if (assignment.client_name) {
		const words = assignment.client_name.split(" ");
		if (words.length > 3) {
			const truncated = words.slice(0, 3).join(" ") + "...";
			clientHtml = `<span title="${frappe.utils.escape_html(assignment.client_name)}">${frappe.utils.escape_html(truncated)}</span>`;
		}
	}

	return `
		<tr class="asg-row" data-name="${frappe.utils.escape_html(assignment.name)}">
			<td>${typeBadge}</td>
			<td>${frappe.utils.escape_html(source)}</td>
			<td>${clientHtml}</td>
			<td>${frappe.utils.escape_html(assignment.location || "—")}</td>
			<td>${frappe.utils.escape_html(scheduled)}</td>
			<td>${frappe.utils.escape_html(assignment.contact_person_name || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.contact_person_phone || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.assigned_field_technician || "—")}</td>
			<td><span class="asg-badge asg-badge--${statusClass}">${frappe.utils.escape_html(statusLabel)}</span></td>
		</tr>
	`;
}

function _asg_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.asg_state.total / page.asg_state.page_length));
	page.asg_state.page = Math.min(page.asg_state.page, pages);
	const start = page.asg_state.total
		? (page.asg_state.page - 1) * page.asg_state.page_length + 1
		: 0;
	const end = Math.min(page.asg_state.page * page.asg_state.page_length, page.asg_state.total);
	$(page.body).find(".asg-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.asg_state.total])}</span>
		<div>
			<button class="asg-page-btn" data-page="${page.asg_state.page - 1}" ${page.asg_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.asg_state.page, pages])}</b>
			<button class="asg-page-btn" data-page="${page.asg_state.page + 1}" ${page.asg_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _asg_clear(page) {
	Object.assign(page.asg_state, {
		search: "",
		status: "All",
		field_technician: "",
		from_date: "",
		to_date: "",
		page: 1,
	});
	$(page.body).find(".asg-search, .asg-from-date, .asg-to-date").val("");
	$(page.body).find(".asg-filter-item").removeClass("active");
	$(page.body).find('.asg-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".asg-filter-btn-label").text(__("All Assignments"));
	page.asg_technician_control.set_value("");
	_asg_load(page);
}

function _asg_set_loading(page, show) {
	$(page.body).find(".asg-loading").toggle(show);
}

function _asg_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _asg_inject_styles() {
	if (document.getElementById("assignment-list-styles")) return;
	const style = document.createElement("style");
	style.id = "assignment-list-styles";
	style.textContent = `
		.asg-page {
			--asg-blue: #0284c7;
			--asg-dark: #075985;
			--asg-ink: #0c4a6e;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.asg-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.asg-header-stats .asg-stat-card {
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
		.asg-header-stats .asg-stat--pending  { border-top-color: #f59e0b; }
		.asg-header-stats .asg-stat--assigned  { border-top-color: var(--asg-blue); }
		.asg-header-stats .asg-stat--untagging { border-top-color: #ea580c; }
		.asg-header-stats .asg-stat--cancelled { border-top-color: #dc2626; }
		.asg-header-stats .asg-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.asg-header-stats .asg-stat-value {
			color: var(--asg-ink);
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.asg-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.asg-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.asg-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.asg-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.asg-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.asg-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.asg-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.asg-search-inline input:focus {
			outline: none;
			border-color: var(--asg-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.asg-filter-dropdown { position: relative; }
		.asg-filter-btn {
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
		.asg-filter-btn:hover { border-color: var(--asg-blue); }
		.asg-filter-btn-count {
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
		.asg-filter-arrow { color: #94a3b8; font-size: 11px; }
		.asg-filter-menu {
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
		.asg-filter-menu.open { display: block; }
		.asg-filter-item {
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
		.asg-filter-item:hover { background: #f0f9ff; }
		.asg-filter-item.active { background: #e0f2fe; color: var(--asg-blue); }
		.asg-fcount {
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
		.asg-filter-item.active .asg-fcount { background: var(--asg-blue); color: #fff; }

		/* ---- regular fields ---- */
		.asg-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.asg-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.asg-date-field input[type="date"] {
			width: 140px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 10px;
			font-size: 13px;
		}
		.asg-date-field input[type="date"]:focus,
		.asg-technician-filter .control-input:focus-within {
			outline: none;
			border-color: var(--asg-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		.asg-technician-field { min-width: 180px; }
		.asg-technician-filter .control-input {
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			padding: 0;
			overflow: hidden;
		}
		.asg-technician-filter .control-input input {
			border: 0;
			height: 100%;
			padding: 0 12px;
			background: transparent;
			color: var(--text-color, #0c4a6e);
			font-size: 13px;
		}
		.asg-technician-filter .form-group { margin: 0; }
		.asg-technician-filter .control-label,
		.asg-technician-filter .help-box { display: none; }

		/* ---- actions ---- */
		.asg-actions { display: flex; gap: 8px; }
		.asg-clear-btn {
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
		.asg-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		/* ---- table ---- */
		.asg-table {
			width: 100%;
			min-width: 1510px;
			border-collapse: collapse;
			table-layout: auto;
		}
		.asg-table th,
		.asg-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.asg-table th {
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
		.asg-row { cursor: pointer; }
		.asg-row:hover { background: rgba(224, 242, 254, .7); }
		.asg-row td:first-child { border-left: 3px solid transparent; }
		.asg-row:hover td:first-child { border-left-color: var(--asg-blue); }
		.asg-name { color: var(--asg-blue); font-size: 14px; font-weight: 800; }
		.asg-badge {
			display: inline-flex;
			border-radius: 999px;
			padding: 6px 11px;
			font-size: 12px;
			font-weight: 800;
			white-space: nowrap;
		}
		.asg-badge--assigned  { background: #dbeafe; color: #1d4ed8; }
		.asg-badge--pending   { background: #fef3c7; color: #92400e; }
		.asg-badge--awaiting-untagging-assignment { background: #fed7aa; color: #9a3412; }
		.asg-badge--to-assigned-for-untagging { background: #fef08a; color: #854d0e; }
		.asg-badge--untagging-assigned { background: #ddd6fe; color: #5b21b6; }
		.asg-badge--cancelled { background: #fee2e2; color: #b91c1c; }
		.asg-type {
			display: inline-flex;
			border-radius: 6px;
			padding: 3px 8px;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .03em;
		}
		.asg-type--tagging { background: #e0f2fe; color: #0369a1; }
		.asg-type--untagging { background: #fff7ed; color: #c2410c; }
		.asg-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			padding: 58px 20px;
			color: var(--text-muted, #64748b);
			text-align: center;
		}
		.asg-empty strong {
			color: var(--asg-ink);
			font-size: 22px;
		}

		/* ---- pagination ---- */
		.asg-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.asg-pagination div { display: flex; align-items: center; gap: 9px; }
		.asg-pagination b { font-weight: 700; }
		.asg-page-btn {
			padding: 8px 16px;
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.asg-page-btn:not([disabled]):hover {
			background: #f0f9ff;
			border-color: var(--asg-blue);
			color: var(--asg-blue);
			box-shadow: 0 4px 6px rgba(14, 165, 233, .1);
		}
		.asg-page-btn:not([disabled]):active {
			box-shadow: 0 1px 2px rgba(14, 165, 233, .05);
		}
		.asg-page-btn[disabled] {
			opacity: .6;
			cursor: not-allowed;
			background: #f8fafc;
			border-color: #e2e8f0;
			color: #94a3b8;
			box-shadow: none;
		}

		/* ---- loading overlay ---- */
		.asg-loading {
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
		.asg-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--asg-blue);
			border-radius: 50%;
			animation: asg-spin .7s linear infinite;
		}
		@keyframes asg-spin { to { transform: rotate(360deg); } }

		/* ---- dark mode ---- */
		[data-theme="dark"] .asg-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .asg-panel,
		[data-theme="dark"] .asg-table-panel,
		[data-theme="dark"] .asg-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .asg-search-inline input,
		[data-theme="dark"] .asg-date-field input[type="date"],
		[data-theme="dark"] .asg-technician-filter .control-input,
		[data-theme="dark"] .asg-filter-btn,
		[data-theme="dark"] .asg-filter-menu,
		[data-theme="dark"] .asg-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .asg-field > span { color: #7dd3fc; }
		[data-theme="dark"] .asg-toolbar,
		[data-theme="dark"] .asg-table th,
		[data-theme="dark"] .asg-pagination {
			background: #0f172a;
			border-color: #334155;
			color: #7dd3fc;
		}
		[data-theme="dark"] .asg-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .asg-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .asg-loading { background: rgba(15, 23, 42, .62); }

		@media (max-width: 1100px) {
			.asg-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.asg-page { padding: 10px 8px 32px; }
			.asg-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
