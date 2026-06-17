frappe.ui.form.on("Tagging Booking", {
	before_save(frm) {
		frm._was_new = frm.is_new();
	},
	after_save(frm) {
		if (frm._was_new && frm.doc.booking_status === "Draft") {
			frm._was_new = false;
			frappe.set_route("tagging-booking-list");
		}
	},
	refresh(frm) {
		frm.add_custom_button(__("Tagging Bookings"), () => {
			frappe.set_route("tagging-booking-list");
		});

		if (frm.is_new()) {
			return;
		}

		if (frm.doc.pcb_job_order_reference) {
			frm.add_custom_button(__("Open PCB Job Order"), () => {
				frappe.set_route("Form", "PCB Job Order", frm.doc.pcb_job_order_reference);
			});
		}

		if (frm.doc.booking_status === "Draft") {
			frm.add_custom_button(__("Submit to Finance"), () => {
				frappe.call({
					method:
						"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.submit_to_finance",
					args: { docname: frm.doc.name },
					callback: () => frm.reload_doc(),
				});
			});
		}

		if (
			frm.doc.booking_status === "Pending Finance PCB Approval" &&
			frappe.user.has_role("Finance PCB")
		) {
			frm.add_custom_button(__("Approve"), () => {
				frappe.call({
					method:
						"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.approve_booking",
					args: { docname: frm.doc.name },
					callback: (r) => {
						const jobOrder = r.message && r.message.pcb_job_order;
						frm.reload_doc();
						if (jobOrder) {
							frappe.show_alert(
								{
									message: __("PCB Job Order {0} created", [jobOrder]),
									indicator: "green",
								},
								5
							);
						}
					},
				});
			});

			frm.add_custom_button(__("Reject"), () => {
				frappe.prompt(
					[
						{
							fieldname: "remarks",
							fieldtype: "Small Text",
							label: __("Rejection Reason"),
							reqd: 1,
						},
					],
					(values) => {
						frappe.call({
							method:
								"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.reject_booking",
							args: {
								docname: frm.doc.name,
								remarks: values.remarks,
							},
							callback: () => frm.reload_doc(),
						});
					},
					__("Reject Tagging Booking"),
					__("Reject")
				);
			});
		}
	},
});
