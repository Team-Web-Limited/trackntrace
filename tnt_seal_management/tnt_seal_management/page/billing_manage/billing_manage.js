// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt
//
// Per-journey finance management — a basic view for Finance PCB to review a
// single journey's billing and settle it (Mark Billed). More detail later.
// Route: #billing-manage/<seal-journey-name>

frappe.pages["billing-manage"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Manage Billing"),
		single_column: true,
	});

	page.add_inner_button(__("Back to Follow-up"), () => frappe.set_route("billing-followup-list"));
	page.add_inner_button(__("Open Journey"), () => {
		if (page.bm_name) frappe.set_route("Form", "Seal Journey", page.bm_name);
	});

	_bm_inject_styles();
	page.bm_body = $('<div class="bm-page"></div>').appendTo(page.body);

	// Re-render whenever the route changes to a different journey.
	frappe.pages["billing-manage"].on_page_show = () => _bm_load(page);
	_bm_load(page);
};

const BM_GET = "tnt_seal_management.tnt_seal_management.api.billing_followup.get_billing_detail";
const BM_SETTLE =
	"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.mark_journey_billed";

function _bm_load(page) {
	const route = frappe.get_route();
	const name = route && route[1];
	page.bm_name = name;

	if (!name) {
		page.bm_body.html(`<div class="bm-empty">${__("No journey selected. Pick one from Billing Follow-up.")}</div>`);
		return;
	}

	page.bm_body.html(`<div class="bm-loading"><div class="bm-spinner"></div></div>`);
	frappe.call({
		method: BM_GET,
		args: { name },
		callback(r) {
			if (!r.message) {
				page.bm_body.html(`<div class="bm-empty">${__("Journey not found.")}</div>`);
				return;
			}
			_bm_render(page, r.message);
		},
		error() {
			page.bm_body.html(`<div class="bm-empty">${__("Could not load billing detail.")}</div>`);
		},
	});
}

function _bm_render(page, j) {
	page.set_title(__("Billing — {0}", [j.name]));
	const isAdmin = frappe.user.has_role("System Manager");
	const isFinance = frappe.user.has_role("Finance PCB") || isAdmin;
	const settled = j.billing_status === "Billed";

	const money = (v) => format_currency(v || 0);
	const date = (v) => (v ? frappe.datetime.str_to_user(v) : "—");
	const dateOnly = (v) => (v ? frappe.datetime.str_to_user(v).split(" ")[0] : "—");

	const statusClass = settled
		? "bm-badge--billed"
		: j.billing_status === "Pending Billing"
		? "bm-badge--pending"
		: "bm-badge--muted";

	page.bm_body.html(`
		<div class="bm-head">
			<div>
				<div class="bm-journey">${frappe.utils.escape_html(j.name)}</div>
				<div class="bm-customer">${frappe.utils.escape_html(j.customer || "—")}</div>
			</div>
			<span class="bm-badge ${statusClass}">${frappe.utils.escape_html(j.billing_status || __("Not Billed"))}</span>
		</div>

		<div class="bm-grid">
			<div class="bm-card">
				<h4>${__("Charge")}</h4>
				<div class="bm-total">${money(j.total_charge)}</div>
				<div class="bm-rows">
					${_bm_row(__("Billing Rule"), j.billing_rule || "—")}
					${_bm_row(__("Billable Days"), cint(j.billable_days))}
					${_bm_row(__("First Period"), `${cint(j.first_period_days)} ${__("days")} · ${money(j.first_period_amount)}`)}
					${_bm_row(__("Extra Days"), `${cint(j.extra_days)} × ${money(j.extra_day_rate)} = ${money(j.extra_day_amount)}`)}
				</div>
			</div>

			<div class="bm-card">
				<h4>${__("Journey")}</h4>
				<div class="bm-rows">
					${_bm_row(__("Route"), `${frappe.utils.escape_html(j.origin || "—")} → ${frappe.utils.escape_html(j.destination || "—")}`)}
					${_bm_row(__("Vehicle / Container"), `${frappe.utils.escape_html(j.vehicle_plate_number || "—")} / ${frappe.utils.escape_html(j.container_number || "—")}`)}
					${_bm_row(__("Seal"), frappe.utils.escape_html(j.assigned_seal || "—"))}
					${_bm_row(__("Billing Period"), `${dateOnly(j.billing_start_date)} → ${dateOnly(j.billing_return_date)}`)}
					${_bm_row(__("Completed"), date(j.completion_date_time))}
				</div>
			</div>

			<div class="bm-card">
				<h4>${__("Settlement")}</h4>
				<div class="bm-rows">
					${_bm_row(__("Status"), frappe.utils.escape_html(j.billing_status || __("Not Billed")))}
					${_bm_row(__("Invoice Reference"), frappe.utils.escape_html(j.invoice_reference || "—"))}
					${_bm_row(__("Billed By"), frappe.utils.escape_html(j.billed_by || "—"))}
					${_bm_row(__("Billed On"), date(j.billed_date_time))}
				</div>
				<div class="bm-actions">
					${
						isFinance && j.billing_status === "Pending Billing"
							? `<button class="bm-settle btn btn-primary">${__("Mark Billed")}</button>`
							: settled
							? `<span class="bm-settled-note">✓ ${__("Settled")}</span>`
							: ""
					}
				</div>
			</div>
		</div>
	`);

	page.bm_body.find(".bm-settle").on("click", () => _bm_settle(page, j));
}

