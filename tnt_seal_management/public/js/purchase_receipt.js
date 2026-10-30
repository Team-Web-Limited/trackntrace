// Belongs To (PCB / RECTs) on each item row follows its Accepted Warehouse's Branch.
frappe.ui.form.on("Purchase Receipt Item", {
	warehouse(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.warehouse) {
			frappe.model.set_value(cdt, cdn, "custom_belongs_to", "");
			return;
		}
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.stock_seal_transfers.get_receipt_system",
			args: { warehouse: row.warehouse },
			callback: (r) => frappe.model.set_value(cdt, cdn, "custom_belongs_to", (r && r.message) || ""),
		});
	},
});
