frappe.ui.form.on("Seal Stock Transfer", {
	setup(frm) {
		frm.set_query("seal_device", "seals", () => ({
			filters: {
				current_status: ["in", ["Available", "Returned", "Quality Check", "Untagged"]],
				current_custody_type: "Custody Point",
				current_custodian: frm.doc.source_warehouse || "",
			},
		}));
	},

	refresh(frm) {
		if (frm.doc.docstatus === 1 && frm.doc.transfer_status === "In Transit") {
			frm.add_custom_button(__("Receive Transfer"), () => {
				frappe.confirm(__("Receive these seals into {0}?", [frm.doc.target_warehouse]), () => {
					frappe.call({
						method: "tnt_seal_management.tnt_seal_management.doctype.seal_stock_transfer.seal_stock_transfer.receive_transfer",
						args: { docname: frm.doc.name },
						callback() {
							frappe.show_alert({ message: __("Transfer received"), indicator: "green" });
							frm.reload_doc();
						},
					});
				});
			}).addClass("btn-primary");
		}
	},
});