function _bm_row(label, value) {
	return `<div class="bm-row"><span class="bm-row-label">${label}</span><span class="bm-row-value">${value}</span></div>`;
}

function _bm_settle(page, j) {
	frappe.prompt(
		[
			{
				fieldname: "invoice_reference",
				fieldtype: "Data",
				label: __("Invoice Reference"),
				default: j.invoice_reference || "",
			},
		],
		(values) => {
			frappe.call({
				method: BM_SETTLE,
				args: { docname: j.name, invoice_reference: values.invoice_reference || null },
				freeze: true,
				freeze_message: __("Settling billing…"),
				callback() {
					frappe.show_alert({ message: __("Billing settled"), indicator: "green" }, 5);
					_bm_load(page);
				},
			});
		},
		__("Mark {0} Billed", [j.name]),
		__("Mark Billed")
	);
}

function _bm_inject_styles() {
	const id = "billing-manage-styles";
	if (document.getElementById(id)) return;
	const style = document.createElement("style");
	style.id = id;
	style.textContent = `
		.bm-page { padding: 8px 4px 40px; }
		.bm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
		.bm-journey { font-size: 20px; font-weight: 800; color: var(--heading-color,#0f172a); }
		.bm-customer { color: var(--text-muted,#64748b); margin-top: 2px; }
		.bm-badge { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
		.bm-badge--pending { background: rgba(234,179,8,0.16); color: #92400e; }
		.bm-badge--billed { background: rgba(16,185,129,0.16); color: #065f46; }
		.bm-badge--muted { background: rgba(100,116,139,0.14); color: #475569; }
		.bm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
		.bm-card { background: var(--card-bg,#fff); border: 1px solid var(--border-color,#e2e8f0); border-radius: 14px;
			padding: 18px 20px; box-shadow: 0 4px 12px rgba(15,23,42,0.04); }
		.bm-card h4 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted,#64748b); }
		.bm-total { font-size: 28px; font-weight: 800; color: var(--heading-color,#0f172a); margin-bottom: 14px; }
		.bm-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-color,#f1f5f9); }
		.bm-row:last-child { border-bottom: 0; }
		.bm-row-label { color: var(--text-muted,#64748b); font-size: 12px; }
		.bm-row-value { font-weight: 600; text-align: right; }
		.bm-actions { margin-top: 16px; }
		.bm-settled-note { color: #065f46; font-weight: 700; }
		.bm-empty { text-align: center; padding: 48px 20px; color: var(--text-muted,#64748b); }
		.bm-loading { text-align: center; padding: 40px; }
		.bm-spinner { width: 28px; height: 28px; border: 3px solid rgba(13,148,136,0.25); border-top-color: #0d9488;
			border-radius: 50%; animation: bm-spin 0.8s linear infinite; margin: 0 auto; }
		@keyframes bm-spin { to { transform: rotate(360deg); } }
	`;
	document.head.appendChild(style);
}
