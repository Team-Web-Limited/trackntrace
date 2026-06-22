// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Seal Journey", {
	setup(frm) {
		frm.set_query("assigned_team_lead", () => ({
			query: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.pcb_team_leader_query",
		}));
		frm.set_query("assigned_technician", () => ({
			query: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.field_technician_query",
		}));
		frm.set_query("proposed_seal", () => ({
			filters: { current_status: "Available" },
		}));
		frm.set_query("assigned_seal", () => ({
			filters: { current_status: "Available" },
		}));
	},

	onload(frm) {
		_lock_pre_tagging_checklist(frm);
		_seed_pre_tagging_checklist(frm);
		_set_days_taken(frm);
	},

	refresh(frm) {
		frm.add_custom_button(__("Back"), () => {
			frappe.set_route("journey-monitoring");
		});

		_lock_pre_tagging_checklist(frm);
		_seed_pre_tagging_checklist(frm);
		_set_assigned_seal_from_proposed(frm);
		_set_days_taken(frm);
		if (!frm.is_new()) {
			_add_sync_location_button(frm);
			_render_lifecycle(frm);
			_add_source_doc_buttons(frm);
		}
		_inject_seal_journey_styles();
		_apply_tab_progress_state(frm);
	},

	proposed_seal(frm) {
		_set_assigned_seal_from_proposed(frm);
	},

	journey_start_date_time(frm) {
		_set_days_taken(frm);
	},

	completion_date_time(frm) {
		_set_days_taken(frm);
	},
});

// Ordered lifecycle milestones the seal moves through. Each of the 18 raw
// journey_status values maps to one of these for the top-of-form progress bar.
const LIFECYCLE_MILESTONES = [
	"Booking",
	"Assignment",
	"Tagging",
	"Ready",
	"In Transit",
	"Arrival",
	"Completed",
];

const STATUS_TO_MILESTONE = {
	"Draft": 0,
	"Pending Finance PCB Approval": 0,
	"Finance PCB Approved": 0,
	"Finance PCB Rejected": 0,
	"Team Lead Assigned": 1,
	"Technician Assigned": 1,
	"Pre-Tagging": 2,
	"Tagging Request Booked": 2,
	"Tagging In Progress": 2,
	"Tagged": 2,
	"Post-Tagging": 2,
	"Ready for Journey": 3,
	"In Transit": 4,
	"Arrived": 5,
	"Untagging In Progress": 5,
	"Untagged": 5,
	"Completed": 6,
};

const TERMINAL_NEGATIVE = {
	"Finance PCB Rejected": "Rejected",
	"Cancelled": "Cancelled",
};

function _render_lifecycle(frm) {
	frm.dashboard.reset();

	const style_id = "hide-headline-close";
	if (!document.getElementById(style_id)) {
		const style = document.createElement("style");
		style.id = style_id;
		style.textContent = '.form-headline .close, .form-headline .btn-close { display: none !important; }';
		document.head.appendChild(style);
	}

	const status = frm.doc.journey_status || "Draft";
	const negative = TERMINAL_NEGATIVE[status];
	const current = STATUS_TO_MILESTONE[status] != null ? STATUS_TO_MILESTONE[status] : 0;

	// Stage chips: completed = green, current = blue, future = grey.
	const chips = LIFECYCLE_MILESTONES.map((label, idx) => {
		let bg = "#d1d8dd", color = "#36414c"; // future / grey
		if (!negative && idx < current) { bg = "#28a745"; color = "#fff"; }
		else if (!negative && idx === current) { bg = "#2490ef"; color = "#fff"; }
		else if (negative && idx <= current) { bg = "#ff5858"; color = "#fff"; }
		return `<span style="display:inline-block;padding:3px 10px;margin:2px;border-radius:10px;
			font-size:11px;font-weight:600;background:${bg};color:${color};">${idx + 1}. ${__(label)}</span>`;
	}).join(" ");

	const headline = `<div style="line-height:2;">${chips}</div>
		<div style="margin-top:6px;font-size:12px;color:#8d99a6;">
			${__("Status")}: <b>${__(status)}</b></div>`;
	frm.dashboard.set_headline(headline);

	if (negative) {
		frm.dashboard.add_indicator(__(negative), "red");
	} else {
		const pct = Math.round(((current + 1) / LIFECYCLE_MILESTONES.length) * 100);
		frm.dashboard.add_progress(__("Seal Journey"), pct);
	}

	// Append the seal's current custodian/warehouse to the headline (async lookup).
	if (frm.doc.assigned_seal) {
		frappe.db.get_value("Seal Device", frm.doc.assigned_seal,
			["current_custody_label", "current_custody_since"]).then((r) => {
			const v = (r && r.message) || {};
			if (!v.current_custody_label) return;
			const since = v.current_custody_since
				? ` (${__("since")} ${frappe.datetime.str_to_user(v.current_custody_since)})` : "";
			const extra = `<div style="margin-top:2px;font-size:12px;color:#8d99a6;">
				${__("Custodian")}: <b>${frappe.utils.escape_html(v.current_custody_label)}</b>${since}</div>`;
			frm.dashboard.set_headline(headline + extra);
		});
	}
}

