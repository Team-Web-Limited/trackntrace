// Seals currently held by this ERPNext Warehouse (renderer lives in
// tnt_seal_management.js).
frappe.ui.form.on("Warehouse", {
	refresh(frm) {
		window.tnt_render_custody_seals(frm, "Warehouse", __("Seals in this Warehouse"));
		if (frm.is_new()) return;
		// Read-only count of seal serials ERPNext has in stock here (was a column
		// on the Warehouses page); set on the doc directly so the form isn't dirtied.
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.seal_warehouses.get_warehouse_stock_count",
			args: { warehouse: frm.doc.name },
			callback(r) {
				frm.doc.custom_seals_in_stock = (r && r.message) || 0;
				frm.refresh_field("custom_seals_in_stock");
			},
		});
	},
});
