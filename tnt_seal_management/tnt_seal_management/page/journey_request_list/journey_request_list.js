frappe.pages["journey-request-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Journey Requests"),
		single_column: true,
	});

	page.jrl_state = {
		search: "",
		status: "All",
		from_date: "",
		to_date: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _jrl_load(page));
	page
		.add_inner_button(__("+ Journey Request"), () => frappe.new_doc("Journey Request"))
		.addClass("jrl-new-request-btn");

	const $statsBar = $('<div class="jrl-header-stats"></div>');
	$(wrapper).find('.page-head .page-actions').before($statsBar);
	page.jrl_stats_bar = $statsBar;

	_jrl_inject_styles();
	_jrl_build_page(page);
	_jrl_load(page);
};

function _jrl_build_page(page) {
	const statuses = [
		["All", __("All")],
		["Draft", __("Draft")],
		["Pending Control Room Approval", __("Pending Control Room")],
		["Pending Tagging", __("Pending Tagging")],
		["Pending Customer Care Approval", __("Pending Customer Care")],
		["Approved", __("Approved")],
		["Rejected", __("Rejected")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="jrl-page">
			<section class="jrl-panel">
				<div class="jrl-toolbar">
					<div class="jrl-toolbar-top">
						<label class="jrl-field jrl-search-inline">
							<input class="jrl-search" type="search" placeholder="${__("Journey request, client, entry, container or vehicle")}">
						</label>

						<div class="jrl-filter-dropdown">
							<button class="jrl-filter-btn">
								<span class="jrl-filter-btn-label">${__("All")}</span>
								<span class="jrl-filter-btn-count">0</span>
								<span class="jrl-filter-arrow">&#9662;</span>
							</button>
							<div class="jrl-filter-menu">
								${statuses.map(([val, lbl]) => `
									<div class="jrl-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(lbl)}">
										${frappe.utils.escape_html(lbl)}
										<span class="jrl-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="jrl-field">
							<span>${__("From")}</span>
							<input class="jrl-from-date" type="date">
						</label>
						<label class="jrl-field">
							<span>${__("To")}</span>
							<input class="jrl-to-date" type="date">
						</label>

						<div class="jrl-actions">
							<button class="jrl-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="jrl-table-panel">
				<div class="jrl-table-scroll"><div class="jrl-table-wrap"></div></div>
				<div class="jrl-pagination"></div>
			</section>

			<div class="jrl-loading" style="display:none"><div class="jrl-spinner"></div></div>
		</div>
	`);

	const delayedSearch = _jrl_debounce(() => {
		page.jrl_state.search = ($(page.body).find(".jrl-search").val() || "").trim();
		page.jrl_state.page = 1;
		_jrl_load(page);
	}, 350);

	$(page.body).on("input", ".jrl-search", delayedSearch);
	$(page.body).on("change", ".jrl-from-date, .jrl-to-date", () => {
		page.jrl_state.from_date = $(page.body).find(".jrl-from-date").val() || "";
		page.jrl_state.to_date = $(page.body).find(".jrl-to-date").val() || "";
		page.jrl_state.page = 1;
		_jrl_load(page);
	});
	$(page.body).on("click", ".jrl-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".jrl-filter-menu");
		const isOpen = $menu.hasClass("open");
		if (!isOpen) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".jrl-filter-item", function () {
		page.jrl_state.status = $(this).data("status");
		page.jrl_state.page = 1;
		$(page.body).find(".jrl-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".jrl-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".jrl-filter-menu").removeClass("open");
		_jrl_load(page);
	});

	$(document).on("click.jrl-dropdown", function () {
		$(page.body).find(".jrl-filter-menu").removeClass("open");
	});
	$(page.body).on("click", ".jrl-clear-btn", () => _jrl_clear_filters(page));
	$(page.body).on("click", ".jrl-row", function (event) {
		if ($(event.target).closest(".jrl-action-btn, .jrl-action-group").length) return;
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Journey Request", name);
	});
	$(page.body).on("click", ".jrl-action-btn", function (event) {
		event.preventDefault();
		event.stopPropagation();
		const $button = $(this);
		const action = $button.data("action");
		const docname = $button.data("name");
		if (!action || !docname) return;
		if (action === "open") {
			frappe.set_route("Form", "Journey Request", docname);
			return;
		}
		if (action === "approve") {
			_jrl_approve_request(page, docname);
			return;
		}
		if (action === "amend") {
			_jrl_return_for_amendment(page, docname);
			return;
		}
		if (action === "cr_approve") {
			_jrl_control_room_approve(page, docname);
			return;
		}
		if (action === "cr_reject") {
			_jrl_control_room_reject(page, docname);
		}
	});
	$(page.body).on("click", ".jrl-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.jrl_state.page = Number.parseInt($(this).data("page"), 10);
		_jrl_load(page);
	});
}

function _jrl_load(page) {
	const requestId = ++page.jrl_state.request_id;
	_jrl_set_loading(page, true);
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.get_journey_request_list",
		args: {
			search: page.jrl_state.search,
			status: page.jrl_state.status,
			from_date: page.jrl_state.from_date,
			to_date: page.jrl_state.to_date,
			page: page.jrl_state.page,
			page_length: page.jrl_state.page_length,
		},
		callback(r) {
			if (requestId !== page.jrl_state.request_id) return;
			_jrl_set_loading(page, false);
			const data = r.message || {};
			page.jrl_state.total = data.total || 0;
			_jrl_render_stats(page, data.summary || {});
			_jrl_render_table(page, data.requests || []);
			_jrl_render_pagination(page);
		},
		error() {
			if (requestId !== page.jrl_state.request_id) return;
			_jrl_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load Journey Requests"), indicator: "red" }, 5);
		},
	});
}