// One-click navigation to the source document the seal currently lives in:
// the deepest stage that exists wins (Journey Request > Assignment > Job Order > Booking).
function _add_source_doc_buttons(frm) {
	const targets = [
		["journey_request", "Journey Request", __("Open Journey Request")],
		["pcb_assignment", "PCB Assignment", __("Open PCB Assignment")],
		["pcb_job_order", "PCB Job Order", __("Open PCB Job Order")],
		["tagging_booking", "Tagging Booking", __("Open Tagging Booking")],
	];
	for (const [field, doctype, label] of targets) {
		if (frm.doc[field]) {
			frm.add_custom_button(label, () => {
				frappe.set_route("Form", doctype, frm.doc[field]);
			}, __("Open Source"));
		}
	}
}

function _set_assigned_seal_from_proposed(frm) {
	if (frm.doc.proposed_seal && !frm.doc.assigned_seal) {
		frm.set_value("assigned_seal", frm.doc.proposed_seal);
	}
}

function _set_days_taken(frm) {
	const start = frm.doc.journey_start_date_time;
	const completion = frm.doc.completion_date_time;

	if (!start || !completion) {
		if (frm.doc.days_taken) {
			frm.set_value("days_taken", 0);
		}
		return;
	}

	const startDate = frappe.datetime.str_to_obj(start);
	const completionDate = frappe.datetime.str_to_obj(completion);
	if (!startDate || !completionDate || completionDate < startDate) {
		frm.set_value("days_taken", 0);
		return;
	}

	const totalDays = (completionDate - startDate) / (1000 * 60 * 60 * 24);
	frm.set_value("days_taken", Number(totalDays.toFixed(2)));
}

function _lock_pre_tagging_checklist(frm) {
	frm.set_df_property("pre_tagging_checklist", "cannot_add_rows", true);
	frm.set_df_property("pre_tagging_checklist", "cannot_delete_rows", true);
	_hide_pre_tagging_checklist_row_check();
}

// Hide the grid's row-selection checkboxes (left column + select-all header) so the
// only checkbox in the Pre-Tagging Checklist is the "Completed" column. No bulk edit.
function _hide_pre_tagging_checklist_row_check() {
	const style_id = "hide-pre-tagging-checklist-row-check";
	if (document.getElementById(style_id)) return;

	const style = document.createElement("style");
	style.id = style_id;
	style.textContent =
		'[data-fieldname="pre_tagging_checklist"] .grid-row-check { visibility: hidden !important; }';
	document.head.appendChild(style);
}

function _seed_pre_tagging_checklist(frm) {
	if (!frm.is_new() || (frm.doc.pre_tagging_checklist || []).length) {
		return;
	}

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_pre_tagging_checklist_template",
		callback(r) {
			if (!frm.is_new() || (frm.doc.pre_tagging_checklist || []).length) {
				return;
			}

			(r.message || []).forEach((item) => {
				const row = frm.add_child("pre_tagging_checklist");
				row.checklist_item = item;
				row.completed = 0;
			});

			frm.refresh_field("pre_tagging_checklist");
		},
	});
}

