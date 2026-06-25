frappe.pages["seal-acquisition-list"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Seal Acquisitions"),
		single_column: true,
	});

	page.sa_state = {
		search: "",
		status: "All",
		warehouse: "",
		page: 1,
		page_length: 25,
		total: 0,
		request_id: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _sa_load(page));
	if (_sa_can_manage()) {
		_sa_add_new_dropdown(page);
	}

	const $statsBar = $('<div class="sa-header-stats"></div>');
	$(wrapper).find(".page-head .page-actions").before($statsBar);
	page.sa_stats_bar = $statsBar;

	_sa_inject_styles();
	_sa_build_page(page);
	_sa_load(page);
};

const SA_METHOD = "tnt_seal_management.tnt_seal_management.api.seal_acquisition_list.get_seal_acquisition_list";
const SA_IMPORT_METHOD = "tnt_seal_management.tnt_seal_management.api.seal_acquisition_list.import_from_excel";
const SA_TEMPLATE_URL = "/api/method/tnt_seal_management.tnt_seal_management.api.seal_acquisition_list.download_template";

function _sa_can_manage() {
	return ["System Manager", "Seal System Administrator", "Operations Control Room", "Management"]
		.some((role) => frappe.user.has_role(role));
}

function _sa_add_new_dropdown(page) {
	const $group = $(
		`<div class="btn-group sa-new-dropdown">
			<button type="button" class="btn btn-primary btn-sm dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
				${__("New")}
			</button>
			<ul class="dropdown-menu dropdown-menu-right">
				<li><a class="dropdown-item" href="#" data-sa-action="new-acquisition">${__("New Acquisition")}</a></li>
				<li><a class="dropdown-item" href="#" data-sa-action="mass-import">${__("Mass Import")}</a></li>
			</ul>
		</div>`
	);

	page.page_actions.find(".sa-new-dropdown").remove();
	page.page_actions.prepend($group);
	$group.on("click", "[data-sa-action]", function (event) {
		event.preventDefault();
		const action = $(this).data("sa-action");
		if (action === "new-acquisition") {
			frappe.new_doc("Seal Acquisition");
		} else if (action === "mass-import") {
			_sa_show_import_dialog(page);
		}
	});
}