function _jrl_render_stats(page, summary) {
	const html = `
		<div class="jrl-stat-card">
			<div class="jrl-stat-label">${__("All")}</div>
			<div class="jrl-stat-value">${summary.All || 0}</div>
		</div>
		<div class="jrl-stat-card jrl-stat--pending">
			<div class="jrl-stat-label">${__("Pending CR")}</div>
			<div class="jrl-stat-value">${summary["Pending Control Room Approval"] || 0}</div>
		</div>
		<div class="jrl-stat-card jrl-stat--pending">
			<div class="jrl-stat-label">${__("Pending CC")}</div>
			<div class="jrl-stat-value">${summary["Pending Customer Care Approval"] || 0}</div>
		</div>
		<div class="jrl-stat-card jrl-stat--approved">
			<div class="jrl-stat-label">${__("Approved")}</div>
			<div class="jrl-stat-value">${summary.Approved || 0}</div>
		</div>
		<div class="jrl-stat-card jrl-stat--rejected">
			<div class="jrl-stat-label">${__("Rejected")}</div>
			<div class="jrl-stat-value">${summary.Rejected || 0}</div>
		</div>
	`;
	if (page.jrl_stats_bar) {
		page.jrl_stats_bar.html(html);
	}

	$(page.body).find(".jrl-fcount").each(function () {
		const key = $(this).data("fcount");
		$(this).text(summary[key] ?? 0);
	});
	const currentCount = summary[page.jrl_state.status] ?? 0;
	$(page.body).find(".jrl-filter-btn-count").text(currentCount);
}

