// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

frappe.ui.form.on("Seal Alert Log", {
	refresh(frm) {
		if (frm.is_new() || frm.doc.acknowledged) return;

		frm.add_custom_button(__("Acknowledge"), () => {
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.acknowledge_alert",
				args: { docname: frm.doc.name },
				freeze: true,
				callback: () => frm.reload_doc(),
			});
		}).addClass("btn-primary");
	},
});
