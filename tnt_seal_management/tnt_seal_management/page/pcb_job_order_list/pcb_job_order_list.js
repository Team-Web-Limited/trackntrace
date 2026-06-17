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
	_pjo_inject_styles();
	_pjo_build_page(page);
	_pjo_load(page);
};

function _pjo_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Unassigned", __("Unassigned")],
		["Completed", __("Completed")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="pjo-page">
			<section class="pjo-panel">
				<div class="pjo-toolbar">
					<div class="pjo-toolbar-top">
						<div class="pjo-status-filters">
						${statuses
							.map(
								([value, label]) => `
									<button class="pjo-status-btn ${value === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(value)}">
										${frappe.utils.escape_html(label)}
									</button>
								`
							)
							.join("")}
						</div>
						<section class="pjo-stats"></section>
					</div>
					<div class="pjo-filter-grid">
						<label class="pjo-field">
							<span>${__("Search")}</span>
							<input class="pjo-search" type="search" placeholder="${__("Job order, booking, client, location or contact")}">
						</label>
						<label class="pjo-field">
							<span>${__("PCB Team Leader")}</span>
							<div class="pjo-team-leader-filter"></div>
						</label>
						<label class="pjo-field">
							<span>${__("From")}</span>
							<input class="pjo-from-date" type="date">
						</label>
						<label class="pjo-field">
							<span>${__("To")}</span>
							<input class="pjo-to-date" type="date">
						</label>
						<div class="pjo-actions">
							<button class="pjo-clear-btn">${__("Clear filters")}</button>
							<button class="pjo-refresh-btn">${__("Refresh")}</button>
						</div>
					</div>
				</div>
				<div class="pjo-table-scroll"><div class="pjo-table-wrap"></div></div>
				<div class="pjo-pagination"></div>
			</section>
			<div class="pjo-loading" style="display:none"><div class="pjo-spinner"></div></div>
		</div>
	`);

	page.pjo_team_leader_control = frappe.ui.form.make_control({
		parent: $(page.body).find(".pjo-team-leader-filter"),
		df: {
			fieldname: "team_leader",
			fieldtype: "Link",
			options: "User",
			placeholder: __("All team leaders"),
			get_query: () => ({
				query:
					"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.pcb_team_leader_query",
			}),
		},
		render_input: true,
	});

	const delayedSearch = _pjo_debounce(() => {
		page.pjo_state.search = ($(page.body).find(".pjo-search").val() || "").trim();
		page.pjo_state.page = 1;
		_pjo_load(page);
	}, 350);

	$(page.body).on("input", ".pjo-search", delayedSearch);
	page.pjo_team_leader_control.$input.on("change", () => {
		page.pjo_state.team_leader = page.pjo_team_leader_control.get_value() || "";
		page.pjo_state.page = 1;
		_pjo_load(page);
	});
	$(page.body).on("change", ".pjo-from-date, .pjo-to-date", () => {
		page.pjo_state.from_date = $(page.body).find(".pjo-from-date").val() || "";
		page.pjo_state.to_date = $(page.body).find(".pjo-to-date").val() || "";
		page.pjo_state.page = 1;
		_pjo_load(page);
	});
	$(page.body).on("click", ".pjo-status-btn", function () {
		$(page.body).find(".pjo-status-btn").removeClass("active");
		$(this).addClass("active");
		page.pjo_state.status = $(this).data("status");
		page.pjo_state.page = 1;
		_pjo_load(page);
	});
	$(page.body).on("click", ".pjo-refresh-btn", () => _pjo_load(page));
	$(page.body).on("click", ".pjo-clear-btn", () => _pjo_clear_filters(page));
	$(page.body).on("click", ".pjo-assign-btn", function (event) {
		event.stopPropagation();
		const name = $(this).data("name");
		if (name) _pjo_prompt_for_tag_operator(page, name);
	});
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

function _pjo_render_stats(page, summary) {
	const stats = [
		[__("All Job Orders"), summary.All || 0, "all"],
		[__("Unassigned"), summary.Unassigned || 0, "unassigned"],
		[__("Team Leader Assigned"), summary["Team Leader Assigned"] || 0, "assigned"],
		[__("Completed"), summary.Completed || 0, "completed"],
	];
	$(page.body).find(".pjo-stats").html(
		stats.map(([label, value, variant]) => `
			<div class="pjo-stat pjo-stat--${variant}">
				<span>${frappe.utils.escape_html(label)}</span><strong>${value}</strong>
			</div>
		`).join("")
	);
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
				<th>${__("Job Order")}</th>
				<th>${__("Tagging Booking")}</th>
				<th>${__("Client")}</th>
				<th>${__("Location")}</th>
				<th>${__("Scheduled")}</th>
				<th>${__("Contact Person")}</th>
				<th>${__("Phone")}</th>
				<th>${__("PCB Team Leader")}</th>
				<th>${__("Status")}</th>
				<th>${__("Action")}</th>
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
	const canAssign =
		!["Completed", "Cancelled"].includes(status) &&
		order.assigned_pcb_team_leader &&
		(frappe.user.has_role("System Manager") ||
			order.assigned_pcb_team_leader === frappe.session.user);
	const assignLabel = order.assignment_reference ? __("Reassign") : __("Assign");
	return `
		<tr class="pjo-row" data-name="${frappe.utils.escape_html(order.name)}">
			<td><span class="pjo-name">${frappe.utils.escape_html(order.name)}</span></td>
			<td>${frappe.utils.escape_html(order.tagging_booking || "—")}</td>
			<td>${frappe.utils.escape_html(order.client_name || "—")}</td>
			<td>${frappe.utils.escape_html(order.location || "—")}</td>
			<td>${frappe.utils.escape_html(scheduled)}</td>
			<td>${frappe.utils.escape_html(order.contact_person_name || "—")}</td>
			<td>${frappe.utils.escape_html(order.contact_person_phone || "—")}</td>
			<td>${frappe.utils.escape_html(order.assigned_pcb_team_leader || __("Not assigned"))}</td>
			<td><span class="pjo-badge pjo-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
			<td>
				${canAssign ? `<button class="pjo-assign-btn" data-name="${frappe.utils.escape_html(order.name)}">${assignLabel}</button>` : "—"}
			</td>
		</tr>
	`;
}

function _pjo_prompt_for_tag_operator(page, jobOrderName) {
	const dialog = new frappe.ui.Dialog({
		title: __("Assign Field Technician (Tag Operator)"),
		fields: [
			{
				fieldname: "field_technician",
				fieldtype: "Link",
				label: __("Field Technician (Tag Operator)"),
				options: "User",
				reqd: 1,
				get_query: () => ({
					query:
						"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.field_technician_query",
				}),
			},
		],
		primary_action_label: __("Assign"),
		primary_action(values) {
			frappe.call({
				method:
					"tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.assign_to_field_technician",
				args: {
					job_order_name: jobOrderName,
					field_technician: values.field_technician,
				},
				callback(r) {
					dialog.hide();
					const assignment = r.message && r.message.assignment;
					frappe.show_alert(
						{
							message: assignment
								? __("Assignment {0} saved", [assignment])
								: __("Tag Operator assigned"),
							indicator: "green",
						},
						5
					);
					_pjo_load(page);
				},
			});
		},
	});
	dialog.show();
}

function _pjo_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.pjo_state.total / page.pjo_state.page_length));
	page.pjo_state.page = Math.min(page.pjo_state.page, pages);
	const start = page.pjo_state.total
		? (page.pjo_state.page - 1) * page.pjo_state.page_length + 1
		: 0;
	const end = Math.min(page.pjo_state.page * page.pjo_state.page_length, page.pjo_state.total);
	$(page.body).find(".pjo-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.pjo_state.total])}</span>
		<div>
			<button class="pjo-page-btn" data-page="${page.pjo_state.page - 1}" ${page.pjo_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.pjo_state.page, pages])}</b>
			<button class="pjo-page-btn" data-page="${page.pjo_state.page + 1}" ${page.pjo_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
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
	$(page.body).find(".pjo-status-btn").removeClass("active");
	$(page.body).find('.pjo-status-btn[data-status="All"]').addClass("active");
	page.pjo_team_leader_control.set_value("");
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
			max-width: 1540px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}
		.pjo-stats {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px;
			min-width: 0;
		}
		.pjo-stat {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			min-height: 78px;
			padding: 16px 18px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-top: 4px solid #38bdf8;
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.pjo-stat--all,
		.pjo-stat--assigned {
			background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
			border-color: #bae6fd;
		}
		.pjo-stat--all { border-top-color: #075985; }
		.pjo-stat--unassigned { border-top-color: #f59e0b; }
		.pjo-stat--assigned { border-top-color: #0284c7; }
		.pjo-stat--completed { border-top-color: #16a34a; }
		.pjo-stat span {
			max-width: 130px;
			color: #0369a1;
			font-size: 12px;
			font-weight: 800;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.pjo-stat strong { color: #0c4a6e; font-size: 34px; line-height: 1; }
		.pjo-panel {
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
		}
		.pjo-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.pjo-toolbar-top {
			display: grid;
			grid-template-columns: minmax(0, auto) minmax(720px, 1fr);
			align-items: start;
			gap: 18px;
			margin-bottom: 14px;
		}
		.pjo-status-filters { display: flex; gap: 8px; overflow-x: auto; }
		.pjo-status-btn,
		.pjo-clear-btn,
		.pjo-refresh-btn,
		.pjo-page-btn {
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
		.pjo-status-btn.active,
		.pjo-refresh-btn { border-color: var(--pjo-blue); background: var(--pjo-blue); color: #fff; }
		.pjo-filter-grid {
			display: grid;
			grid-template-columns: minmax(300px, 1.6fr) minmax(240px, 1fr) 170px 170px auto;
			align-items: end;
			gap: 12px;
		}
		.pjo-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.pjo-field > span {
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.pjo-field input,
		.pjo-team-leader-filter .control-input {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.pjo-team-leader-filter .form-group { margin: 0; }
		.pjo-team-leader-filter .control-label,
		.pjo-team-leader-filter .help-box { display: none; }
		.pjo-actions { display: flex; gap: 8px; padding-bottom: 1px; }
		.pjo-table-scroll { overflow-x: auto; }
		.pjo-table { width: 100%; min-width: 1480px; border-collapse: collapse; }
		.pjo-table th,
		.pjo-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.pjo-table th {
			background: #f0f9ff;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .08em;
			text-transform: uppercase;
		}
		.pjo-row { cursor: pointer; }
		.pjo-row:hover { background: rgba(224, 242, 254, .7); }
		.pjo-name { color: var(--pjo-blue); font-size: 16px; font-weight: 800; }
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
		.pjo-assign-btn {
			border: 1px solid var(--pjo-blue);
			border-radius: 999px;
			background: var(--pjo-blue);
			color: #fff;
			padding: 7px 12px;
			font-size: 12px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
		}
		.pjo-empty { padding: 60px 20px; text-align: center; color: #64748b; }
		.pjo-empty strong { display: block; margin-bottom: 6px; color: #0c4a6e; font-size: 22px; }
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
		.pjo-page-btn:disabled { cursor: default; opacity: .45; }
		.pjo-loading {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: flex;
			align-items: center;
			justify-content: center;
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
		[data-theme="dark"] .pjo-stat,
		[data-theme="dark"] .pjo-panel,
		[data-theme="dark"] .pjo-status-btn,
		[data-theme="dark"] .pjo-clear-btn,
		[data-theme="dark"] .pjo-page-btn,
		[data-theme="dark"] .pjo-field input,
		[data-theme="dark"] .pjo-team-leader-filter .control-input {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .pjo-stat--all,
		[data-theme="dark"] .pjo-stat--assigned {
			background: linear-gradient(135deg, #075985 0%, #0369a1 100%);
			border-color: #0284c7;
		}
		[data-theme="dark"] .pjo-stat span,
		[data-theme="dark"] .pjo-field > span { color: #7dd3fc; }
		[data-theme="dark"] .pjo-stat strong { color: #f8fafc; }
		[data-theme="dark"] .pjo-toolbar,
		[data-theme="dark"] .pjo-table th,
		[data-theme="dark"] .pjo-pagination { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .pjo-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .pjo-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .pjo-loading { background: rgba(15, 23, 42, .62); }
		@media (max-width: 1100px) {
			.pjo-toolbar-top { grid-template-columns: 1fr; }
			.pjo-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.pjo-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.pjo-actions { grid-column: 1 / -1; }
		}
		@media (max-width: 720px) {
			.pjo-page { padding: 10px 8px 32px; }
			.pjo-stats { grid-template-columns: 1fr; }
			.pjo-filter-grid { grid-template-columns: 1fr; }
			.pjo-actions { grid-column: auto; }
			.pjo-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