function _jrl_render_table(page, requests) {
	if (!requests.length) {
		$(page.body).find(".jrl-table-wrap").html(`
			<div class="jrl-empty">
				<strong>${__("No Journey Requests found")}</strong>
				<span>${__("Journey requests are created by technicians from an assigned PCB Job Order.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".jrl-table-wrap").html(`
		<table class="jrl-table">
			<thead><tr>
				<th>${__("Client Name")}</th>
				<th>${__("Vehicle")}</th>
				<th>${__("Entry Number")}</th>
				<th>${__("Container Number")}</th>
				<th>${__("Number of Seals")}</th>
				<th>${__("Seal Serial Number(s)")}</th>
				<th>${__("Origin")}</th>
				<th>${__("Destination")}</th>
				<th>${__("Driver Contact")}</th>
				<th>${__("Action")}</th>
			</tr></thead>
			<tbody>${requests.map(_jrl_row_html).join("")}</tbody>
		</table>
	`);
}

function _jrl_row_html(request) {
	return `
		<tr class="jrl-row" data-name="${frappe.utils.escape_html(request.name)}">
			<td>${frappe.utils.escape_html(request.client_name || "—")}</td>
			<td>${frappe.utils.escape_html(request.vehicle || "—")}</td>
			<td>${frappe.utils.escape_html(request.entry_number || "—")}</td>
			<td>${frappe.utils.escape_html(request.container_number || "—")}</td>
			<td>${frappe.utils.escape_html(String(request.number_of_seals ?? "—"))}</td>
			<td>${frappe.utils.escape_html(request.seal_serial_numbers || "—")}</td>
			<td>${frappe.utils.escape_html(request.origin || "—")}</td>
			<td>${frappe.utils.escape_html(request.destination || "—")}</td>
			<td>${frappe.utils.escape_html(request.driver_contact || "—")}</td>
			<td>${_jrl_action_html(request)}</td>
		</tr>
	`;
}

function _jrl_action_html(request) {
	const name = frappe.utils.escape_html(request.name);
	const status = request.journey_request_status;

	const canControlRoom =
		frappe.user.has_role("Operations Control Room") &&
		status === "Pending Control Room Approval";
	const canCustomerCare =
		frappe.user.has_role("Customer Care") &&
		status === "Pending Customer Care Approval";

	if (canControlRoom) {
		return `
			<div class="jrl-action-group">
				<button class="jrl-action-btn jrl-action-btn--approve" data-action="cr_approve" data-name="${name}">
					${__("Approve")}
				</button>
				<button class="jrl-action-btn jrl-action-btn--amend" data-action="cr_reject" data-name="${name}">
					${__("Reject")}
				</button>
			</div>
		`;
	}

	if (canCustomerCare) {
		return `
			<div class="jrl-action-group">
				<button class="jrl-action-btn jrl-action-btn--approve" data-action="approve" data-name="${name}">
					${__("Approve")}
				</button>
				<button class="jrl-action-btn jrl-action-btn--amend" data-action="amend" data-name="${name}">
					${__("Return for Amendment")}
				</button>
			</div>
		`;
	}

	return `
		<div class="jrl-action-group">
			<button class="jrl-action-btn jrl-action-btn--open" data-action="open" data-name="${name}">
				${__("Open")}
			</button>
		</div>
	`;
}

function _jrl_approve_request(page, docname) {
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.approve_journey_request",
		args: { docname },
		freeze: true,
		freeze_message: __("Approving journey request..."),
		callback() {
			frappe.show_alert({ message: __("Journey request approved"), indicator: "green" }, 5);
			_jrl_load(page);
		},
	});
}

function _jrl_return_for_amendment(page, docname) {
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks"),
				reqd: 1,
			},
		],
		(values) => {
			frappe.call({
				method:
					"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.reject_journey_request",
				args: {
					docname,
					remarks: values.remarks,
				},
				freeze: true,
				freeze_message: __("Returning journey request for amendment..."),
				callback() {
					frappe.show_alert(
						{ message: __("Journey request returned for amendment"), indicator: "orange" },
						5
					);
					_jrl_load(page);
				},
			});
		},
		__("Return for Amendment"),
		__("Submit")
	);
}

function _jrl_control_room_approve(page, docname) {
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.approve_by_control_room",
		args: { docname },
		freeze: true,
		freeze_message: __("Approving..."),
		callback() {
			frappe.show_alert({ message: __("Approved by Control Room"), indicator: "green" }, 5);
			_jrl_load(page);
		},
	});
}

function _jrl_control_room_reject(page, docname) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks"), reqd: 1 }],
		(values) => {
			frappe.call({
				method:
					"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.reject_by_control_room",
				args: { docname, remarks: values.remarks },
				freeze: true,
				freeze_message: __("Rejecting..."),
				callback() {
					frappe.show_alert(
						{ message: __("Rejected by Control Room"), indicator: "orange" },
						5
					);
					_jrl_load(page);
				},
			});
		},
		__("Reject Journey Request"),
		__("Submit")
	);
}

function _jrl_render_pagination(page) {
	const pages = Math.max(1, Math.ceil(page.jrl_state.total / page.jrl_state.page_length));
	page.jrl_state.page = Math.min(page.jrl_state.page, pages);
	const start = page.jrl_state.total
		? (page.jrl_state.page - 1) * page.jrl_state.page_length + 1
		: 0;
	const end = Math.min(page.jrl_state.page * page.jrl_state.page_length, page.jrl_state.total);
	$(page.body).find(".jrl-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.jrl_state.total])}</span>
		<div>
			<button class="jrl-page-btn" data-page="${page.jrl_state.page - 1}" ${page.jrl_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.jrl_state.page, pages])}</b>
			<button class="jrl-page-btn" data-page="${page.jrl_state.page + 1}" ${page.jrl_state.page >= pages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _jrl_clear_filters(page) {
	page.jrl_state.search = "";
	page.jrl_state.status = "All";
	page.jrl_state.from_date = "";
	page.jrl_state.to_date = "";
	page.jrl_state.page = 1;

	$(page.body).find(".jrl-search, .jrl-from-date, .jrl-to-date").val("");
	$(page.body).find(".jrl-filter-item").removeClass("active");
	$(page.body).find('.jrl-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".jrl-filter-btn-label").text(__("All"));
	
	_jrl_load(page);
}

function _jrl_set_loading(page, show) {
	$(page.body).find(".jrl-loading").toggle(show);
}

function _jrl_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _jrl_inject_styles() {
	if (document.getElementById("journey-request-list-styles")) return;
	const style = document.createElement("style");
	style.id = "journey-request-list-styles";
	style.textContent = `
		.jrl-page {
			--jrl-blue: #0284c7;
			--jrl-dark: #075985;
			max-width: 1580px;
			margin: 0 auto;
			padding: 32px 24px 48px;
			position: relative;
			font-family: var(--font-stack);
		}

		/* ---- header stats bar ---- */
		.jrl-header-stats {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			padding: 0 20px;
			overflow-x: auto;
		}
		.jrl-header-stats .jrl-stat-card {
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
		.jrl-header-stats .jrl-stat--pending { border-top-color: #f59e0b; }
		.jrl-header-stats .jrl-stat--approved { border-top-color: #16a34a; }
		.jrl-header-stats .jrl-stat--rejected { border-top-color: #dc2626; }
		.jrl-header-stats .jrl-stat-label {
			color: #0369a1;
			font-weight: 800;
			text-transform: uppercase;
			max-width: none;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.jrl-header-stats .jrl-stat-value {
			color: #0c4a6e;
			font-size: 18px;
			font-weight: 900;
			line-height: 1;
		}

		/* ---- layout panels ---- */
		.jrl-panel {
			width: 100%;
			overflow: hidden;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			margin-bottom: 20px;
		}
		.jrl-table-panel {
			position: sticky;
			top: 60px;
			border: 1px solid rgba(14, 165, 233, .2);
			border-radius: 22px;
			background: var(--card-bg, #fff);
			box-shadow: 0 4px 12px rgba(14, 165, 233, .05);
			overflow: hidden;
		}
		.jrl-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 200px); }

		/* ---- toolbar ---- */
		.jrl-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.jrl-toolbar-top {
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.jrl-search-inline {
			flex: 1;
			display: flex;
			align-items: center;
		}
		.jrl-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.jrl-search-inline input:focus {
			outline: none;
			border-color: var(--jrl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- filter dropdown ---- */
		.jrl-filter-dropdown { position: relative; }
		.jrl-filter-btn {
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
		.jrl-filter-btn:hover { border-color: var(--jrl-blue); }
		.jrl-filter-btn-count {
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
		.jrl-filter-arrow { color: #94a3b8; font-size: 11px; }
		.jrl-filter-menu {
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
		.jrl-filter-menu.open { display: block; }
		.jrl-filter-item {
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
		.jrl-filter-item:hover { background: #f0f9ff; }
		.jrl-filter-item.active { background: #e0f2fe; color: var(--jrl-blue); }
		.jrl-fcount {
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
		.jrl-filter-item.active .jrl-fcount { background: var(--jrl-blue); color: #fff; }

		/* ---- regular fields ---- */
		.jrl-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.jrl-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.jrl-field input[type="date"] {
			width: 150px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 10px;
			font-size: 13px;
		}
		.jrl-field input[type="date"]:focus {
			outline: none;
			border-color: var(--jrl-blue);
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- actions ---- */
		.jrl-actions { display: flex; gap: 8px; padding-top: 20px; }
		.jrl-clear-btn {
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
		.jrl-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }

		.jrl-new-request-btn {
			background: #111827 !important;
			border-color: #111827 !important;
			color: #ffffff !important;
		}
		.jrl-new-request-btn:hover,
		.jrl-new-request-btn:focus {
			background: #000000 !important;
			border-color: #000000 !important;
			color: #ffffff !important;
		}
		.jrl-filter-grid {
			display: grid;
			grid-template-columns: minmax(300px, 1.6fr) 170px 170px auto;
			align-items: end;
			gap: 12px;
		}
		.jrl-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.jrl-field > span {
			color: #0369a1;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.jrl-field input {
			width: 100%;
			height: 42px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 9px 12px;
			font-size: 14px;
		}
		.jrl-actions { display: flex; gap: 8px; padding-bottom: 1px; }
		.jrl-table-scroll { overflow-x: auto; }
		.jrl-table { width: 100%; min-width: 1440px; border-collapse: collapse; }
		.jrl-table th,
		.jrl-table td {
			padding: 16px 18px;
			border-bottom: 1px solid #e0f2fe;
			text-align: left;
			vertical-align: middle;
			color: var(--text-color, #334155);
			font-size: 14px;
			line-height: 1.45;
		}
		.jrl-table th {
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
		.jrl-row { cursor: pointer; }
		.jrl-row:hover { background: rgba(224, 242, 254, .7); }
		.jrl-action-group {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.jrl-action-btn {
			border: 0;
			border-radius: 999px;
			padding: 8px 12px;
			font-size: 12px;
			font-weight: 800;
			line-height: 1;
			white-space: nowrap;
			cursor: pointer;
		}
		.jrl-action-btn--open {
			background: #e0f2fe;
			color: #075985;
		}
		.jrl-action-btn--approve {
			background: #dcfce7;
			color: #166534;
		}
		.jrl-action-btn--amend {
			background: #ffedd5;
			color: #c2410c;
		}
		.jrl-empty { padding: 60px 20px; text-align: center; color: #64748b; }
		.jrl-empty strong { display: block; margin-bottom: 6px; color: #0c4a6e; font-size: 22px; }
		.jrl-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 15px 18px;
			background: #f0f9ff;
			color: #0369a1;
			font-size: 13px;
		}
		.jrl-pagination div { display: flex; align-items: center; gap: 9px; }
		.jrl-page-btn:disabled { cursor: default; opacity: .45; }
		.jrl-loading {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(240, 249, 255, .72);
			backdrop-filter: blur(2px);
		}
		.jrl-spinner {
			width: 38px;
			height: 38px;
			border: 3px solid rgba(14, 165, 233, .18);
			border-top-color: var(--jrl-blue);
			border-radius: 50%;
			animation: jrl-spin .7s linear infinite;
		}
		@keyframes jrl-spin { to { transform: rotate(360deg); } }
		[data-theme="dark"] .jrl-stat-card {
			background: rgba(14, 116, 144, .18);
			border-color: rgba(14, 116, 144, .3);
		}
		[data-theme="dark"] .jrl-panel,
		[data-theme="dark"] .jrl-page-btn {
			background: #1e293b;
			border-color: #334155;
			color: #f1f5f9;
		}
		[data-theme="dark"] .jrl-search-inline input,
		[data-theme="dark"] .jrl-field input[type="date"],
		[data-theme="dark"] .jrl-filter-btn,
		[data-theme="dark"] .jrl-filter-menu,
		[data-theme="dark"] .jrl-clear-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .jrl-field > span { color: #7dd3fc; }
		[data-theme="dark"] .jrl-toolbar,
		[data-theme="dark"] .jrl-table th,
		[data-theme="dark"] .jrl-pagination { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .jrl-table td { border-bottom-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .jrl-row:hover { background: rgba(14, 165, 233, .12); }
		[data-theme="dark"] .jrl-action-btn--open {
			background: #082f49;
			color: #bae6fd;
		}
		[data-theme="dark"] .jrl-action-btn--approve {
			background: #14532d;
			color: #dcfce7;
		}
		[data-theme="dark"] .jrl-action-btn--amend {
			background: #7c2d12;
			color: #ffedd5;
		}
		[data-theme="dark"] .jrl-loading { background: rgba(15, 23, 42, .62); }
		@media (max-width: 1100px) {
			.jrl-toolbar-top { flex-direction: column; align-items: stretch; }
		}
		@media (max-width: 720px) {
			.jrl-page { padding: 10px 8px 32px; }
			.jrl-pagination { align-items: flex-start; flex-direction: column; }
		}
	`;
	document.head.appendChild(style);
}
