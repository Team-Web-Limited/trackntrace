frappe.pages["control-room"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Control Room"),
		single_column: true,
	});

	page.control_room_state = {
		tab: "approve",
		loading: false,
		requests: [],
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => _control_room_load_queue(page));

	_control_room_inject_styles();
	_control_room_render(page);
	_control_room_load_queue(page);
};

const CR_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.${name}`;

function _control_room_render(page) {
	const state = page.control_room_state;
	$(page.body).html(`
		<div class="cr-page">
			<section class="cr-panel">
				<div class="cr-tabs">
					<button class="cr-tab ${state.tab === "approve" ? "active" : ""}" data-tab="approve">
						${__("Approve")}
						<span class="cr-tab-count" data-cr-count>${state.requests.length}</span>
					</button>
					<button class="cr-tab ${state.tab === "alert" ? "active" : ""}" data-tab="alert">${__("Alert")}</button>
				</div>
				<div class="cr-tab-body" data-cr-body></div>
			</section>
		</div>
	`);

	$(page.body)
		.off("click", ".cr-tab")
		.on("click", ".cr-tab", function () {
			const tab = $(this).data("tab");
			if (!tab || tab === page.control_room_state.tab) return;
			page.control_room_state.tab = tab;
			_control_room_render(page);
			_control_room_render_body(page);
		});

	_control_room_bind_actions(page);
	_control_room_render_body(page);
}

function _control_room_render_body(page) {
	const state = page.control_room_state;
	const $body = $(page.body).find("[data-cr-body]");

	if (state.tab === "alert") {
		$body.html(`
			<div class="cr-empty">
				<div class="cr-empty-icon">🛎️</div>
				<h3>${__("Alert queue coming soon")}</h3>
				<p>${__("Seal exceptions, journey disruptions and low-battery signals will surface here.")}</p>
			</div>
		`);
		return;
	}

	if (state.loading) {
		$body.html(`<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading approval queue…")}</div>`);
		return;
	}

	if (!state.requests.length) {
		$body.html(`
			<div class="cr-empty">
				<div class="cr-empty-icon">✅</div>
				<h3>${__("Nothing awaiting approval")}</h3>
				<p>${__("When a Tag Operator submits a seal journey for checking, it appears here for your review.")}</p>
			</div>
		`);
		return;
	}

	$body.html(`
		<div class="cr-queue-head">
			<h3>${__("Seal journeys awaiting your check")}</h3>
			<span class="cr-queue-sub">${__("Verify each seal's live status, then approve or reject the request.")}</span>
		</div>
		<div class="cr-queue">${state.requests.map(_control_room_request_card).join("")}</div>
	`);
}

function _control_room_request_card(req) {
	const seals = req.seals || [];
	const sealRows = seals.length
		? seals.map(_control_room_seal_row).join("")
		: `<tr><td colspan="6" class="cr-seal-empty">${__("No seals on this request")}</td></tr>`;

	return `
		<article class="cr-req" data-req="${frappe.utils.escape_html(req.name)}">
			<header class="cr-req-head">
				<div>
					<span class="cr-req-id">${frappe.utils.escape_html(req.name)}</span>
					<span class="cr-req-status">${__("Pending Control Room Approval")}</span>
				</div>
				<div class="cr-req-client">${frappe.utils.escape_html(req.client_name || "—")}</div>
			</header>

			<div class="cr-meta">
				${_cr_meta(__("Tag Operator"), req.assigned_technician_name || "—")}
				${_cr_meta(__("Job Order"), req.job_order || "—")}
				${_cr_meta(__("Vehicle"), req.vehicle || "—")}
				${_cr_meta(__("Driver"), req.driver_contact || "—")}
				${_cr_meta(__("Route"), `${frappe.utils.escape_html(req.origin || "—")} → ${frappe.utils.escape_html(req.destination || "—")}`, true)}
				${_cr_meta(__("Entry / Container"), `${frappe.utils.escape_html(req.entry_number || "—")} / ${frappe.utils.escape_html(req.container_number || "—")}`, true)}
			</div>

			<div class="cr-seal-wrap">
				<table class="cr-seal-table">
					<thead>
						<tr>
							<th>${__("Seal")}</th>
							<th>${__("Lock")}</th>
							<th>${__("Device Status")}</th>
							<th>${__("Battery")}</th>
							<th>${__("Location")}</th>
							<th>${__("Last Update")}</th>
						</tr>
					</thead>
					<tbody>${sealRows}</tbody>
				</table>
			</div>

			<footer class="cr-req-actions">
				<button class="btn btn-default btn-sm cr-act" data-act="refresh">${__("Refresh Seal Status")}</button>
				<div class="cr-req-actions-right">
					<button class="btn btn-default btn-sm cr-act cr-act--reject" data-act="reject">${__("Reject")}</button>
					<button class="btn btn-primary btn-sm cr-act" data-act="approve">${__("Approve")}</button>
				</div>
			</footer>
		</article>
	`;
}

function _cr_meta(label, value, wide) {
	return `
		<div class="cr-meta-item ${wide ? "cr-meta-item--wide" : ""}">
			<span class="cr-meta-label">${label}</span>
			<span class="cr-meta-value">${value}</span>
		</div>
	`;
}

