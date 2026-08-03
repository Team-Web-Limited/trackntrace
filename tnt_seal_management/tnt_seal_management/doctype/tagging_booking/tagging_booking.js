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
	vehicles(frm) {
		sync_selected_vehicles(frm);
	},
	refresh(frm) {
		load_branch_options(frm);
		frm.add_custom_button(__("Back"), () => {
			frappe.set_route("tagging-booking-list");
		});

		if (frm.is_new()) {
			return;
		}

		// The job order reference is kept across a reopen/amend (for a stable
		// number), but the job order is only live once the booking is approved —
		// don't expose it while the booking is Draft/Pending/Rejected.
		if (
			frm.doc.pcb_job_order_reference &&
			frm.doc.booking_status === "Finance PCB Approved"
		) {
			frm.add_custom_button(__("Open PCB Job Order"), () => {
				frappe.set_route("Form", "PCB Job Order", frm.doc.pcb_job_order_reference);
			});
		}

		const canSubmitToFinance =
			frappe.user.has_role("Account Manager") || frappe.user.has_role("System Manager");
		const canClaimPortalReview =
			canSubmitToFinance &&
			frm.doc.booking_status === "Pending Account Manager Review" &&
			frm.doc.booking_source === "Customer Portal" &&
			!frm.doc.account_manager;
		const isAssignedPortalReview =
			frm.doc.booking_status === "Pending Account Manager Review" &&
			(frm.doc.account_manager === frappe.session.user || frappe.user.has_role("System Manager"));
		if (canClaimPortalReview) {
			frm.add_custom_button(__("Assign to Me"), () => {
				frappe.call({
					method:
						"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.assign_to_me",
					args: { docname: frm.doc.name },
					callback: () => frm.reload_doc(),
				});
			});
		}
		if (
			canSubmitToFinance &&
			(frm.doc.booking_status === "Draft" || isAssignedPortalReview)
		) {
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
			frm.doc.booking_status === "Finance PCB Approved" &&
			frappe.user.has_role("Finance PCB")
		) {
			frm.add_custom_button(
				__("Reopen / Amend"),
				() => {
					frappe.prompt(
						[
							{
								fieldname: "reason",
								fieldtype: "Small Text",
								label: __("Reason for Amendment"),
								reqd: 1,
							},
						],
						(values) => {
							frappe.call({
								method:
									"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.reopen_booking",
								args: {
									docname: frm.doc.name,
									reason: values.reason,
								},
								freeze: true,
								freeze_message: __("Reopening booking…"),
								callback: () => {
									frappe.show_alert(
										{
											message: __("Booking reopened for amendment"),
											indicator: "blue",
										},
										5
									);
									frm.reload_doc();
								},
							});
						},
						__("Reopen Approved Booking"),
						__("Reopen")
					);
				},
				__("Actions")
			);
		}

		if (
			frm.doc.booking_status === "Pending Finance PCB Approval" &&
			frappe.user.has_role("Finance PCB")
		) {
			frm.add_custom_button(
				__("Approve"),
				() => {
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
				},
				__("Actions")
			);

			frm.add_custom_button(
				__("Reject"),
				() => {
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
				},
				__("Actions")
			);
		}
	},
});


function sync_selected_vehicles(frm) {
	const selected_vehicles = (frm.doc.vehicles || [])
		.map((row) => row.vehicle)
		.filter(Boolean);

	frm.clear_table("selected_vehicles");
	selected_vehicles.forEach((vehicle) => {
		const row = frm.add_child("selected_vehicles");
		frappe.model.set_value(row.doctype, row.name, "vehicle", vehicle);
	});

	frm.refresh_field("selected_vehicles");
}

function load_branch_options(frm) {
	if (frm._loading_branch_options) return frm._loading_branch_options;

	frm._loading_branch_options = frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.get_branch_options",
		callback(r) {
			const branches = Array.isArray(r.message) ? r.message : [];
			const currentValue = frm.doc.branch || "";
			const validCurrentValue = currentValue && branches.includes(currentValue) ? currentValue : "";
			const options = [""].concat(branches).join("\n");

			frm.set_df_property("branch", "options", options);
			// set_df_property only updates the docfield metadata; the Autocomplete
			// control's awesomplete list is populated once at make_input() time and
			// won't pick up the new options unless we push them in directly.
			if (frm.fields_dict.branch) {
				frm.fields_dict.branch.set_data(options);
			}
			if (currentValue !== validCurrentValue) {
				frm.set_value("branch", validCurrentValue);
			}
		},
		error() {
			frappe.show_alert({ message: __("Failed to load branches"), indicator: "red" }, 5);
		},
		always() {
			frm._loading_branch_options = null;
		},
	});

	return frm._loading_branch_options;
}
