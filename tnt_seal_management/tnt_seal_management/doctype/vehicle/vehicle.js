frappe.ui.form.on("Vehicle", {
	refresh(frm) {
		if (frm.doc.registration_number && frm.doc.registration_number !== frm.doc.registration_number.toUpperCase()) {
			frm.set_value("registration_number", frm.doc.registration_number.toUpperCase());
		}
	},
});
