// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Seal Device", {
	refresh(frm) {
		if (!frm.is_new()) {
			_add_sync_button(frm);
		}
	},
});

function _add_sync_button(frm) {
	const allowed = ["System Manager", "Seal System Administrator", "Operations Control Room"];
	if (!allowed.some(r => frappe.user.has_role(r))) return;

	frm.add_custom_button(__("Sync from Seal Server"), function () {
		if (!frm.doc.imei_number) {
			frappe.msgprint({
				title: __("Cannot Sync"),
				message: __("Please set the IMEI Number on this device before syncing."),
				indicator: "orange",
			});
			return;
		}

		frappe.confirm(
			__("Fetch live data from the Seal Server API for device <b>{0}</b>?", [frm.doc.name]),
			function () {
				frappe.show_progress(__("Syncing…"), 0, 100, __("Contacting Seal Server API…"));
				frappe.call({
					method: "tnt_seal_management.tnt_seal_management.api.seal_sync.manual_sync_seal_device",
					args: { seal_device_name: frm.doc.name },
					callback(r) {
						frappe.hide_progress();
						const res = r.message || {};
						if (res.status === "success") {
							frappe.show_alert({ message: __("Device synced successfully"), indicator: "green" }, 6);
							frm.reload_doc();
						} else {
							frappe.msgprint({
								title: __("Sync Failed"),
								message: res.message || __("Unknown error — check Seal API Sync Log."),
								indicator: "red",
							});
						}
					},
					error() {
						frappe.hide_progress();
						frappe.msgprint({
							title: __("Sync Failed"),
							message: __("Unexpected error — check Seal API Sync Log for details."),
							indicator: "red",
						});
					},
				});
			}
		);
	}, __("Actions"));
}
