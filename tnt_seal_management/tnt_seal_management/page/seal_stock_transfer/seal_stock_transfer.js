frappe.pages["seal-stock-transfer"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Warehouse Transfers"),
		single_column: true,
	});

	page.sst_state = {
		search: "",
		status: "All",
		source_warehouse: "",
		target_warehouse: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _sst_load(page));
	page.add_inner_button(__("Download Template"), () => _sst_download_template());
	if (_sst_can_manage()) {
		page.set_primary_action(__("Mass Import"), () => _sst_show_import_dialog(page));
		page.add_inner_button(__("New Transfer"), () => frappe.new_doc("Seal Stock Transfer"));
	}

	const $statsBar = $('<div class="sst-header-stats"></div>');
	$(wrapper).find(".page-head .page-actions").before($statsBar);
	page.sst_stats_bar = $statsBar;

	_sst_inject_styles();
	_sst_build_page(page);
	_sst_load(page);
};

const SST_METHOD = "tnt_seal_management.tnt_seal_management.api.seal_stock_transfer_list.get_seal_stock_transfer_list";
const SST_IMPORT_METHOD = "tnt_seal_management.tnt_seal_management.api.seal_stock_transfer_list.import_from_excel";
const SST_RECEIVE_METHOD = "tnt_seal_management.tnt_seal_management.doctype.seal_stock_transfer.seal_stock_transfer.receive_transfer";
const SST_TEMPLATE_URL = "/api/method/tnt_seal_management.tnt_seal_management.api.seal_stock_transfer_list.download_template";

function _sst_can_manage() {
	return ["System Manager", "Seal System Administrator", "Operations Control Room", "Management"]
		.some((role) => frappe.user.has_role(role));
}

