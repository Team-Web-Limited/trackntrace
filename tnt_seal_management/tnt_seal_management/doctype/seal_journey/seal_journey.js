// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Seal Journey", {
	setup(frm) {
		frm.set_query("assigned_team_lead", () => ({
			query: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.team_lead_technician_query",
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

	refresh(frm) {
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