function _sa_build_page(page) {
	const statuses = [
		["All", __("All Acquisitions")],
		["Draft", __("Draft")],
		["Received", __("Received")],
		["Cancelled", __("Cancelled")],
	];

	$(page.body).html(`
		<div class="sa-page">
			<section class="sa-panel">
				<div class="sa-toolbar">
					<div class="sa-toolbar-top">
						<label class="sa-field sa-search-inline">
							<input class="sa-search" type="search" placeholder="${__("Acquisition, supplier, invoice or warehouse")}">
						</label>

						<div class="sa-filter-dropdown">
							<button class="sa-filter-btn">
								<span class="sa-filter-btn-label">${__("All Acquisitions")}</span>
								<span class="sa-filter-btn-count">0</span>
								<span class="sa-filter-arrow">&#9662;</span>
							</button>
							<div class="sa-filter-menu">
								${statuses.map(([val, label]) => `
									<div class="sa-filter-item ${val === "All" ? "active" : ""}" data-status="${frappe.utils.escape_html(val)}" data-label="${frappe.utils.escape_html(label)}">
										${frappe.utils.escape_html(label)}
										<span class="sa-fcount" data-fcount="${frappe.utils.escape_html(val)}">0</span>
									</div>
								`).join("")}
							</div>
						</div>

						<label class="sa-field sa-warehouse-field">
							<span>${__("Warehouse")}</span>
							<div class="sa-warehouse-filter"></div>
						</label>

						<div class="sa-actions">
							<button class="sa-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
			</section>

			<section class="sa-table-panel">
				<div class="sa-table-scroll"><div class="sa-table-wrap"></div></div>
				<div class="sa-pagination"></div>
			</section>

			<div class="sa-loading" style="display:none"><div class="sa-spinner"></div></div>
		</div>
	`);

	page.sa_warehouse_control = frappe.ui.form.make_control({
		parent: $(page.body).find(".sa-warehouse-filter"),
		df: {
			fieldname: "warehouse",
			fieldtype: "Link",
			options: "Custody Point",
			placeholder: __("All warehouses"),
		},
		render_input: true,
	});

	const delayedSearch = frappe.utils.debounce(() => {
		page.sa_state.search = ($(page.body).find(".sa-search").val() || "").trim();
		page.sa_state.page = 1;
		_sa_load(page);
	}, 300);

	$(page.body).on("input", ".sa-search", delayedSearch);
	page.sa_warehouse_control.$input.on("change", () => {
		page.sa_state.warehouse = page.sa_warehouse_control.get_value() || "";
		page.sa_state.page = 1;
		_sa_load(page);
	});

	$(page.body).on("click", ".sa-filter-btn", function (e) {
		e.stopPropagation();
		const $menu = $(page.body).find(".sa-filter-menu");
		if (!$menu.hasClass("open")) {
			const rect = this.getBoundingClientRect();
			$menu.css({ top: rect.bottom + 6, left: rect.left });
		}
		$menu.toggleClass("open");
	});

	$(page.body).on("click", ".sa-filter-item", function () {
		page.sa_state.status = $(this).data("status");
		page.sa_state.page = 1;
		$(page.body).find(".sa-filter-item").removeClass("active");
		$(this).addClass("active");
		$(page.body).find(".sa-filter-btn-label").text($(this).data("label"));
		$(page.body).find(".sa-filter-menu").removeClass("open");
		_sa_load(page);
	});

	$(document).on("click.sa-dropdown", () => {
		$(page.body).find(".sa-filter-menu").removeClass("open");
	});

	$(page.body).on("click", ".sa-clear-btn", () => _sa_clear_filters(page));
	$(page.body).on("click", ".sa-row", function () {
		const name = $(this).data("name");
		if (name) frappe.set_route("Form", "Seal Acquisition", name);
	});
	$(page.body).on("click", ".sa-page-btn", function () {
		if ($(this).prop("disabled")) return;
		page.sa_state.page = Number.parseInt($(this).data("page"), 10);
		_sa_load(page);
	});
}

function _sa_load(page) {
	const requestId = ++page.sa_state.request_id;
	_sa_set_loading(page, true);
	frappe.call({
		method: SA_METHOD,
		args: {
			search: page.sa_state.search,
			status: page.sa_state.status,
			warehouse: page.sa_state.warehouse,
			page: page.sa_state.page,
			page_length: page.sa_state.page_length,
		},
		callback(r) {
			if (requestId !== page.sa_state.request_id) return;
			_sa_set_loading(page, false);
			const data = r.message || {};
			page.sa_state.total = data.total || 0;
			_sa_render_stats(page, data.summary || {});
			_sa_render_table(page, data.acquisitions || []);
			_sa_render_pagination(page);
		},
		error() {
			if (requestId !== page.sa_state.request_id) return;
			_sa_set_loading(page, false);
			frappe.show_alert({ message: __("Could not load seal acquisitions"), indicator: "red" }, 5);
		},
	});
}

