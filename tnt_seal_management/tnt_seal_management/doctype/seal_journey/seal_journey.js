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
			filters: {
				current_status: "Available",
			},
		}));
		frm.set_query("assigned_seal", () => ({
			filters: {
				current_status: "Available",
			},
		}));
	},
	refresh(frm) {
		set_assigned_seal_from_proposed(frm);
	},
	proposed_seal(frm) {
		set_assigned_seal_from_proposed(frm);
	},
});

function set_assigned_seal_from_proposed(frm) {
	if (frm.doc.proposed_seal && !frm.doc.assigned_seal) {
		frm.set_value("assigned_seal", frm.doc.proposed_seal);
	}
}
