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
	_asg_inject_styles();
	_asg_build_page(page);
	_asg_load(page);
};

function _asg_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Pending", __("Pending")],
		["Assigned", __("Assigned")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="asg-page">
			<section class="asg-panel">
				<div class="asg-toolbar">
					<div class="asg-toolbar-top">
						<div class="asg-status-filters">
							${statuses.map(([value, label]) => `
								<button class="asg-status-btn ${value === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(value)}">
									${frappe.utils.escape_html(label)}
								</button>
							`).join("")}
						</div>
						<section class="asg-stats"></section>
					</div>
					<div class="asg-filter-grid">
						<label class="asg-field">
							<span>${__("Search")}</span>
							<input class="asg-search" type="search" placeholder="${__("Assignment, job order, booking, client or location")}">
						</label>
						<label class="asg-field">
							<span>${__("Tag Operator")}</span>
							<div class="asg-technician-filter"></div>
						</label>
						<label class="asg-field">
							<span>${__("From")}</span>
							<input class="asg-from-date" type="date">
						</label>
						<label class="asg-field">
							<span>${__("To")}</span>
							<input class="asg-to-date" type="date">
						</label>
						<div class="asg-actions">
							<button class="asg-clear-btn">${__("Clear filters")}</button>
							<button class="asg-refresh-btn">${__("Refresh")}</button>
						</div>
					</div>
				</div>
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
	$(page.body).on("click", ".asg-status-btn", function () {
		$(page.body).find(".asg-status-btn").removeClass("active");
		$(this).addClass("active");
		page.asg_state.status = $(this).data("status");
		page.asg_state.page = 1;
		_asg_load(page);
	});
	$(page.body).on("click", ".asg-refresh-btn", () => _asg_load(page));
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
	const stats = [
		[__("All Assignments"), summary.All || 0, "all"],
		[__("Pending"), summary.Pending || 0, "progress"],
		[__("Assigned"), summary.Assigned || 0, "assigned"],
		[__("Cancelled"), summary.Cancelled || 0, "completed"],
	];
	$(page.body).find(".asg-stats").html(
		stats.map(([label, value, variant]) => `
			<div class="asg-stat asg-stat--${variant}">
				<span>${frappe.utils.escape_html(label)}</span><strong>${value}</strong>
			</div>
		`).join("")
	);
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
				<th>${__("Assignment")}</th>
				<th>${__("PCB Job Order")}</th>
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
	const status = assignment.assignment_status || __("Pending");
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const scheduled = assignment.scheduled_date_time
		? frappe.datetime.str_to_user(assignment.scheduled_date_time)
		: "—";
	return `
		<tr class="asg-row" data-name="${frappe.utils.escape_html(assignment.name)}">
			<td><span class="asg-name">${frappe.utils.escape_html(assignment.name)}</span></td>
			<td>${frappe.utils.escape_html(assignment.pcb_job_order || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.client_name || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.location || "—")}</td>
			<td>${frappe.utils.escape_html(scheduled)}</td>
			<td>${frappe.utils.escape_html(assignment.contact_person_name || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.contact_person_phone || "—")}</td>
			<td>${frappe.utils.escape_html(assignment.assigned_field_technician || "—")}</td>
			<td><span class="asg-badge asg-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
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
	$(page.body).find(".asg-status-btn").removeClass("active");
	$(page.body).find('.asg-status-btn[data-status="All"]').addClass("active");
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
			max-width: 1540px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}
		.asg-stats {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px;
			min-width: 0;
		}
		.asg-stat {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			min-height: 78px;
			padding: 16px 18px;
			border: 1px solid rgba(14,165,233,.2);
			border-top: 4px solid #38bdf8;
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14,165,233,.05);
		}
		.asg-stat--all,
		.asg-stat--progress { background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border-color: #bae6fd; }
		.asg-stat--all { border-top-color: #075985; }
		.asg-stat--assigned { border-top-color: #0284c7; }
		.asg-stat--progress { border-top-color: #f59e0b; }
		.asg-stat--completed { border-top-color: #16a34a; }
		.asg-stat span { max-width: 130px; color: #0369a1; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
		.asg-stat strong { color: #0c4a6e; font-size: 34px; line-height: 1; }
		.asg-panel { overflow: hidden; border: 1px solid rgba(14,165,233,.2); border-radius: 22px; background: var(--card-bg,#fff); box-shadow: 0 4px 12px rgba(14,165,233,.05); }
		.asg-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.asg-toolbar-top {
			display: grid;
			grid-template-columns: minmax(0, auto) minmax(720px, 1fr);
			align-items: start;
			gap: 18px;
			margin-bottom: 14px;
		}
		.asg-status-filters { display: flex; gap: 8px; overflow-x: auto; }
		.asg-status-btn,
		.asg-clear-btn,
		.asg-refresh-btn,
		.asg-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 999px;
			background: var(--card-bg,#fff);
			color: #075985;
			padding: 9px 15px;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.asg-status-btn.active,
		.asg-refresh-btn { border-color: var(--asg-blue); background: var(--asg-blue); color: #fff; }
		.asg-filter-grid { display: grid; grid-template-columns: minmax(300px,1.6fr) minmax(240px,1fr) 170px 170px auto; align-items: end; gap: 12px; }
		.asg-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.asg-field > span { color: #0369a1; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
		.asg-field input,
		.asg-technician-filter .control-input {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg,#fff);
			color: var(--text-color,#0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.asg-technician-filter .form-group { margin: 0; }
		.asg-technician-filter .control-label,
		.asg-technician-filter .help-box { display: none; }
		.asg-actions { display: flex; gap: 8px; padding-bottom: 1px; }
		.asg-table-scroll { overflow-x: auto; }
		.asg-table { width: 100%; min-width: 1510px; border-collapse: collapse; }
		.asg-table th,
		.asg-table td { padding: 16px 18px; border-bottom: 1px solid #e0f2fe; text-align: left; vertical-align: middle; color: var(--text-color,#334155); font-size: 14px; line-height: 1.45; }
		.asg-table th { background: #f0f9ff; color: #0369a1; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.asg-row { cursor: pointer; }
		.asg-row:hover { background: rgba(224,242,254,.7); }
		.asg-name { color: var(--asg-blue); font-size: 16px; font-weight: 800; }
		.asg-badge { display: inline-flex; border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 800; white-space: nowrap; }
		.asg-badge--assigned { background: #dbeafe; color: #1d4ed8; }
		.asg-badge--pending { background: #fef3c7; color: #92400e; }
		.asg-badge--cancelled { background: #fee2e2; color: #b91c1c; }
		.asg-empty { padding: 60px 20px; text-align: center; color: #64748b; }
		.asg-empty strong { display: block; margin-bottom: 6px; color: #0c4a6e; font-size: 22px; }
		.asg-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 18px; background: #f0f9ff; color: #0369a1; font-size: 13px; }
		.asg-pagination div { display: flex; align-items: center; gap: 9px; }
		.asg-page-btn:disabled { cursor: default; opacity: .45; }
		.asg-loading { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: rgba(240,249,255,.72); backdrop-filter: blur(2px); }
		.asg-spinner { width: 38px; height: 38px; border: 3px solid rgba(14,165,233,.18); border-top-color: var(--asg-blue); border-radius: 50%; animation: asg-spin .7s linear infinite; }
		@keyframes asg-spin { to { transform: rotate(360deg); } }
		[data-theme="dark"] .asg-stat,
		[data-theme="dark"] .asg-panel,
		[data-theme="dark"] .asg-status-btn,
		[data-theme="dark"] .asg-clear-btn,
		[data-theme="dark"] .asg-page-btn,
		[data-theme="dark"] .asg-field input,
		[data-theme="dark"] .asg-technician-filter .control-input { background: #1e293b; border-color: #334155; color: #f1f5f9; }
		[data-theme="dark"] .asg-stat--all,
		[data-theme="dark"] .asg-stat--progress { background: linear-gradient(135deg,#075985,#0369a1); border-color: #0284c7; }
		[data-theme="dark"] .asg-stat span,
		[data-theme="dark"] .asg-field > span { color: #7dd3fc; }
		[data-theme="dark"] .asg-stat strong { color: #f8fafc; }
		[data-theme="dark"] .asg-toolbar,
		[data-theme="dark"] .asg-table th,
		[data-theme="dark"] .asg-pagination { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .asg-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .asg-row:hover { background: rgba(14,165,233,.12); }
		[data-theme="dark"] .asg-loading { background: rgba(15,23,42,.62); }
		@media (max-width: 1100px) {
			.asg-toolbar-top { grid-template-columns: 1fr; }
			.asg-stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
			.asg-filter-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
			.asg-actions { grid-column: 1 / -1; }
		}
		@media (max-width: 720px) {
			.asg-page { padding: 10px 8px 32px; }
			.asg-stats { grid-template-columns: 1fr; }
			.asg-filter-grid { grid-template-columns: 1fr; }
			.asg-actions { grid-column: auto; }
			.asg-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
