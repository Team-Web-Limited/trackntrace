// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Seal API Settings", {
	refresh(frm) {
		_add_test_connection_button(frm);
	},
});

function _add_test_connection_button(frm) {
	frm.add_custom_button(__("Test API Connection"), function () {
		if (!frm.doc.api_base_url || !frm.doc.username) {
			frappe.msgprint({
				title: __("Incomplete Settings"),
				message: __("Please fill in API Base URL, Username, and Password before testing."),
				indicator: "orange",
			});
			return;
		}

		frappe.show_progress(__("Testing…"), 0, 100, __("Generating token from Seal Server API…"));
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.api.seal_sync.test_connection",
			callback(r) {
				frappe.hide_progress();
				const res = r.message || {};
				if (res.status === "success") {
					frappe.msgprint({
						title: __("Connection Successful"),
						message: `<b>${__("Result:")}</b> ${res.message || __("API connection test passed.")}`,
						indicator: "green",
					});
					frm.reload_doc();
				} else {
					frappe.msgprint({
						title: __("Connection Failed"),
						message: res.message || __("Check Seal API Sync Log for details."),
						indicator: "red",
					});
				}
			},
			error() {
				frappe.hide_progress();
				frappe.msgprint({
					title: __("Connection Failed"),
					message: __("Unexpected error — verify configuration and check Seal API Sync Log."),
					indicator: "red",
				});
			},
		});
	}, __("Actions"));
}
