// Track Serial Numbers: ERPNext won't tick Has Serial No once the item is on a
// submitted document (Purchase Invoices too); a stock manager can still turn it
// on here while the item has never moved in stock (see api/serial_tracking.py).
const SERIAL_TRACKING_API = "tnt_seal_management.tnt_seal_management.api.serial_tracking";

frappe.ui.form.on("Item", {
	refresh(frm) {
		if (frm.is_new() || frm.doc.has_serial_no || !frm.doc.is_stock_item) return;
		frappe.call({ method: `${SERIAL_TRACKING_API}.get_serial_tracking_state`, args: { item_code: frm.doc.name } }).then(({ message: s }) => {
			if (!s || !s.can_enable || s.stock_moved || frm.doc.has_serial_no) return;
			frm.add_custom_button(__("Track Serial Numbers"), () => {
				frappe.confirm(
					__("Turn on serial number tracking for {0}? Every receipt of it will then need its serial numbers.", [frm.doc.name]),
					() =>
						frappe
							.call({ method: `${SERIAL_TRACKING_API}.enable_serial_tracking`, args: { item_code: frm.doc.name }, freeze: true })
							.then(() => {
								frappe.show_alert({ message: __("Serial tracking is on for {0}.", [frm.doc.name]), indicator: "green" });
								frm.reload_doc();
							})
				);
			});
		});
	},
});
