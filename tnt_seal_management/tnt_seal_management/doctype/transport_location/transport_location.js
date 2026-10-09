// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Transport Location", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Suggest Uffizio Geofence"), () => suggest_geofence(frm), __("Geofence"));
	},
});

function suggest_geofence(frm) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.geofence_sync.get_geofence_suggestions",
		args: { transport_location: frm.doc.name },
		callback(r) {
			const rows = r.message || [];
			if (!rows.length) {
				frappe.msgprint(__("No geofence on Uffizio looks like {0}. Pick one manually in the Uffizio Geofence field.", [frm.doc.name]));
				return;
			}
			const d = new frappe.ui.Dialog({
				title: __("Geofences that may match {0}", [frm.doc.name]),
				fields: [
					{
						fieldname: "geofence",
						fieldtype: "Select",
						label: __("Geofence"),
						reqd: 1,
						options: rows.map((g) => ({
							value: g.name,
							label: `${g.geofence_name} — ${g.shape || ""}${g.geofence_group ? ", " + g.geofence_group : ""}${g.is_ours ? ", ours" : ""} (#${g.name})`,
						})),
						default: rows[0].name,
					},
				],
				primary_action_label: __("Link"),
				primary_action(values) {
					frm.set_value("uffizio_geofence", values.geofence).then(() => {
						d.hide();
						frm.save();
					});
				},
			});
			d.show();
		},
	});
}
