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
	},

	refresh(frm) {
		_lock_pre_tagging_checklist(frm);
		_seed_pre_tagging_checklist(frm);
		_set_assigned_seal_from_proposed(frm);
		if (!frm.is_new()) {
			_add_sync_location_button(frm);
		}
	},

	proposed_seal(frm) {
		_set_assigned_seal_from_proposed(frm);
	},
});

function _set_assigned_seal_from_proposed(frm) {
	if (frm.doc.proposed_seal && !frm.doc.assigned_seal) {
		frm.set_value("assigned_seal", frm.doc.proposed_seal);
	}
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
