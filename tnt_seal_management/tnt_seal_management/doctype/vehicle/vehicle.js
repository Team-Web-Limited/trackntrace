frappe.ui.form.on("Vehicle", {
	refresh(frm) {
		// Legacy party_type/party_name custom fields (where present) are filled
		// from Customer (Owner) on save — see Vehicle._sync_legacy_party.
		["party_type", "party_name"].forEach((fieldname) => {
			if (!frm.fields_dict[fieldname]) return;
			frm.set_df_property(fieldname, "reqd", 0);
			frm.set_df_property(fieldname, "read_only", 1);
		});
		if (frm.doc.registration_number && frm.doc.registration_number !== frm.doc.registration_number.toUpperCase()) {
			frm.set_value("registration_number", frm.doc.registration_number.toUpperCase());
		}
	},
});
