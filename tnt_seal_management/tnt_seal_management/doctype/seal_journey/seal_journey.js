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
		_apply_arrival_field_locks(frm);
		if (!frm.is_new()) {
			_add_arrival_workflow_buttons(frm);
			_render_lifecycle(frm);
			_add_source_doc_buttons(frm);
		}
		_inject_seal_journey_styles();
		_render_approval_timeline(frm);
		_render_assignment_timeline(frm);
		_render_warehouse_timeline(frm);
		_apply_tab_progress_state(frm);
	},

	proposed_seal(frm) {
		_set_assigned_seal_from_proposed(frm);
	},

	journey_start_date_time(frm) {
		_set_days_taken(frm);
	},

	arrival_date_time(frm) {
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
	"Awaiting Seal Return": 5,
	"Awaiting Control Room Approval": 5,
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
		style.textContent = '.form-message-container .close-message { display: none !important; }';
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

// Mirrors SealJourney.set_days_taken() server-side so the form doesn't flash
// back to 0 on every load — falls back to arrival_date_time before
// completion_date_time is known, and keeps days_taken_display (hours, while
// the journey hasn't filled a full day yet) in sync alongside the decimal
// days_taken figure.
function _set_days_taken(frm) {
	const start = frm.doc.journey_start_date_time;
	const end = frm.doc.completion_date_time || frm.doc.arrival_date_time;

	if (!start || !end) {
		if (frm.doc.days_taken) frm.set_value("days_taken", 0);
		if (frm.doc.days_taken_display) frm.set_value("days_taken_display", "");
		return;
	}

	const startDate = frappe.datetime.str_to_obj(start);
	const endDate = frappe.datetime.str_to_obj(end);
	if (!startDate || !endDate || endDate < startDate) {
		frm.set_value("days_taken", 0);
		frm.set_value("days_taken_display", "");
		return;
	}

	const totalSeconds = (endDate - startDate) / 1000;
	frm.set_value("days_taken", Number((totalSeconds / 86400).toFixed(2)));
	frm.set_value("days_taken_display", _format_duration_client(totalSeconds));
}

function _format_duration_client(totalSeconds) {
	const hours = totalSeconds / 3600;
	if (hours < 24) {
		return `${hours.toFixed(1)} hrs`;
	}

	const days = Math.floor(hours / 24);
	const remainingHours = Number((hours % 24).toFixed(1));
	const dayLabel = days === 1 ? __("day") : __("days");
	return remainingHours > 0 ? `${days} ${dayLabel} ${remainingHours} hrs` : `${days} ${dayLabel}`;
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

const SJ_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.${name}`;

// Untagging Confirmation / Seal Unlocked Confirmation / Arrival Remarks are
// only hand-edited by Operations Control Room, and only while untagging is
// actually in progress — mirrors enforce_arrival_field_locks() server-side.
const SJ_ARRIVAL_CONFIRMATION_FIELDS = [
	"untagging_confirmation",
	"seal_unlocked_confirmation",
	"arrival_remarks",
];

function _apply_arrival_field_locks(frm) {
	const isAdmin = frappe.user.has_role("System Manager");
	const isControlRoom = frappe.user.has_role("Operations Control Room") || isAdmin;
	const unlocked = isAdmin || (isControlRoom && frm.doc.journey_status === "Untagging In Progress");

	for (const fieldname of SJ_ARRIVAL_CONFIRMATION_FIELDS) {
		frm.set_df_property(fieldname, "read_only", unlocked ? 0 : 1);
	}
}

function _add_arrival_workflow_buttons(frm) {
	const isAdmin = frappe.user.has_role("System Manager");
	const isControlRoom = frappe.user.has_role("Operations Control Room") || isAdmin;
	if (!isControlRoom) return;

	const status = frm.doc.journey_status;

	if (status === "Arrived") {
		frm.add_custom_button(__("Start Untagging"), () => {
			frappe.call({
				method: SJ_METHOD("start_untagging"),
				args: { docname: frm.doc.name },
				freeze: true,
				callback: () => frm.reload_doc(),
			});
		});
	}
}


function _render_warehouse_timeline(frm) {
	const field = frm.fields_dict.warehouse_timeline;
	if (!field || !field.$wrapper) return;

	const render = (sealDoc) => {
		const payload = _build_warehouse_timeline_payload(frm, sealDoc || {});
		field.$wrapper.html(_warehouse_timeline_html(frm, payload));
		_inject_approval_timeline_styles();
		_inject_warehouse_timeline_styles();
	};

	render(null);
	if (frm.doc.assigned_seal) {
		frappe.db.get_doc("Seal Device", frm.doc.assigned_seal).then(render).catch(() => render(null));
	}
}

function _build_warehouse_timeline_payload(frm, sealDoc) {
	const status = frm.doc.journey_status || "Draft";
	const current = STATUS_TO_MILESTONE[status] != null ? STATUS_TO_MILESTONE[status] : 0;
	const custodyHistory = (sealDoc.status_history || [])
		.filter((row) => _warehouse_history_belongs_to_journey(frm, row))
		.sort((a, b) => String(a.status_date_time || "").localeCompare(String(b.status_date_time || "")));

	const firstWarehouse = _first_warehouse_label(custodyHistory) || _current_warehouse_label(sealDoc);
	const returnWarehouse = _return_warehouse_label(custodyHistory) || _current_warehouse_label(sealDoc);
	const assignedAt = _history_time(custodyHistory, "Assigned via Journey Request") || frm.doc.technician_assignment_date_time;
	const returnedAt = _history_time(custodyHistory, "Returned via Journey Request") || frm.doc.completion_date_time;

	const stages = [
		{
			label: __("Warehouse Stock"),
			description: __("Seal starts in warehouse custody before dispatch"),
			kind: __("Place"),
			custodian: firstWarehouse,
			journey_status: __("Available / Quality Check"),
			date: sealDoc.date_received || sealDoc.current_custody_since,
			milestone: 0,
		},
		{
			label: __("PCB Job Order"),
			description: __("Operational work queue for the seal assignment"),
			kind: __("Work Queue"),
			custodian: frm.doc.pcb_job_order || frm.doc.sales_order_reference,
			journey_status: __("Team Lead Assigned"),
			date: frm.doc.team_lead_assignment_date_time,
			milestone: 1,
		},
		{
			label: __("PCB Team Lead"),
			description: __("Person accountable for assigning field execution"),
			kind: __("Person"),
			custodian: frm.doc.assigned_team_lead,
			journey_status: __("Team Lead Assigned"),
			date: frm.doc.team_lead_assignment_date_time,
			milestone: 1,
		},
		{
			label: __("Field Technician"),
			description: __("Person holding the seal through tagging and return"),
			kind: __("Person"),
			custodian: frm.doc.assigned_technician,
			journey_status: __("Technician Assigned / Tagging / Seal Return"),
			date: assignedAt,
			milestone: 2,
		},
		{
			label: __("Customer Journey"),
			description: __("Seal is attached to the customer movement"),
			kind: __("Customer / Container"),
			custodian: frm.doc.customer,
			place: [frm.doc.vehicle_plate_number, frm.doc.container_number].filter(Boolean).join(" / "),
			journey_status: __("In Transit"),
			date: frm.doc.journey_start_date_time,
			milestone: 4,
		},
		{
			label: __("Return Warehouse"),
			description: __("Seal returns to warehouse custody after Control Room approval"),
			kind: __("Place"),
			custodian: returnWarehouse || frm.doc.return_location,
			place: frm.doc.return_location,
			journey_status: __("Completed / Returned"),
			date: returnedAt,
			milestone: 6,
		},
	];

	stages.forEach((stage) => {
		if (stage.date || stage.custodian) stage.state = "approved";
		else if (stage.milestone <= current) stage.state = "current";
		else stage.state = "upcoming";
	});

	let latestIndex = stages.findIndex((stage) => stage.state === "current");
	if (latestIndex < 0) {
		latestIndex = stages.reduce((latest, stage, index) => (stage.state === "approved" ? index : latest), 0);
	}

	return { stages, latestIndex, custodyHistory };
}

function _warehouse_timeline_html(frm, payload) {
	const escape = (value) => frappe.utils.escape_html(String(value || ""));
	const stateLabels = {
		approved: __("Captured"),
		current: __("Current / pending"),
		upcoming: __("Not reached"),
	};
	const capturedCount = payload.stages.filter((stage) => stage.state === "approved").length;
	const steps = payload.stages.map((stage, index) => {
		const icon = stage.state === "approved" ? "✓" : index + 1;
		const date = stage.date ? frappe.datetime.str_to_user(stage.date) : "";
		const meta = [
			stage.kind ? `<span><i class="fa fa-tag"></i>${escape(stage.kind)}</span>` : "",
			stage.custodian ? `<span><i class="fa fa-user"></i>${escape(stage.custodian)}</span>` : "",
			stage.place ? `<span><i class="fa fa-map-marker"></i>${escape(stage.place)}</span>` : "",
			stage.journey_status ? `<span><i class="fa fa-road"></i>${escape(stage.journey_status)}</span>` : "",
			date ? `<span><i class="fa fa-clock-o"></i>${escape(date)}</span>` : "",
		].filter(Boolean).join("");
		const latest = index === payload.latestIndex ? `<span class="sj-approval-latest">${__("Latest")}</span>` : "";
		return `
			<div class="sj-approval-step sj-approval-${stage.state} ${index === payload.latestIndex ? "sj-approval-is-latest" : ""}">
				<div class="sj-approval-rail">
					<div class="sj-approval-circle">${icon}</div>
					${index < payload.stages.length - 1 ? `<div class="sj-approval-connector"></div>` : ""}
				</div>
				<div class="sj-approval-card">
					<div class="sj-approval-card-head">
						<div><strong>${escape(stage.label)}</strong><small>${escape(stage.description)}</small></div>
						<div>${latest}<span class="sj-approval-state">${escape(stateLabels[stage.state])}</span></div>
					</div>
					${meta ? `<div class="sj-approval-meta">${meta}</div>` : ""}
				</div>
			</div>`;
	}).join("");

	const history = _warehouse_history_html(payload.custodyHistory);
	return `
		<div class="sj-approval-shell sj-warehouse-shell">
			<div class="sj-approval-summary">
				<div><span>${__("Custody path")}</span><strong>${capturedCount} / ${payload.stages.length} ${__("captured")}</strong></div>
				<div class="sj-approval-current-status">${__("Journey status")}: <b>${escape(frm.doc.journey_status || "Draft")}</b></div>
			</div>
			<div class="sj-approval-stepper">${steps}</div>
			${history}
		</div>`;
}

function _warehouse_history_html(rows) {
	const escape = (value) => frappe.utils.escape_html(String(value || ""));
	if (!rows.length) {
		return `<div class="sj-warehouse-history sj-warehouse-empty">${__("No recorded seal custody handoffs found for this journey yet.")}</div>`;
	}
	const items = rows.map((row) => {
		const time = row.status_date_time ? frappe.datetime.str_to_user(row.status_date_time) : "";
		return `<div class="sj-warehouse-history-row">
			<div><strong>${escape(row.new_status || row.previous_status || __("Custody update"))}</strong><small>${escape(row.previous_status ? `${__("From")}: ${row.previous_status}` : "")}</small></div>
			<div class="sj-warehouse-history-meta">
				${time ? `<span><i class="fa fa-clock-o"></i>${escape(time)}</span>` : ""}
				${row.updated_by ? `<span><i class="fa fa-user"></i>${escape(row.updated_by)}</span>` : ""}
				${row.remarks ? `<span><i class="fa fa-comment-o"></i>${escape(row.remarks)}</span>` : ""}
			</div>
		</div>`;
	}).join("");
	return `<div class="sj-warehouse-history"><h4>${__("Recorded Custody Handoffs")}</h4>${items}</div>`;
}

function _warehouse_history_belongs_to_journey(frm, row) {
	const text = `${row.journey || ""} ${row.remarks || ""}`;
	return !frm.doc.name || text.includes(frm.doc.name) || row.journey === frm.doc.name;
}

function _first_warehouse_label(rows) {
	const row = rows.find((item) => String(item.previous_status || "").includes("Warehouse:"));
	return row ? row.previous_status : "";
}

function _return_warehouse_label(rows) {
	const reversed = [...rows].reverse();
	const row = reversed.find((item) => String(item.new_status || "").includes("Warehouse:"));
	return row ? row.new_status : "";
}

function _current_warehouse_label(sealDoc) {
	return sealDoc.current_custody_type === "Custody Point" ? sealDoc.current_custody_label : "";
}

function _history_time(rows, marker) {
	const row = rows.find((item) => String(item.remarks || "").includes(marker));
	return row && row.status_date_time;
}

function _inject_warehouse_timeline_styles() {
	const styleId = "seal-journey-warehouse-timeline-styles";
	if (document.getElementById(styleId)) return;
	const style = document.createElement("style");
	style.id = styleId;
	style.textContent = `
		.sj-warehouse-history { margin-top: 18px; padding: 14px 16px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--fg-color); }
		.sj-warehouse-history h4 { margin: 0 0 12px; color: var(--heading-color); font-size: 14px; font-weight: 800; }
		.sj-warehouse-history-row { padding: 11px 0; border-top: 1px solid var(--border-color); }
		.sj-warehouse-history-row:first-of-type { border-top: 0; }
		.sj-warehouse-history-row strong { display: block; color: var(--heading-color); font-size: 13px; }
		.sj-warehouse-history-row small { display: block; margin-top: 3px; color: var(--text-muted); font-size: 11px; }
		.sj-warehouse-history-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 7px; color: var(--text-muted); font-size: 11px; }
		.sj-warehouse-history-meta span { display: inline-flex; align-items: center; gap: 5px; }
		.sj-warehouse-empty { color: var(--text-muted); font-size: 12px; }
	`;
	document.head.appendChild(style);
}


function _render_assignment_timeline(frm) {
	const field = frm.fields_dict.assignment_timeline;
	if (!field || !field.$wrapper) return;

	const financeApproved = frm.doc.finance_pcb_approval_status === "Approved";
	const teamLeadState = frm.doc.assigned_team_lead
		? "approved"
		: financeApproved
			? "current"
			: "upcoming";
	const technicianState = frm.doc.assigned_technician
		? "approved"
		: frm.doc.assigned_team_lead
			? "current"
			: "upcoming";

	const stages = [
		{
			label: __("PCB Team Lead"),
			description: __("Finance PCB assigns operational ownership"),
			state: teamLeadState,
			assignee: frm.doc.assigned_team_lead,
			date: frm.doc.team_lead_assignment_date_time,
		},
		{
			label: __("Field Technician"),
			description: __("Team lead assigns field execution"),
			state: technicianState,
			assignee: frm.doc.assigned_technician,
			date: frm.doc.technician_assignment_date_time,
			secondary: frm.doc.technician_status
				? `${__("Technician status")}: ${__(frm.doc.technician_status)}`
				: "",
		},
	];

	let latestIndex = stages.findIndex((stage) => stage.state === "current");
	if (latestIndex < 0) {
		latestIndex = stages.reduce(
			(latest, stage, index) => (stage.state === "approved" ? index : latest),
			0
		);
	}

	const stateLabels = {
		approved: __("Assigned"),
		current: __("Awaiting assignment"),
		upcoming: __("Not reached"),
	};
	const escape = (value) => frappe.utils.escape_html(String(value || ""));
	const assignedCount = stages.filter((stage) => stage.state === "approved").length;

	const steps = stages
		.map((stage, index) => {
			const icon = stage.state === "approved" ? "✓" : index + 1;
			const date = stage.date ? frappe.datetime.str_to_user(stage.date) : "";
			const meta = [
				stage.assignee
					? `<span><i class="fa fa-user"></i>${escape(stage.assignee)}</span>`
					: "",
				date ? `<span><i class="fa fa-clock-o"></i>${escape(date)}</span>` : "",
				stage.secondary
					? `<span><i class="fa fa-info-circle"></i>${escape(stage.secondary)}</span>`
					: "",
			]
				.filter(Boolean)
				.join("");
			const latest = index === latestIndex ? `<span class="sj-approval-latest">${__("Latest")}</span>` : "";

			return `
				<div class="sj-approval-step sj-approval-${stage.state} ${index === latestIndex ? "sj-approval-is-latest" : ""}">
					<div class="sj-approval-rail">
						<div class="sj-approval-circle">${icon}</div>
						${index < stages.length - 1 ? `<div class="sj-approval-connector"></div>` : ""}
					</div>
					<div class="sj-approval-card">
						<div class="sj-approval-card-head">
							<div><strong>${escape(stage.label)}</strong><small>${escape(stage.description)}</small></div>
							<div>${latest}<span class="sj-approval-state">${escape(stateLabels[stage.state])}</span></div>
						</div>
						${meta ? `<div class="sj-approval-meta">${meta}</div>` : ""}
					</div>
				</div>`;
		})
		.join("");

	field.$wrapper.html(`
		<div class="sj-approval-shell">
			<div class="sj-approval-summary">
				<div><span>${__("Assignment path")}</span><strong>${assignedCount} / ${stages.length} ${__("assigned")}</strong></div>
				<div class="sj-approval-current-status">${__("Journey status")}: <b>${escape(frm.doc.journey_status || "Draft")}</b></div>
			</div>
			<div class="sj-approval-stepper">${steps}</div>
		</div>
	`);

	[
		"assigned_team_lead",
		"team_lead_assignment_date_time",
		"assigned_technician",
		"technician_assignment_date_time",
		"technician_status",
	].forEach((fieldname) => frm.toggle_display(fieldname, false));

	_inject_approval_timeline_styles();
}

const CONTROL_ROOM_APPROVED_STATUSES = new Set([
	"Tagging Request Booked",
	"Tagging In Progress",
	"Tagged",
	"Post-Tagging",
	"Ready for Journey",
	"In Transit",
	"Arrived",
	"Untagging In Progress",
	"Untagged",
	"Completed",
]);

const CUSTOMER_CARE_APPROVED_STATUSES = new Set([
	"Ready for Journey",
	"In Transit",
	"Arrived",
	"Untagging In Progress",
	"Untagged",
	"Completed",
]);

function _render_approval_timeline(frm) {
	const field = frm.fields_dict.approval_timeline;
	if (!field || !field.$wrapper) return;

	const status = frm.doc.journey_status || "Draft";
	const financeStatus = frm.doc.finance_pcb_approval_status || "Pending";
	const financeState =
		financeStatus === "Approved"
			? "approved"
			: financeStatus === "Rejected"
				? "rejected"
				: "current";

	const hasControlRoomDecision = Boolean(
		frm.doc.control_room_approver || frm.doc.control_room_approval_date_time
	);
	let controlRoomState = "upcoming";
	if (financeState === "approved") {
		if (CONTROL_ROOM_APPROVED_STATUSES.has(status)) controlRoomState = "approved";
		else if (hasControlRoomDecision) controlRoomState = "rejected";
		else if (status === "Pre-Tagging") controlRoomState = "current";
	}

	const hasCustomerCareDecision = Boolean(
		frm.doc.customer_care_approver || frm.doc.customer_care_approval_date_time
	);
	let customerCareState = "upcoming";
	if (controlRoomState === "approved") {
		if (CUSTOMER_CARE_APPROVED_STATUSES.has(status)) customerCareState = "approved";
		else if (hasCustomerCareDecision) customerCareState = "rejected";
		else if (["Tagged", "Post-Tagging"].includes(status)) customerCareState = "current";
	}

	const stages = [
		{
			label: __("Finance PCB"),
			description: __("Booking and commercial approval"),
			state: financeState,
			approver: frm.doc.finance_pcb_approver,
			date: frm.doc.finance_pcb_approval_date_time,
			remarks: frm.doc.finance_pcb_remarks,
		},
		{
			label: __("Operations Control Room"),
			description: __("Seal readiness and tagging approval"),
			state: controlRoomState,
			approver: frm.doc.control_room_approver,
			date: frm.doc.control_room_approval_date_time,
			remarks: frm.doc.control_room_remarks,
		},
		{
			label: __("Customer Care"),
			description: __("Final journey release approval"),
			state: customerCareState,
			approver: frm.doc.customer_care_approver,
			date: frm.doc.customer_care_approval_date_time,
			remarks: frm.doc.customer_care_remarks,
		},
	];

	let latestIndex = stages.findIndex((stage) => ["current", "rejected"].includes(stage.state));
	if (latestIndex < 0) {
		latestIndex = stages.reduce(
			(latest, stage, index) => (stage.state === "approved" ? index : latest),
			0
		);
	}

	const stateLabels = {
		approved: __("Approved"),
		rejected: __("Rejected"),
		current: __("Awaiting approval"),
		upcoming: __("Not reached"),
	};
	const escape = (value) => frappe.utils.escape_html(String(value || ""));
	const approvedCount = stages.filter((stage) => stage.state === "approved").length;

	const steps = stages
		.map((stage, index) => {
			const icon = stage.state === "approved" ? "✓" : stage.state === "rejected" ? "!" : index + 1;
			const date = stage.date ? frappe.datetime.str_to_user(stage.date) : "";
			const meta = [
				stage.approver
					? `<span><i class="fa fa-user"></i>${escape(stage.approver)}</span>`
					: "",
				date ? `<span><i class="fa fa-clock-o"></i>${escape(date)}</span>` : "",
			]
				.filter(Boolean)
				.join("");
			const remarks = stage.remarks
				? `<div class="sj-approval-remarks">${escape(stage.remarks)}</div>`
				: "";
			const latest = index === latestIndex ? `<span class="sj-approval-latest">${__("Latest")}</span>` : "";

			return `
				<div class="sj-approval-step sj-approval-${stage.state} ${index === latestIndex ? "sj-approval-is-latest" : ""}">
					<div class="sj-approval-rail">
						<div class="sj-approval-circle">${icon}</div>
						${index < stages.length - 1 ? `<div class="sj-approval-connector"></div>` : ""}
					</div>
					<div class="sj-approval-card">
						<div class="sj-approval-card-head">
							<div><strong>${escape(stage.label)}</strong><small>${escape(stage.description)}</small></div>
							<div>${latest}<span class="sj-approval-state">${escape(stateLabels[stage.state])}</span></div>
						</div>
						${meta ? `<div class="sj-approval-meta">${meta}</div>` : ""}
						${remarks}
					</div>
				</div>`;
		})
		.join("");

	field.$wrapper.html(`
		<div class="sj-approval-shell">
			<div class="sj-approval-summary">
				<div><span>${__("Approval path")}</span><strong>${approvedCount} / ${stages.length} ${__("approved")}</strong></div>
				<div class="sj-approval-current-status">${__("Journey status")}: <b>${escape(status)}</b></div>
			</div>
			<div class="sj-approval-stepper">${steps}</div>
		</div>
	`);

	[
		"finance_pcb_approval_status",
		"finance_pcb_approver",
		"finance_pcb_approval_date_time",
		"finance_pcb_remarks",
		"customer_care_section",
		"customer_care_approver",
		"customer_care_approval_date_time",
		"customer_care_remarks",
	].forEach((fieldname) => frm.toggle_display(fieldname, false));

	_inject_approval_timeline_styles();
}

function _inject_approval_timeline_styles() {
	const styleId = "seal-journey-approval-timeline-styles";
	if (document.getElementById(styleId)) return;

	const style = document.createElement("style");
	style.id = styleId;
	style.textContent = `
		.sj-approval-shell { max-width: 920px; padding: 6px 4px 24px; }
		.sj-approval-summary { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:20px; padding:16px 18px; border:1px solid var(--border-color); border-radius:14px; background:linear-gradient(135deg, var(--fg-color) 0%, var(--control-bg) 100%); }
		.sj-approval-summary span { display:block; color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; font-weight:700; }
		.sj-approval-summary strong { display:block; margin-top:2px; font-size:18px; color:var(--heading-color); }
		.sj-approval-current-status { color:var(--text-muted); font-size:12px; text-align:right; }
		.sj-approval-step { display:grid; grid-template-columns:48px minmax(0, 1fr); gap:12px; min-height:116px; }
		.sj-approval-rail { position:relative; display:flex; justify-content:center; }
		.sj-approval-circle { position:relative; z-index:2; width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #cbd5e1; background:var(--fg-color); color:#94a3b8; font-size:14px; font-weight:800; transition:all .2s ease; }
		.sj-approval-connector { position:absolute; top:38px; bottom:0; width:2px; background:#e2e8f0; }
		.sj-approval-card { align-self:start; margin-bottom:16px; padding:15px 17px; border:1px solid var(--border-color); border-radius:12px; background:var(--fg-color); box-shadow:0 2px 8px rgba(15, 23, 42, .04); }
		.sj-approval-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
		.sj-approval-card-head strong { display:block; color:var(--heading-color); font-size:14px; }
		.sj-approval-card-head small { display:block; margin-top:3px; color:var(--text-muted); font-size:11px; }
		.sj-approval-state, .sj-approval-latest { display:inline-block; padding:3px 8px; border-radius:999px; background:var(--control-bg); color:var(--text-muted); font-size:10px; font-weight:700; white-space:nowrap; }
		.sj-approval-latest { margin-right:6px; background:#dbeafe; color:#1d4ed8; }
		.sj-approval-meta { display:flex; flex-wrap:wrap; gap:12px; margin-top:11px; color:var(--text-muted); font-size:11px; }
		.sj-approval-meta span { display:inline-flex; align-items:center; gap:5px; }
		.sj-approval-remarks { margin-top:10px; padding:8px 10px; border-left:3px solid #cbd5e1; border-radius:4px; background:var(--control-bg); color:var(--text-color); font-size:11px; }
		.sj-approval-approved .sj-approval-circle { border-color:#16a34a; background:#16a34a; color:#fff; }
		.sj-approval-approved .sj-approval-connector { background:#86efac; }
		.sj-approval-approved .sj-approval-state { background:#dcfce7; color:#166534; }
		.sj-approval-current .sj-approval-circle { border-color:#2563eb; background:#2563eb; color:#fff; box-shadow:0 0 0 5px rgba(37, 99, 235, .13); }
		.sj-approval-current .sj-approval-card { border-color:#93c5fd; }
		.sj-approval-current .sj-approval-state { background:#dbeafe; color:#1d4ed8; }
		.sj-approval-rejected .sj-approval-circle { border-color:#dc2626; background:#dc2626; color:#fff; box-shadow:0 0 0 5px rgba(220, 38, 38, .11); }
		.sj-approval-rejected .sj-approval-card { border-color:#fca5a5; }
		.sj-approval-rejected .sj-approval-state { background:#fee2e2; color:#991b1b; }
		@media (max-width: 600px) { .sj-approval-summary { align-items:flex-start; flex-direction:column; } .sj-approval-current-status { text-align:left; } .sj-approval-card-head { flex-direction:column; } }
	`;
	document.head.appendChild(style);
}

// Minimum lifecycle milestone (see STATUS_TO_MILESTONE) each tab's data depends on.
// Tabs not listed (e.g. Journey Details, Logs and Attachments) always show their
// own data and are never marked "not yet".
const TAB_MILESTONES = {
	client_and_transport_details_tab: 0,
	approval_tab: 0,
	warehouse_tab: 0,
	assignment_tab: 1,
	pre_tagging_tab: 2,
	tagging_details_tab: 2,
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