function _sst_build_page(page) {
	const statuses = [
		["All", __("All Transfers")],
		["Draft", __("Draft")],
		["In Transit", __("In Transit")],
		["Received", __("Received")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="sst-page">
			<section class="sst-panel">
				<div class="sst-toolbar">
					<div class="sst-toolbar-top">
						<label class="sst-field sst-search-inline">
							<input class="sst-search" type="search" placeholder="${__("Transfer, warehouse or user")}">
						</label>

						<div class="sst-filter-dropdown">
							<button class="sst-filter-btn">
								<span class="sst-filter-btn-label">${__("All Transfers")}</span>
								<span class="sst-filter-btn-count">0</span>
								<span class="sst-filter-arrow">&#9662;</span>
							</button>
							<div class="sst-filter-menu">
								${statuses.map(([val, label]) => `
									<div class="sst-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(label)}">
										${frappe.utils.escape_html(label)}
										<span class="sst-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="sst-field sst-warehouse-field">
							<span>${__("Source")}</span>
							<div class="sst-source-filter"></div>
						</label>
						<label class="sst-field sst-warehouse-field">
							<span>${__("Target")}</span>
							<div class="sst-target-filter"></div>
						</label>

						<div class="sst-actions">
							<button class="sst-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="sst-table-panel">
				<div class="sst-table-scroll"><div class="sst-table-wrap"></div></div>
				<div class="sst-pagination"></div>
			</section>

			<div class="sst-loading" style="display:none"><div class="sst-spinner"></div></div>
		</div>
	`);

	page.sst_source_control = _sst_make_warehouse_control(page, ".sst-source-filter", __("All sources"));
	page.sst_target_control = _sst_make_warehouse_control(page, ".sst-target-filter", __("All targets"));

	const delayedSearch = frappe.utils.debounce(() => {
		page.sst_state.search = ($(page.body).find(".sst-search").val() || "").trim();
		page.sst_state.page = 1;
		_sst_load(page);
	}, 300);

	$(page.body).on("input", ".sst-search", delayedSearch);
	page.sst_source_control.$input.on("change", () => {
		page.sst_state.source_warehouse = page.sst_source_control.get_value() || "";
		page.sst_state.page = 1;
		_sst_load(page);
	});
	page.sst_target_control.$input.on("change", () => {
		page.sst_state.target_warehouse = page.sst_target_control.get_value() || "";
		page.sst_state.page = 1;
		_sst_load(page);
	});

	$(page.body).on("click", ".sst-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".sst-filter-menu");
		if (!$menu.hasClass("open")) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".sst-filter-item", function () {
		page.sst_state.status = $(this).data("status");
		page.sst_state.page = 1;
		$(page.body).find(".sst-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".sst-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".sst-filter-menu").removeClass("open");
		_sst_load(page);
	});

	$(document).on("click.sst-dropdown", () => {
		$(page.body).find(".sst-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".sst-clear-btn", () => _sst_clear_filters(page));
	$(page.body).on("click", ".sst-receive-btn", function (e) {
		e.stopPropagation();
		const name = $(this).data("name");
		if (name) _sst_receive_transfer(page, name);
	});
	$(page.body).on("click", ".sst-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Stock Transfer", name);
	});
	$(page.body).on("click", ".sst-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.sst_state.page = Number.parseInt($(this).data("page"), 10);
		_sst_load(page);
	});
}

function _sst_make_warehouse_control(page, selector, placeholder) {
	return frappe.ui.form.make_control({
		parent: $(page.body).find(selector),
		df: {
			fieldname: selector.replace(".", ""),
			fieldtype: "Link",
			options: "Warehouse",
			get_query: () => ({ filters: { is_group: 0, disabled: 0 } }),
			placeholder,
		},
		render_input: true,
	});
}

function _sst_load(page) {
	const requestId = ++page.sst_state.request_id;
	_sst_set_loading(page, true);
	frappe.call({
		method: SST_METHOD,
		args: {
			search: page.sst_state.search,
			status: page.sst_state.status,
			source_warehouse: page.sst_state.source_warehouse,
			target_warehouse: page.sst_state.target_warehouse,
			page: page.sst_state.page,
			page_length: page.sst_state.page_length,
		},
		callback(r) {
			if (requestId !== page.sst_state.request_id) return;
			_sst_set_loading(page, false);
			const data = r.message || {};
			page.sst_state.total = data.total || 0;
			_sst_render_stats(page, data.summary || {});
			_sst_render_table(page, data.transfers || []);
			_sst_render_pagination(page);
		},
		error() {
			if (requestId !== page.sst_state.request_id) return;
			_sst_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load warehouse transfers"), indicator: "red" }, 5);
		},
	});
}

function _sst_render_stats(page, summary) {
	const html = `
		<div class="sst-stat-card">
			<div class="sst-stat-label">${__("All")}</div>
			<div class="sst-stat-value">${summary.All || 0}</div>
		</div>
		<div class="sst-stat-card sst-stat--draft">
			<div class="sst-stat-label">${__("Draft")}</div>
			<div class="sst-stat-value">${summary.Draft || 0}</div>
		</div>
		<div class="sst-stat-card sst-stat--transit">
			<div class="sst-stat-label">${__("In Transit")}</div>
			<div class="sst-stat-value">${summary["In Transit"] || 0}</div>
		</div>
		<div class="sst-stat-card sst-stat--received">
			<div class="sst-stat-label">${__("Received")}</div>
			<div class="sst-stat-value">${summary.Received || 0}</div>
		</div>
		<div class="sst-stat-card sst-stat--cancelled">
			<div class="sst-stat-label">${__("Cancelled")}</div>
			<div class="sst-stat-value">${summary.Cancelled || 0}</div>
		</div>
	`;
	if (page.sst_stats_bar) page.sst_stats_bar.html(html);

	const countMap = {
		All: summary.All || 0,
		Draft: summary.Draft || 0,
		"In Transit": summary["In Transit"] || 0,
		Received: summary.Received || 0,
		Cancelled: summary.Cancelled || 0,
	};
	$(page.body).find(".sst-fcount").each(function () {
		$(this).text(countMap[$(this).data("fcount")] ?? 0);
	});
	$(page.body).find(".sst-filter-btn-count").text(countMap[page.sst_state.status] ?? 0);
}

function _sst_render_table(page, transfers) {
	if (!transfers.length) {
		$(page.body).find(".sst-table-wrap").html(`
			<div class="sst-empty">
				<strong>${__("No warehouse transfers found")}</strong>
				<span>${__("Use Mass Import to create a transfer from an Excel list of seals.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".sst-table-wrap").html(`
		<table class="sst-table">
			<thead><tr>
				<th>${__("Transfer")}</th>
				<th>${__("Source")}</th>
				<th>${__("Target")}</th>
				<th>${__("Transfer Date")}</th>
				<th>${__("Received Date")}</th>
				<th>${__("Sent By")}</th>
				<th class="text-right">${__("Seals")}</th>
				<th>${__("Status")}</th>
				<th>${__("Action")}</th>
			</tr></thead>
			<tbody>${transfers.map(_sst_row_html).join("")}</tbody>
		</table>
	`);
}

function _sst_row_html(row) {
	const status = row.transfer_status || "Draft";
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const transferDate = row.transfer_date ? frappe.datetime.str_to_user(row.transfer_date) : "—";
	const receivedDate = row.received_date ? frappe.datetime.str_to_user(row.received_date) : "—";
	const canReceive = _sst_can_manage() && row.docstatus === 1 && status === "In Transit";
	return `
		<tr class="sst-row" data-name="${frappe.utils.escape_html(row.name)}">
			<td><span class="sst-name">${frappe.utils.escape_html(row.name)}</span></td>
			<td>${frappe.utils.escape_html(row.source_warehouse || "—")}</td>
			<td>${frappe.utils.escape_html(row.target_warehouse || "—")}</td>
			<td>${frappe.utils.escape_html(transferDate)}</td>
			<td>${frappe.utils.escape_html(receivedDate)}</td>
			<td>${frappe.utils.escape_html(row.sent_by || "—")}</td>
			<td class="text-right">${cint(row.total_seals)}</td>
			<td><span class="sst-badge sst-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
			<td>${canReceive ? `<button class="sst-receive-btn" data-name="${frappe.utils.escape_html(row.name)}">${__("Receive")}</button>` : "—"}</td>
		</tr>
	`;
}

function _sst_render_pagination(page) {
	const totalPages = Math.max(1, Math.ceil(page.sst_state.total / page.sst_state.page_length));
	page.sst_state.page = Math.min(page.sst_state.page, totalPages);
	const start = page.sst_state.total ? (page.sst_state.page - 1) * page.sst_state.page_length + 1 : 0;
	const end = Math.min(page.sst_state.page * page.sst_state.page_length, page.sst_state.total);
	$(page.body).find(".sst-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.sst_state.total])}</span>
		<div>
			<button class="sst-page-btn" data-page="${page.sst_state.page - 1}" ${page.sst_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.sst_state.page, totalPages])}</b>
			<button class="sst-page-btn" data-page="${page.sst_state.page + 1}" ${page.sst_state.page >= totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _sst_clear_filters(page) {
	Object.assign(page.sst_state, {
		search: "",
		status: "All",
		source_warehouse: "",
		target_warehouse: "",
		page: 1,
	});
	$(page.body).find(".sst-search").val("");
	page.sst_source_control.set_value("");
	page.sst_target_control.set_value("");
	$(page.body).find(".sst-filter-item").removeClass("active");
	$(page.body).find('.sst-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".sst-filter-btn-label").text(__("All Transfers"));
	_sst_load(page);
}

function _sst_download_template() {
	window.open(SST_TEMPLATE_URL, "_blank");
}

function _sst_show_import_dialog(page) {
	const dialog = new frappe.ui.Dialog({
		title: __("Mass Import Warehouse Transfer"),
		size: "large",
		fields: [
			{
				fieldname: "instructions",
				fieldtype: "HTML",
				options: `
					<div class="sst-import-help">
						<p><b>${__("Excel columns")}</b></p>
						<ul>
							<li><b>Seal Device</b> ${__("(required)")}</li>
							<li>Seal Number ${__("(optional reference)")}</li>
						</ul>
						<p>${__("Download the template below. It contains one example row with the required Seal Device column filled.")}</p>
						<button class="btn btn-xs btn-default sst-template-btn" type="button">${__("Download Excel Template")}</button>
					</div>
				`,
			},
			{ fieldname: "source_warehouse", fieldtype: "Link", label: __("Source Warehouse"), options: "Warehouse", get_query: () => ({ filters: { is_group: 0, disabled: 0 } }), reqd: 1 },
			{ fieldname: "target_warehouse", fieldtype: "Link", label: __("Target Warehouse"), options: "Warehouse", get_query: () => ({ filters: { is_group: 0, disabled: 0 } }), reqd: 1 },
			{ fieldname: "transfer_date", fieldtype: "Date", label: __("Transfer Date"), default: frappe.datetime.get_today(), reqd: 1 },
			{
				fieldname: "file_url",
				fieldtype: "Attach",
				label: __("Excel File"),
				reqd: 1,
				options: { restrictions: { allowed_file_types: [".xlsx", ".xls"] } },
			},
			{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks") },
		],
		primary_action_label: __("Import"),
		primary_action(values) {
			frappe.call({
				method: SST_IMPORT_METHOD,
				args: values,
				freeze: true,
				freeze_message: __("Importing warehouse transfer…"),
				callback(r) {
					const result = r.message || {};
					dialog.hide();
					frappe.show_alert({
						message: __("Created Seal Stock Transfer {0} with {1} seal(s)", [result.name, result.total_seals]),
						indicator: "green",
					}, 7);
					_sst_load(page);
					if (result.name) frappe.set_route("Form", "Seal Stock Transfer", result.name);
				},
			});
		},
	});
	dialog.show();
	dialog.$wrapper.find(".sst-template-btn").on("click", _sst_download_template);
}

function _sst_receive_transfer(page, name) {
	frappe.confirm(__("Receive transfer {0} into the target warehouse?", [name]), () => {
		frappe.call({
			method: SST_RECEIVE_METHOD,
			args: { docname: name },
			freeze: true,
			freeze_message: __("Receiving transfer…"),
			callback() {
				frappe.show_alert({ message: __("Transfer received"), indicator: "green" }, 5);
				_sst_load(page);
			},
		});
	});
}

function _sst_set_loading(page, show) {
	$(page.body).find(".sst-loading").toggle(show);
}

function _sst_inject_styles() {
	if (document.getElementById("seal-stock-transfer-page-styles")) return;
	const style = document.createElement("style");
	style.id = "seal-stock-transfer-page-styles";
	style.textContent = `
		.sst-page { --sst-blue:#0284c7; --sst-ink:#0c4a6e; max-width:1580px; margin:0 auto; padding:32px 24px 48px; position:relative; font-family:var(--font-stack); }
		.sst-header-stats { display:flex; align-items:center; gap:8px; flex:1; padding:0 20px; overflow-x:auto; }
		.sst-header-stats .sst-stat-card { display:flex; padding:6px 14px; align-items:center; gap:8px; border-radius:999px; border:1px solid rgba(14,165,233,.2); border-top:1px solid #075985; background:var(--card-bg,#fff); white-space:nowrap; }
		.sst-header-stats .sst-stat--draft { border-top-color:#f59e0b; }
		.sst-header-stats .sst-stat--transit { border-top-color:#0284c7; }
		.sst-header-stats .sst-stat--received { border-top-color:#16a34a; }
		.sst-header-stats .sst-stat--cancelled { border-top-color:#dc2626; }
		.sst-stat-label { color:#0369a1; font-weight:800; text-transform:uppercase; font-size:10px; letter-spacing:.04em; }
		.sst-stat-value { color:var(--sst-ink); font-size:18px; font-weight:900; line-height:1; }
		.sst-panel,.sst-table-panel { border:1px solid rgba(14,165,233,.2); border-radius:22px; background:var(--card-bg,#fff); box-shadow:0 4px 12px rgba(14,165,233,.05); overflow:hidden; }
		.sst-panel { margin-bottom:20px; }
		.sst-table-panel { position:sticky; top:60px; }
		.sst-table-scroll { overflow-x:auto; overflow-y:auto; max-height:calc(100vh - 200px); }
		.sst-toolbar { padding:18px; border-bottom:1px solid #e0f2fe; background:#f0f9ff; }
		.sst-toolbar-top { display:flex; align-items:center; gap:12px; }
		.sst-field { display:flex; flex-direction:column; gap:5px; margin:0; }
		.sst-field > span { color:#0369a1; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
		.sst-search-inline { flex:1; display:flex; align-items:center; }
		.sst-search-inline input { width:100%; height:38px; padding:8px 12px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); color:var(--text-color,#0c4a6e); font-size:14px; }
		.sst-search-inline input:focus,.sst-source-filter .control-input:focus-within,.sst-target-filter .control-input:focus-within { outline:none; border-color:var(--sst-blue); box-shadow:0 0 0 3px rgba(14,165,233,.12); }
		.sst-warehouse-field { min-width:170px; }
		.sst-source-filter .control-input,.sst-target-filter .control-input { height:38px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); overflow:hidden; }
		.sst-source-filter .control-input input,.sst-target-filter .control-input input { border:0; height:100%; padding:0 12px; background:transparent; color:var(--text-color,#0c4a6e); font-size:13px; }
		.sst-source-filter .form-group,.sst-target-filter .form-group { margin:0; }
		.sst-source-filter .control-label,.sst-source-filter .help-box,.sst-target-filter .control-label,.sst-target-filter .help-box { display:none; }
		.sst-filter-dropdown { position:relative; }
		.sst-filter-btn { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 14px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); color:#075985; font-size:13px; font-weight:700; white-space:nowrap; cursor:pointer; }
		.sst-filter-btn:hover { border-color:var(--sst-blue); }
		.sst-filter-btn-count,.sst-fcount { display:inline-flex; align-items:center; justify-content:center; min-width:22px; padding:1px 6px; border-radius:999px; background:#e0f2fe; color:#075985; font-size:11px; font-weight:800; }
		.sst-filter-arrow { color:#94a3b8; font-size:11px; }
		.sst-filter-menu { display:none; position:fixed; min-width:240px; border:1px solid #bae6fd; border-radius:12px; background:var(--card-bg,#fff); box-shadow:0 8px 24px rgba(14,165,233,.12); z-index:1000; overflow:hidden; }
		.sst-filter-menu.open { display:block; }
		.sst-filter-item { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:13px; font-weight:600; color:#334155; cursor:pointer; }
		.sst-filter-item:hover { background:#f0f9ff; }
		.sst-filter-item.active { background:#e0f2fe; color:var(--sst-blue); }
		.sst-filter-item.active .sst-fcount { background:var(--sst-blue); color:#fff; }
		.sst-clear-btn { height:38px; padding:9px 16px; border:1px solid #cbd5e1; border-radius:10px; background:var(--card-bg,#fff); color:#475569; font-size:13px; font-weight:700; cursor:pointer; }
		.sst-table { width:100%; min-width:1280px; border-collapse:collapse; table-layout:auto; }
		.sst-table th,.sst-table td { padding:16px 18px; border-bottom:1px solid #e0f2fe; text-align:left; vertical-align:middle; color:var(--text-color,#334155); font-size:14px; line-height:1.45; }
		.sst-table th { position:sticky; top:0; z-index:10; background:#f0f9ff; color:#0369a1; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
		.sst-row { cursor:pointer; }
		.sst-row:hover { background:rgba(224,242,254,.7); }
		.sst-row td:first-child { border-left:3px solid transparent; }
		.sst-row:hover td:first-child { border-left-color:var(--sst-blue); }
		.sst-name { color:var(--sst-blue); font-size:14px; font-weight:800; }
		.text-right { text-align:right !important; }
		.sst-badge { display:inline-flex; border-radius:999px; padding:6px 11px; font-size:12px; font-weight:800; white-space:nowrap; }
		.sst-badge--draft { background:#fef3c7; color:#92400e; }
		.sst-badge--in-transit { background:#dbeafe; color:#1d4ed8; }
		.sst-badge--received { background:#dcfce7; color:#166534; }
		.sst-badge--cancelled { background:#fee2e2; color:#b91c1c; }
		.sst-receive-btn { border:1px solid var(--sst-blue); border-radius:999px; background:var(--sst-blue); color:#fff; padding:7px 12px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer; }
		.sst-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:58px 20px; color:var(--text-muted,#64748b); text-align:center; }
		.sst-empty strong { color:var(--sst-ink); font-size:22px; }
		.sst-pagination { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; background:#f0f9ff; color:#0369a1; font-size:13px; }
		.sst-pagination div { display:flex; align-items:center; gap:9px; }
		.sst-page-btn { padding:6px 12px; border:1px solid #bae6fd; border-radius:8px; background:var(--card-bg,#fff); color:#075985; font-size:13px; font-weight:700; cursor:pointer; }
		.sst-page-btn:disabled { cursor:default; opacity:.45; }
		.sst-loading { position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; border-radius:22px; background:rgba(240,249,255,.72); backdrop-filter:blur(2px); }
		.sst-spinner { width:38px; height:38px; border:3px solid rgba(14,165,233,.18); border-top-color:var(--sst-blue); border-radius:50%; animation:sst-spin .7s linear infinite; }
		.sst-import-help { padding:10px 12px; border:1px solid #bae6fd; border-radius:12px; background:#f0f9ff; color:#0c4a6e; }
		.sst-import-help ul { margin:8px 0 10px 20px; }
		@keyframes sst-spin { to { transform:rotate(360deg); } }
		[data-theme="dark"] .sst-panel,[data-theme="dark"] .sst-table-panel,[data-theme="dark"] .sst-page-btn,[data-theme="dark"] .sst-filter-btn,[data-theme="dark"] .sst-filter-menu,[data-theme="dark"] .sst-search-inline input,[data-theme="dark"] .sst-source-filter .control-input,[data-theme="dark"] .sst-target-filter .control-input,[data-theme="dark"] .sst-clear-btn { background:#1e293b; border-color:#334155; color:#cbd5e1; }
		[data-theme="dark"] .sst-toolbar,[data-theme="dark"] .sst-table th,[data-theme="dark"] .sst-pagination { background:#0f172a; border-color:#334155; color:#7dd3fc; }
		[data-theme="dark"] .sst-table td { border-bottom-color:#334155; color:#cbd5e1; }
		[data-theme="dark"] .sst-row:hover { background:rgba(14,165,233,.12); }
		@media (max-width:1100px) { .sst-toolbar-top { flex-direction:column; align-items:stretch; } }
		@media (max-width:720px) { .sst-page { padding:10px 8px 32px; } .sst-pagination { align-items:flex-start; flex-direction:column; } }
	`;
	document.head.appendChild(style);
}