function _sa_render_stats(page, summary) {
	const html = `
		<div class="sa-stat-card">
			<div class="sa-stat-label">${__("All")}</div>
			<div class="sa-stat-value">${summary.All || 0}</div>
		</div>
		<div class="sa-stat-card sa-stat--draft">
			<div class="sa-stat-label">${__("Draft")}</div>
			<div class="sa-stat-value">${summary.Draft || 0}</div>
		</div>
		<div class="sa-stat-card sa-stat--received">
			<div class="sa-stat-label">${__("Received")}</div>
			<div class="sa-stat-value">${summary.Received || 0}</div>
		</div>
		<div class="sa-stat-card sa-stat--cancelled">
			<div class="sa-stat-label">${__("Cancelled")}</div>
			<div class="sa-stat-value">${summary.Cancelled || 0}</div>
		</div>
	`;
	if (page.sa_stats_bar) page.sa_stats_bar.html(html);

	const countMap = {
		All: summary.All || 0,
		Draft: summary.Draft || 0,
		Received: summary.Received || 0,
		Cancelled: summary.Cancelled || 0,
	};
	$(page.body).find(".sa-fcount").each(function () {
		$(this).text(countMap[$(this).data("fcount")] ?? 0);
	});
	$(page.body).find(".sa-filter-btn-count").text(countMap[page.sa_state.status] ?? 0);
}

function _sa_render_table(page, acquisitions) {
	if (!acquisitions.length) {
		$(page.body).find(".sa-table-wrap").html(`
			<div class="sa-empty">
				<strong>${__("No seal acquisitions found")}</strong>
				<span>${__("Use Mass Import to create an acquisition batch from Excel.")}</span>
			</div>
		`);
		return;
	}

	$(page.body).find(".sa-table-wrap").html(`
		<table class="sa-table">
			<thead><tr>
				<th>${__("Acquisition")}</th>
				<th>${__("Supplier")}</th>
				<th>${__("Invoice / PO")}</th>
				<th>${__("Warehouse")}</th>
				<th>${__("Received Date")}</th>
				<th>${__("Initial Status")}</th>
				<th class="text-right">${__("Seals")}</th>
				<th>${__("Status")}</th>
			</tr></thead>
			<tbody>${acquisitions.map(_sa_row_html).join("")}</tbody>
		</table>
	`);
}

function _sa_row_html(row) {
	const status = row.acquisition_status || "Draft";
	const statusClass = status.toLowerCase().replaceAll(" ", "-");
	const date = row.received_date ? frappe.datetime.str_to_user(row.received_date) : "—";
	return `
		<tr class="sa-row" data-name="${frappe.utils.escape_html(row.name)}">
			<td><span class="sa-name">${frappe.utils.escape_html(row.name)}</span></td>
			<td>${frappe.utils.escape_html(row.supplier || "—")}</td>
			<td>${frappe.utils.escape_html(row.invoice_reference || "—")}</td>
			<td>${frappe.utils.escape_html(row.target_warehouse || "—")}</td>
			<td>${frappe.utils.escape_html(date)}</td>
			<td>${frappe.utils.escape_html(row.default_status || "—")}</td>
			<td class="text-right">${cint(row.total_seals)}</td>
			<td><span class="sa-badge sa-badge--${statusClass}">${frappe.utils.escape_html(status)}</span></td>
		</tr>
	`;
}

function _sa_render_pagination(page) {
	const totalPages = Math.max(1, Math.ceil(page.sa_state.total / page.sa_state.page_length));
	page.sa_state.page = Math.min(page.sa_state.page, totalPages);
	const start = page.sa_state.total ? (page.sa_state.page - 1) * page.sa_state.page_length + 1 : 0;
	const end = Math.min(page.sa_state.page * page.sa_state.page_length, page.sa_state.total);
	$(page.body).find(".sa-pagination").html(`
		<span>${__("Showing {0}-{1} of {2}", [start, end, page.sa_state.total])}</span>
		<div>
			<button class="sa-page-btn" data-page="${page.sa_state.page - 1}" ${page.sa_state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
			<b>${__("Page {0} of {1}", [page.sa_state.page, totalPages])}</b>
			<button class="sa-page-btn" data-page="${page.sa_state.page + 1}" ${page.sa_state.page >= totalPages ? "disabled" : ""}>${__("Next")}</button>
		</div>
	`);
}

