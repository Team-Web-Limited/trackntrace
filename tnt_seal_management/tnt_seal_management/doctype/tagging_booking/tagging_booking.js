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
	setup(frm) {
		setup_vehicle_query(frm);
	},
	client_name(frm) {
		drop_other_clients_vehicles(frm);
	},
	vehicles(frm) {
		sync_selected_vehicles(frm);
	},
	booking_date_time(frm) {
		if (is_past_booking_time(frm.doc.booking_date_time)) {
			frappe.show_alert({ message: __("Date and Time cannot be in the past."), indicator: "red" }, 5);
			frm.set_value("booking_date_time", null);
		}
	},
	validate(frm) {
		if (
			(frm.is_new() || frm.doc.__booking_dt_at_load !== frm.doc.booking_date_time) &&
			is_past_booking_time(frm.doc.booking_date_time)
		) {
			frappe.throw(__("Date and Time cannot be in the past."));
		}
	},
	refresh(frm) {
		frm.doc.__booking_dt_at_load = frm.doc.booking_date_time;
		set_booking_date_min(frm);
		load_branch_options(frm);
		// Branch must be set before a booking goes to Finance (enforced server-side
		// too); older bookings past that point aren't forced to have one.
		frm.toggle_reqd(
			"branch",
			frm.is_new() || ["Draft", "Pending Account Manager Review"].includes(frm.doc.booking_status)
		);
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
			frm.add_custom_button(__("Approve"), () => approve_booking_with_team_leader(frm), __("Actions"));

			frm.add_custom_button(
				__("Amend"),
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
									"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.amend_booking",
								args: {
									docname: frm.doc.name,
									reason: values.reason,
								},
								freeze: true,
								freeze_message: __("Amending booking…"),
								callback: () => {
									frappe.show_alert(
										{
											message: __("Booking returned for amendment"),
											indicator: "blue",
										},
										5
									);
									frm.reload_doc();
								},
							});
						},
						__("Amend Tagging Booking"),
						__("Amend")
					);
				},
				__("Actions")
			);
		}
	},
});


// A vehicle belongs to one client (Vehicle.customer), so the picker only offers
// the selected client's vehicles, and "Create a new Vehicle" from it pre-fills
// that client as the owner.
function setup_vehicle_query(frm) {
	frm.set_query("vehicles", () => {
		if (!frm.doc.client_name) {
			frappe.show_alert({ message: __("Select Client Name first"), indicator: "orange" }, 4);
		}
		return { filters: { customer: frm.doc.client_name || "" } };
	});
	frm.fields_dict.vehicles.df.get_route_options_for_new_doc = () =>
		frm.doc.client_name ? { customer: frm.doc.client_name } : {};
}

// On a client change, remove vehicles that belong to another client.
function drop_other_clients_vehicles(frm) {
	const vehicles = (frm.doc.vehicles || []).map((row) => row.vehicle).filter(Boolean);
	if (!vehicles.length) return;

	frappe.db
		.get_list("Vehicle", {
			filters: { name: ["in", vehicles], customer: frm.doc.client_name || "" },
			fields: ["name"],
			limit: vehicles.length,
		})
		.then((owned) => {
			const keep = new Set(owned.map((v) => v.name));
			const rows = (frm.doc.vehicles || []).filter((row) => keep.has(row.vehicle));
			if (rows.length === (frm.doc.vehicles || []).length) return;

			frm.set_value("vehicles", rows);
			frappe.show_alert(
				{
					message: __("Removed vehicles that do not belong to {0}", [
						frm.doc.client_name || __("the selected client"),
					]),
					indicator: "orange",
				},
				5
			);
		});
}

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

// Approving hands the booking straight to a PCB Team Leader, so Finance picks
// one here — pre-filled when there is only one, blocked when none is set up.
function approve_booking_with_team_leader(frm) {
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.get_team_leader_options",
		callback(r) {
			const leaders = r.message || [];
			if (!leaders.length) {
				frappe.msgprint({
					title: __("No PCB Team Leader"),
					message: __(
						"No PCB Team Leader is set up. Ask a System Manager to give someone the PCB Team Leader role."
					),
					indicator: "red",
				});
				return;
			}
			frappe.prompt(
				[
					{
						fieldname: "pcb_team_leader",
						fieldtype: "Autocomplete",
						label: __("PCB Team Leader"),
						options: leaders,
						default: leaders.length === 1 ? leaders[0].value : "",
						reqd: 1,
						description: __("Who will assign a Tag Operator for this booking. They are notified."),
					},
				],
				(values) => {
					frappe.call({
						method:
							"tnt_seal_management.tnt_seal_management.doctype.tagging_booking.tagging_booking.approve_booking",
						args: { docname: frm.doc.name, pcb_team_leader: values.pcb_team_leader },
						freeze: true,
						freeze_message: __("Approving booking…"),
						callback: (res) => {
							const jobOrder = res.message && res.message.pcb_job_order;
							frm.reload_doc();
							if (jobOrder) {
								frappe.show_alert(
									{
										message: __("Approved — PCB Job Order {0} sent to the Team Leader", [jobOrder]),
										indicator: "green",
									},
									5
								);
							}
						},
					});
				},
				__("Approve Tagging Booking"),
				__("Approve")
			);
		},
	});
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


function is_past_booking_time(value) {
	if (!value) return false;
	const now = frappe.datetime.now_datetime().slice(0, 16);
	return value.slice(0, 16) < now;
}

// Grey out past days in the date picker. Server-side validation is the real
// guard; this is just so the picker doesn't offer dates that will be refused.
function set_booking_date_min(frm) {
	const control = frm.fields_dict.booking_date_time;
	if (!control || !control.datepicker) return;
	try {
		control.datepicker.update({ minDate: frappe.datetime.str_to_obj(frappe.datetime.now_datetime()) });
	} catch (e) {
		// Older datepicker builds: fall back to the change/validate checks above.
	}
}