function _add_sync_location_button(frm) {
	const allowed = ["System Manager", "Seal System Administrator", "Operations Control Room"];
	if (!allowed.some(r => frappe.user.has_role(r))) return;
	if (!frm.doc.assigned_seal) return;

	frm.add_custom_button(__("Sync Seal Location"), function () {
		frappe.show_progress(__("Syncing…"), 0, 100, __("Fetching data from Seal Server API…"));
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.seal_sync.manual_sync_seal_journey",
			args: { seal_journey_name: frm.doc.name },
			callback(r) {
				frappe.hide_progress();
				const res = r.message || {};
				if (res.status === "success") {
					frappe.show_alert({ message: __("Seal location updated"), indicator: "green" }, 6);
					frm.reload_doc();
				} else {
					frappe.msgprint({
						title: __("Sync Failed"),
						message: res.message || __("Unknown error — check Seal API Sync Log."),
						indicator: "red",
					});
				}
			},
			error() {
				frappe.hide_progress();
				frappe.msgprint({
					title: __("Sync Failed"),
					message: __("Unexpected error — check Seal API Sync Log for details."),
					indicator: "red",
				});
			},
		});
	}, __("Actions"));
}

// Minimum lifecycle milestone (see STATUS_TO_MILESTONE) each tab's data depends on.
// Tabs not listed (e.g. Journey Details, Logs and Attachments) always show their
// own data and are never marked "not yet".
const TAB_MILESTONES = {
	client_and_transport_details_tab: 0,
	approval_tab: 0,
	assignment_tab: 1,
	pre_tagging_tab: 2,
	seals_tab: 2,
	tagging_details_tab: 2,
	photo_evidence_tab: 2,
	post_tagging_tab: 2,
	billing_tab: 3,
	transit_tracking_tab: 4,
	arrival_tab: 5,
	seal_return_tab: 6,
};

// Grey out tabs the journey hasn't reached yet and show a "Not yet" banner
// instead of letting their fields render blank with no explanation.
function _apply_tab_progress_state(frm) {
	if (!frm.layout || !frm.layout.wrapper) return;

	const status = frm.doc.journey_status || "Draft";
	const current = STATUS_TO_MILESTONE[status] != null ? STATUS_TO_MILESTONE[status] : 0;
	const stalled = Boolean(TERMINAL_NEGATIVE[status]);

	Object.entries(TAB_MILESTONES).forEach(([tabname, milestone]) => {
		const $navLink = frm.layout.wrapper.find(`.nav-link[data-fieldname="${tabname}"]`);
		if (!$navLink.length) return;

		const $pane = frm.layout.wrapper.find($navLink.attr("href"));
		const notYet = milestone > current && !(stalled && milestone <= current);

		$navLink.toggleClass("sj-tab-not-yet", notYet);
		if (!$pane.length) return;

		$pane.find(".sj-tab-not-yet-banner").remove();
		if (notYet) {
			$pane.prepend(`
				<div class="sj-tab-not-yet-banner">
					${__("Not yet — the journey hasn't reached this stage. Current status: {0}", [__(status)])}
				</div>
			`);
		}
	});
}

function _inject_seal_journey_styles() {
	const style_id = "seal-journey-tab-progress-styles";
	if (document.getElementById(style_id)) return;

	const style = document.createElement("style");
	style.id = style_id;
	style.textContent = `
		.nav-link.sj-tab-not-yet {
			opacity: .55;
		}
		.sj-tab-not-yet-banner {
			margin: 0 0 14px;
			padding: 8px 12px;
			border-radius: 6px;
			background: #f3f4f6;
			color: #6b7280;
			font-size: 12px;
			border: 1px dashed #d1d5db;
		}
		[data-theme="dark"] .sj-tab-not-yet-banner {
			background: #1e293b;
			border-color: #334155;
			color: #94a3b8;
		}
	`;
	document.head.appendChild(style);
}
