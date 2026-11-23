// Device removal: list the removed devices and return them to the field
// technician's warehouse (see device_removal.py).

frappe.ui.form.on("Issue", {
	setup(frm) {
		// Only devices currently installed for this Issue's customer.
		frm.set_query("serial_no", "custom_removed_devices", () => ({
			filters: {
				status: "Delivered",
				...(frm.doc.customer ? { customer: frm.doc.customer } : {}),
			},
		}));
		frm.set_query("custom_return_warehouse", () => ({
			filters: {
				is_group: 0,
				disabled: 0,
				...(frm.doc.company ? { company: frm.doc.company } : {}),
			},
		}));
	},

	refresh(frm) {
		tnt_issue_device_removal_button(frm);
	},

	issue_type(frm) {
		tnt_issue_device_removal_button(frm);
	},
});

function tnt_issue_device_removal_button(frm) {
	frm.remove_custom_button(__("Return Devices to Technician"));
	if (frm.is_new() || frm.doc.issue_type !== "Device removal") return;

	const pending = (frm.doc.custom_removed_devices || []).filter((r) => !r.return_delivery_note);
	if (!pending.length) return;

	if (["Resolved", "Closed"].includes(frm.doc.status)) {
		frm.dashboard.set_headline_alert(
			__("{0} removed device(s) not yet returned to the field technician.", [pending.length]),
			"orange"
		);
	}

	frm.add_custom_button(__("Return Devices to Technician"), () => {
		if (frm.is_dirty()) {
			frappe.msgprint(__("Save the Issue first."));
			return;
		}
		if (!frm.doc.custom_return_warehouse) {
			frappe.msgprint(__("Set the Field Technician Warehouse first."));
			frm.scroll_to_field("custom_return_warehouse");
			return;
		}
		const list = pending.map((r) => `<li>${frappe.utils.escape_html(r.serial_no)}</li>`).join("");
		frappe.confirm(
			__("Return these devices from {0} into {1}?", [
				frappe.utils.escape_html(frm.doc.customer || __("the customer")),
				frappe.utils.escape_html(frm.doc.custom_return_warehouse),
			]) + `<ul>${list}</ul>`,
			() =>
				frappe.call({
					method: "tnt_seal_management.device_removal.return_devices",
					args: { issue: frm.doc.name },
					freeze: true,
					freeze_message: __("Returning devices..."),
					callback(r) {
						if (r.exc) return;
						frappe.show_alert({
							message: __("Returned under {0}", [(r.message || []).join(", ")]),
							indicator: "green",
						});
						frm.reload_doc();
					},
				})
		);
	}).addClass("btn-primary");
}
