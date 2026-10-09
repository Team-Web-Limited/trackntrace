// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Custody Point", {
	refresh(frm) {
		frm.add_custom_button(__("Back"), () => {
			frappe.set_route("warehouse-list");
		});

		window.tnt_render_custody_seals(frm, "Custody Point", __("Seals at this Location"));
	},
});
