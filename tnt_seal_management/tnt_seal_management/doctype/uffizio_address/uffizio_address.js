// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Uffizio Address", {
	refresh(frm) {
		if (frm.is_new() || frm.doc.transport_location) return;
		frm.add_custom_button(__("Create Transport Location"), () => {
			frappe.prompt(
				[
					{ fieldname: "location_role", fieldtype: "Select", label: __("Role"), options: "Checkpoint\nTerminal", default: "Checkpoint", reqd: 1 },
					{ fieldname: "country", fieldtype: "Select", label: __("Country"), options: "Kenya\nUganda\nTanzania\nDR Congo\nRwanda\nBurundi\nEthiopia\nSouth Sudan", default: "Kenya", reqd: 1 },
					{ fieldname: "location_type", fieldtype: "Select", label: __("Type"), options: "Port\nInland Container Depot\nBorder Post\nCity/Town\nWeighbridge\nDepot/Warehouse", default: "Depot/Warehouse", reqd: 1 },
				],
				(values) => {
					frappe.call({
						method: "tnt_seal_management.tnt_seal_management.doctype.uffizio_address.uffizio_address.create_transport_location",
						args: { address: frm.doc.name, ...values },
						freeze: true,
						callback: () => frm.reload_doc(),
					});
				},
				__("Create Transport Location named {0}", [frm.doc.address_name]),
				__("Create")
			);
		});
	},
});