function _control_room_seal_row(seal) {
	const lock = seal.lock_status || "—";
	const lockClass =
		lock === "Locked" ? "cr-pill--ok" : lock === "Unlocked" ? "cr-pill--warn" : "cr-pill--muted";

	const battery = _cr_battery(seal.battery_level);
	const lastUpdate = seal.api_last_update_time
		? frappe.datetime.str_to_user(seal.api_last_update_time)
		: "—";

	return `
		<tr>
			<td>
				<div class="cr-seal-no">${frappe.utils.escape_html(seal.seal_number || seal.seal_device || "—")}</div>
				<div class="cr-seal-dev">${frappe.utils.escape_html(seal.seal_device || "")}</div>
			</td>
			<td><span class="cr-pill ${lockClass}">${frappe.utils.escape_html(lock)}</span></td>
			<td>${frappe.utils.escape_html(seal.api_device_status || "—")}</td>
			<td><span class="cr-batt ${battery.cls}">${battery.label}</span></td>
			<td class="cr-seal-loc">${frappe.utils.escape_html(seal.api_location || "—")}</td>
			<td>${frappe.utils.escape_html(lastUpdate)}</td>
		</tr>
	`;
}

function _cr_battery(raw) {
	const value = parseInt(raw, 10);
	if (Number.isNaN(value) || value < 0 || value > 100) {
		// Sensors sometimes report sentinel values like 255 — treat as unknown.
		return { label: "—", cls: "cr-batt--muted" };
	}
	let cls = "cr-batt--ok";
	if (value <= 20) cls = "cr-batt--low";
	else if (value <= 50) cls = "cr-batt--mid";
	return { label: `${value}%`, cls };
}

function _control_room_bind_actions(page) {
	$(page.body)
		.off("click", ".cr-act")
		.on("click", ".cr-act", function () {
			const $card = $(this).closest(".cr-req");
			const docname = $card.data("req");
			const act = $(this).data("act");
			if (!docname || !act) return;

			if (act === "refresh") _control_room_refresh_seals(page, docname);
			else if (act === "approve") _control_room_approve(page, docname);
			else if (act === "reject") _control_room_reject(page, docname);
		});
}

function _control_room_load_queue(page) {
	page.control_room_state.loading = true;
	_control_room_render_body(page);

	frappe.call({
		method: CR_METHOD("get_control_room_queue"),
		callback(r) {
			const state = page.control_room_state;
			state.loading = false;
			state.requests = (r.message && r.message.requests) || [];
			$(page.body).find("[data-cr-count]").text(state.requests.length);
			_control_room_render_body(page);
		},
		error() {
			page.control_room_state.loading = false;
			_control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load approval queue"), indicator: "red" }, 5);
		},
	});
}

function _control_room_approve(page, docname) {
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (optional)"),
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD("approve_by_control_room"),
				args: { docname, remarks: values.remarks || null },
				freeze: true,
				freeze_message: __("Approving…"),
				callback() {
					frappe.show_alert(
						{ message: __("{0} approved — tagging can begin", [docname]), indicator: "green" },
						6
					);
					_control_room_load_queue(page);
				},
			});
		},
		__("Approve {0}", [docname]),
		__("Approve")
	);
}

function _control_room_reject(page, docname) {
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Reason for rejection"),
				reqd: 1,
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD("reject_by_control_room"),
				args: { docname, remarks: values.remarks },
				freeze: true,
				freeze_message: __("Rejecting…"),
				callback() {
					frappe.show_alert({ message: __("{0} rejected", [docname]), indicator: "orange" }, 6);
					_control_room_load_queue(page);
				},
			});
		},
		__("Reject {0}", [docname]),
		__("Reject")
	);
}

function _control_room_refresh_seals(page, docname) {
	frappe.call({
		method: CR_METHOD("refresh_proposed_seal_status"),
		args: { docname },
		freeze: true,
		freeze_message: __("Fetching live seal data…"),
		callback(r) {
			const res = r.message || {};
			frappe.show_alert(
				{
					message: __("Refreshed {0} seal(s)", [res.refreshed || 0]),
					indicator: (res.errors || []).length ? "orange" : "green",
				},
				6
			);
			if ((res.errors || []).length) {
				frappe.msgprint({
					title: __("Some seals could not be refreshed"),
					message: res.errors.join("<br>"),
					indicator: "orange",
				});
			}
			_control_room_load_queue(page);
		},
	});
}

