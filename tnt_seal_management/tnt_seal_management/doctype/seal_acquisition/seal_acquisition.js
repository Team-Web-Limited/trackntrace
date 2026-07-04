frappe.ui.form.on("Seal Acquisition", {
	setup(frm) {
		// Only offer real (leaf, active) warehouses as the receiving warehouse.
		frm.set_query("target_warehouse", () => ({
			filters: { is_group: 0, disabled: 0 },
		}));
	},
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("View Seal Devices"), () => {
				frappe.set_route("List", "Seal Device", {
					acquisition_reference: frm.doc.name,
				});
			});
		}
	},
});
