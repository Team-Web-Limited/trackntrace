// Branch checkboxes on Warehouse (same as Customer): "All" ticks / unticks every
// branch, and the box follows the three branches (all ticked = All).
const WAREHOUSE_BRANCH_FIELDS = ["custom_division_fms", "custom_division_ects", "custom_division_rects"];

function wh_sync_all_branches(frm) {
	const all = WAREHOUSE_BRANCH_FIELDS.every((f) => frm.doc[f]);
	if (!!frm.doc.custom_division_all !== all) frm.set_value("custom_division_all", all ? 1 : 0);
}

// Seals currently held by this ERPNext Warehouse (renderer lives in
// tnt_seal_management.js).
frappe.ui.form.on("Warehouse", {
	custom_division_all(frm) {
		const all = frm.doc.custom_division_all ? 1 : 0;
		if (all || WAREHOUSE_BRANCH_FIELDS.every((f) => frm.doc[f])) {
			WAREHOUSE_BRANCH_FIELDS.forEach((f) => frm.set_value(f, all));
		}
	},
	custom_division_fms: wh_sync_all_branches,
	custom_division_ects: wh_sync_all_branches,
	custom_division_rects: wh_sync_all_branches,
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