function _sa_clear_filters(page) {
	Object.assign(page.sa_state, { search: "", status: "All", warehouse: "", page: 1 });
	$(page.body).find(".sa-search").val("");
	page.sa_warehouse_control.set_value("");
	$(page.body).find(".sa-filter-item").removeClass("active");
	$(page.body).find('.sa-filter-item[data-status="All"]').addClass("active");
	$(page.body).find(".sa-filter-btn-label").text(__("All Acquisitions"));
	_sa_load(page);
}

function _sa_download_template() {
	window.open(SA_TEMPLATE_URL, "_blank");
}

function _sa_show_import_dialog(page) {
	const dialog = new frappe.ui.Dialog({
		title: __("Mass Import Seal Acquisition"),
		size: "large",
		fields: [
			{
				fieldname: "instructions",
				fieldtype: "HTML",
				options: `
					<div class="sa-import-help">
						<p><b>${__("Excel columns")}</b></p>
						<ul>
							<li><b>Seal Number</b> ${__("(required)")}</li>
							<li><b>Device ID</b> ${__("(required)")}</li>
							<li>IMEI Number</li>
							<li>Serial Number</li>
							<li>Seal Type</li>
							<li>Purchase Cost</li>
						</ul>
						<p>${__("Download the template below. It contains one example row with required fields filled.")}</p>
						<button class="btn btn-xs btn-default sa-template-btn" type="button">${__("Download Excel Template")}</button>
					</div>
				`,
			},
			{ fieldname: "supplier", fieldtype: "Link", label: __("Supplier"), options: "Supplier" },
			{ fieldname: "invoice_reference", fieldtype: "Data", label: __("Invoice / PO Reference") },
			{ fieldname: "received_date", fieldtype: "Date", label: __("Received Date"), default: frappe.datetime.get_today(), reqd: 1 },
			{ fieldname: "target_warehouse", fieldtype: "Link", label: __("Receiving Warehouse"), options: "Custody Point", reqd: 1 },
			{
				fieldname: "default_status",
				fieldtype: "Select",
				label: __("Initial Seal Status"),
				options: "Quality Check\nAvailable",
				default: "Quality Check",
				reqd: 1,
			},
			{
				fieldname: "import_file",
				fieldtype: "Attach",
				label: __("Excel File"),
				reqd: 1,
				options: {
					restrictions: { allowed_file_types: [".xlsx", ".xls"] },
				},
			},
			{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks") },
		],
		primary_action_label: __("Import"),
		primary_action(values) {
			frappe.call({
				method: SA_IMPORT_METHOD,
				args: values,
				freeze: true,
				freeze_message: __("Importing seal acquisition…"),
				callback(r) {
					const result = r.message || {};
					dialog.hide();
					frappe.show_alert({
						message: __("Created Seal Acquisition {0} with {1} seal(s)", [result.name, result.total_seals]),
						indicator: "green",
					}, 7);
					_sa_load(page);
					if (result.name) frappe.set_route("Form", "Seal Acquisition", result.name);
				},
			});
		},
	});
	dialog.show();
	dialog.$wrapper.addClass("sa-import-dialog");
	dialog.$wrapper.find(".modal-dialog").css({ "max-width": "720px" });
	dialog.$wrapper.find(".modal-content").css({ "max-height": "calc(72vh + 1rem)", display: "flex", "flex-direction": "column" });
	dialog.$wrapper.find(".modal-body").css({ overflow: "auto", "max-height": "calc(72vh + 1rem - 120px)", padding: "16px 20px" });
	dialog.$wrapper.find(".sa-template-btn").on("click", _sa_download_template);
}

function _sa_set_loading(page, show) {
	$(page.body).find(".sa-loading").toggle(show);
}

function _sa_inject_styles() {
	if (document.getElementById("seal-acquisition-page-styles")) return;
	const style = document.createElement("style");
	style.id = "seal-acquisition-page-styles";
	style.textContent = `
		.sa-page { --sa-blue:#0284c7; --sa-ink:#0c4a6e; max-width:1580px; margin:0 auto; padding:32px 24px 48px; position:relative; font-family:var(--font-stack); }
		.sa-header-stats { display:flex; align-items:center; gap:8px; flex:1; padding:0 20px; overflow-x:auto; }
		.sa-header-stats .sa-stat-card { display:flex; padding:6px 14px; align-items:center; gap:8px; border-radius:999px; border:1px solid rgba(14,165,233,.2); border-top:1px solid #075985; background:var(--card-bg,#fff); white-space:nowrap; }
		.sa-header-stats .sa-stat--draft { border-top-color:#f59e0b; }
		.sa-header-stats .sa-stat--received { border-top-color:#16a34a; }
		.sa-header-stats .sa-stat--cancelled { border-top-color:#dc2626; }
		.sa-stat-label { color:#0369a1; font-weight:800; text-transform:uppercase; font-size:10px; letter-spacing:.04em; }
		.sa-stat-value { color:var(--sa-ink); font-size:18px; font-weight:900; line-height:1; }
		.sa-panel,.sa-table-panel { border:1px solid rgba(14,165,233,.2); border-radius:22px; background:var(--card-bg,#fff); box-shadow:0 4px 12px rgba(14,165,233,.05); overflow:hidden; }
		.sa-panel { margin-bottom:20px; }
		.sa-table-panel { position:sticky; top:60px; }
		.sa-table-scroll { overflow-x:auto; overflow-y:auto; max-height:calc(100vh - 200px); }
		.sa-toolbar { padding:18px; border-bottom:1px solid #e0f2fe; background:#f0f9ff; }
		.sa-toolbar-top { display:flex; align-items:center; gap:12px; }
		.sa-field { display:flex; flex-direction:column; gap:5px; margin:0; }
		.sa-field > span { color:#0369a1; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
		.sa-search-inline { flex:1; display:flex; align-items:center; }
		.sa-search-inline input { width:100%; height:38px; padding:8px 12px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); color:var(--text-color,#0c4a6e); font-size:14px; }
		.sa-search-inline input:focus,.sa-warehouse-filter .control-input:focus-within { outline:none; border-color:var(--sa-blue); box-shadow:0 0 0 3px rgba(14,165,233,.12); }
		.sa-warehouse-field { min-width:190px; }
		.sa-warehouse-filter .control-input { height:38px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); overflow:hidden; }
		.sa-warehouse-filter .control-input input { border:0; height:100%; padding:0 12px; background:transparent; color:var(--text-color,#0c4a6e); font-size:13px; }
		.sa-warehouse-filter .form-group { margin:0; }
		.sa-warehouse-filter .control-label,.sa-warehouse-filter .help-box { display:none; }
		.sa-filter-dropdown { position:relative; }
		.sa-filter-btn { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 14px; border:1px solid #bae6fd; border-radius:10px; background:var(--card-bg,#fff); color:#075985; font-size:13px; font-weight:700; white-space:nowrap; cursor:pointer; }
		.sa-filter-btn:hover { border-color:var(--sa-blue); }
		.sa-filter-btn-count,.sa-fcount { display:inline-flex; align-items:center; justify-content:center; min-width:22px; padding:1px 6px; border-radius:999px; background:#e0f2fe; color:#075985; font-size:11px; font-weight:800; }
		.sa-filter-arrow { color:#94a3b8; font-size:11px; }
		.sa-filter-menu { display:none; position:fixed; min-width:240px; border:1px solid #bae6fd; border-radius:12px; background:var(--card-bg,#fff); box-shadow:0 8px 24px rgba(14,165,233,.12); z-index:1000; overflow:hidden; }
		.sa-filter-menu.open { display:block; }
		.sa-filter-item { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:13px; font-weight:600; color:#334155; cursor:pointer; }
		.sa-filter-item:hover { background:#f0f9ff; }
		.sa-filter-item.active { background:#e0f2fe; color:var(--sa-blue); }
		.sa-filter-item.active .sa-fcount { background:var(--sa-blue); color:#fff; }
		.sa-clear-btn { height:38px; padding:9px 16px; border:1px solid #cbd5e1; border-radius:10px; background:var(--card-bg,#fff); color:#475569; font-size:13px; font-weight:700; cursor:pointer; }
		.sa-table { width:100%; min-width:1180px; border-collapse:collapse; table-layout:auto; }
		.sa-table th,.sa-table td { padding:16px 18px; border-bottom:1px solid #e0f2fe; text-align:left; vertical-align:middle; color:var(--text-color,#334155); font-size:14px; line-height:1.45; }
		.sa-table th { position:sticky; top:0; z-index:10; background:#f0f9ff; color:#0369a1; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
		.sa-row { cursor:pointer; }
		.sa-row:hover { background:rgba(224,242,254,.7); }
		.sa-row td:first-child { border-left:3px solid transparent; }
		.sa-row:hover td:first-child { border-left-color:var(--sa-blue); }
		.sa-name { color:var(--sa-blue); font-size:14px; font-weight:800; }
		.text-right { text-align:right !important; }
		.sa-badge { display:inline-flex; border-radius:999px; padding:6px 11px; font-size:12px; font-weight:800; white-space:nowrap; }
		.sa-badge--draft { background:#fef3c7; color:#92400e; }
		.sa-badge--received { background:#dcfce7; color:#166534; }
		.sa-badge--cancelled { background:#fee2e2; color:#b91c1c; }
		.sa-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:58px 20px; color:var(--text-muted,#64748b); text-align:center; }
		.sa-empty strong { color:var(--sa-ink); font-size:22px; }
		.sa-pagination { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; background:#f0f9ff; color:#0369a1; font-size:13px; }
		.sa-pagination div { display:flex; align-items:center; gap:9px; }
		.sa-page-btn { padding:6px 12px; border:1px solid #bae6fd; border-radius:8px; background:var(--card-bg,#fff); color:#075985; font-size:13px; font-weight:700; cursor:pointer; }
		.sa-page-btn:disabled { cursor:default; opacity:.45; }
		.sa-loading { position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; border-radius:22px; background:rgba(240,249,255,.72); backdrop-filter:blur(2px); }
		.sa-spinner { width:38px; height:38px; border:3px solid rgba(14,165,233,.18); border-top-color:var(--sa-blue); border-radius:50%; animation:sa-spin .7s linear infinite; }
		.sa-import-help { padding:10px 12px; border:1px solid #bae6fd; border-radius:12px; background:#f0f9ff; color:#0c4a6e; }
		.sa-import-help ul { margin:8px 0 10px 20px; }
		@keyframes sa-spin { to { transform:rotate(360deg); } }
		[data-theme="dark"] .sa-panel,[data-theme="dark"] .sa-table-panel,[data-theme="dark"] .sa-page-btn,[data-theme="dark"] .sa-filter-btn,[data-theme="dark"] .sa-filter-menu,[data-theme="dark"] .sa-search-inline input,[data-theme="dark"] .sa-warehouse-filter .control-input,[data-theme="dark"] .sa-clear-btn { background:#1e293b; border-color:#334155; color:#cbd5e1; }
		[data-theme="dark"] .sa-toolbar,[data-theme="dark"] .sa-table th,[data-theme="dark"] .sa-pagination { background:#0f172a; border-color:#334155; color:#7dd3fc; }
		[data-theme="dark"] .sa-table td { border-bottom-color:#334155; color:#cbd5e1; }
		[data-theme="dark"] .sa-row:hover { background:rgba(14,165,233,.12); }
		@media (max-width:1100px) { .sa-toolbar-top { flex-direction:column; align-items:stretch; } }
		@media (max-width:720px) { .sa-page { padding:10px 8px 32px; } .sa-pagination { align-items:flex-start; flex-direction:column; } }
	`;
	document.head.appendChild(style);
}