function _control_room_inject_styles() {
	if (document.getElementById("control-room-page-styles")) return;

	const style = document.createElement("style");
	style.id = "control-room-page-styles";
	style.textContent = `
		.cr-page {
			max-width: 1280px;
			margin: 0 auto;
			padding: 24px 20px 48px;
			font-family: var(--font-stack);
		}
		.cr-panel {
			border: 1px solid rgba(14, 165, 233, .18);
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .06);
			overflow: hidden;
		}
		.cr-tabs {
			display: flex;
			gap: 10px;
			padding: 16px 18px;
			border-bottom: 1px solid #dbeafe;
			background: #f8fbff;
		}
		.cr-tab {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			border: 1px solid #bfdbfe;
			border-radius: 999px;
			background: #fff;
			color: #075985;
			padding: 9px 18px;
			font-size: 13px;
			font-weight: 800;
			cursor: pointer;
		}
		.cr-tab.active { border-color: #0284c7; background: #0284c7; color: #fff; }
		.cr-tab-count {
			min-width: 20px;
			padding: 1px 7px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-tab.active .cr-tab-count { background: rgba(255,255,255,.25); color: #fff; }
		.cr-tab-body { padding: 22px; }

		.cr-queue-head { margin-bottom: 16px; }
		.cr-queue-head h3 { margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-queue-sub { color: #64748b; font-size: 13px; }

		.cr-queue { display: grid; gap: 18px; }

		.cr-req {
			border: 1px solid #e2e8f0;
			border-radius: 18px;
			background: #fff;
			overflow: hidden;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-req-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 16px 20px;
			background: linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%);
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-req-id { font-size: 15px; font-weight: 800; color: #0f172a; margin-right: 10px; }
		.cr-req-status {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #fef9c3;
			color: #854d0e;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-req-client { font-size: 14px; font-weight: 700; color: #334155; text-align: right; }

		.cr-meta {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px 20px;
			padding: 18px 20px;
		}
		.cr-meta-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
		.cr-meta-item--wide { grid-column: span 2; }
		.cr-meta-label {
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .04em;
			text-transform: uppercase;
			color: #94a3b8;
		}
		.cr-meta-value { font-size: 14px; font-weight: 600; color: #1e293b; overflow-wrap: anywhere; }

		.cr-seal-wrap { padding: 0 20px 6px; overflow-x: auto; }
		.cr-seal-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.cr-seal-table th {
			text-align: left;
			padding: 8px 10px;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: #64748b;
			background: #f8fafc;
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-seal-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
		.cr-seal-no { font-weight: 700; }
		.cr-seal-dev { font-size: 11px; color: #94a3b8; }
		.cr-seal-loc { max-width: 260px; }
		.cr-seal-empty { text-align: center; color: #94a3b8; padding: 16px; }

		.cr-pill {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-pill--ok { background: #dcfce7; color: #166534; }
		.cr-pill--warn { background: #ffedd5; color: #9a3412; }
		.cr-pill--muted { background: #f1f5f9; color: #64748b; }

		.cr-batt { font-weight: 800; font-size: 13px; }
		.cr-batt--ok { color: #16a34a; }
		.cr-batt--mid { color: #ca8a04; }
		.cr-batt--low { color: #dc2626; }
		.cr-batt--muted { color: #94a3b8; }

		.cr-req-actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 20px;
			border-top: 1px solid #f1f5f9;
			background: #fcfdff;
		}
		.cr-req-actions-right { display: flex; gap: 8px; }
		.cr-act--reject { color: #b91c1c; border-color: #fecaca; }

		.cr-empty { text-align: center; padding: 56px 24px; color: #64748b; }
		.cr-empty-icon { font-size: 40px; margin-bottom: 12px; }
		.cr-empty h3 { margin: 0 0 6px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-empty p { margin: 0 auto; max-width: 460px; font-size: 14px; }

		.cr-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 56px; color: #64748b; font-weight: 600; }
		.cr-spinner {
			width: 22px; height: 22px;
			border: 3px solid #e2e8f0; border-top-color: #0284c7;
			border-radius: 50%;
			animation: cr-spin .7s linear infinite;
		}
		@keyframes cr-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .cr-panel,
		[data-theme="dark"] .cr-req { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .cr-tabs { background: #0f172a; border-color: #334155; }
		[data-theme="dark"] .cr-tab { background: #1e293b; border-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .cr-tab.active { background: #0284c7; color: #fff; border-color: #0284c7; }
		[data-theme="dark"] .cr-req-head { background: #0b3a52; border-color: #334155; }
		[data-theme="dark"] .cr-req-id, [data-theme="dark"] .cr-queue-head h3,
		[data-theme="dark"] .cr-empty h3 { color: #f8fafc; }
		[data-theme="dark"] .cr-req-client, [data-theme="dark"] .cr-meta-value,
		[data-theme="dark"] .cr-seal-table td { color: #e2e8f0; }
		[data-theme="dark"] .cr-seal-table th { background: #0f172a; color: #94a3b8; border-color: #334155; }
		[data-theme="dark"] .cr-seal-table td { border-color: #334155; }
		[data-theme="dark"] .cr-req-actions { background: #172033; border-color: #334155; }

		@media (max-width: 900px) { .cr-meta { grid-template-columns: repeat(2, minmax(0,1fr)); } }
		@media (max-width: 640px) {
			.cr-page { padding: 14px 8px 32px; }
			.cr-tab-body { padding: 14px; }
			.cr-meta { grid-template-columns: 1fr; }
			.cr-meta-item--wide { grid-column: span 1; }
			.cr-req-head { flex-direction: column; align-items: flex-start; }
			.cr-req-client { text-align: left; }
		}
	`;
	document.head.appendChild(style);
}
