frappe.ui.form.on("Seal Acquisition", {
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
