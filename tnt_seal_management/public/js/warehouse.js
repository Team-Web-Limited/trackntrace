// Seals currently held by this ERPNext Warehouse (renderer lives in
// tnt_seal_management.js).
frappe.ui.form.on("Warehouse", {
	refresh(frm) {
		window.tnt_render_custody_seals(frm, "Warehouse", __("Seals in this Warehouse"));
	},
});
