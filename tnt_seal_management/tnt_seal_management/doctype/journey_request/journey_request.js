frappe.ui.form.on("Journey Request", {
	refresh(frm) {
		frm.add_fetch("seal_device", "lock_status", "lock_status");
		frm.add_fetch("seal_device", "last_api_status", "api_device_status");
		frm.add_fetch("seal_device", "battery_level", "battery_level");
		frm.add_fetch("seal_device", "current_location", "api_location");
		frm.add_fetch("seal_device", "last_api_sync_time", "api_last_update_time");

		_journey_request_apply_locks(frm);
		_journey_request_apply_role_visibility(frm);
		_journey_request_add_list_button(frm);
		_journey_request_add_seals_grid_button(frm);

		frm.set_query("seal_device", "seals", () => ({
			query:
				"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.available_seal_query",
			filters: { journey_request: frm.doc.name || "" },
		}));

		if (frm.is_new()) {
			return;
		}

		_journey_request_add_buttons(frm);
	},

	number_of_seals(frm) {
		const target = cint(frm.doc.number_of_seals);
		const current = (frm.doc.seals || []).length;

		if (target > current) {
			for (let i = current; i < target; i++) {
				frm.add_child("seals");
			}
			frm.refresh_field("seals");
		} else if (target < current && target >= 0) {
			frappe.show_alert({
				message: __("Remove the extra seal rows to match Number of Seals."),
				indicator: "orange",
			});
		}
	},
});

const JR_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.${name}`;

function _journey_request_add_buttons(frm) {
	const status = frm.doc.journey_request_status;
	// System Manager / Administrator may act at any stage of the workflow.
	const isAdmin = frappe.user.has_role("System Manager");
	const isTech = frappe.user.has_role("Field Technician") || isAdmin;
	const isControlRoom = frappe.user.has_role("Operations Control Room") || isAdmin;
	const isCustomerCare = frappe.user.has_role("Customer Care") || isAdmin;

	// "Submit to Control Room" lives on the Seals grid toolbar instead — see
	// _journey_request_add_seals_grid_button.

	if (status === "Pending Control Room Approval" && isControlRoom) {
		frm.add_custom_button(__("Refresh Seal Status"), () => _jr_refresh_seals(frm), __("Seals"));
		frm.add_custom_button(__("Swap Seal"), () => _jr_swap_seal(frm), __("Seals"));

		frm.add_custom_button(__("Approve"), () =>
			_jr_call(frm, "approve_by_control_room", { remarks: frm.doc.control_room_remarks })
		).addClass("btn-primary");

		frm.add_custom_button(__("Reject"), () =>
			_jr_prompt_reject(frm, "reject_by_control_room")
		);
	}

	if (status === "Tagging" && isTech) {
		frm.add_custom_button(__("Complete Tagging"), () => {
			frappe.warn(
				__("Complete Tagging"),
				__(
					"Confirm tagging is finished. This cannot be undone. Ensure evidence photos are attached and Tagging Completed is ticked."
				),
				() => {
					// complete_tagging() re-reads the doc from the database, so any
					// unsaved checkbox/photo edits on the form must be saved first
					// or the server still sees the pre-edit values.
					const proceed = () => _jr_call(frm, "complete_tagging");
					frm.is_dirty() ? frm.save().then(proceed) : proceed();
				},
				__("Confirm")
			);
		}).addClass("btn-primary");
	}

	if (status === "Pending CC Approval" && isCustomerCare) {
		frm.add_custom_button(__("Approve"), () =>
			_jr_call(frm, "approve_journey_request", { remarks: frm.doc.customer_care_remarks })
		).addClass("btn-primary");

		frm.add_custom_button(__("Reject"), () =>
			_jr_prompt_reject(frm, "reject_journey_request")
		);
	}

	if (status === "Untagging" && isTech) {
		frm.add_custom_button(__("Submit Untagging to Control Room"), () => {
			frappe.warn(
				__("Submit Untagging to Control Room"),
				__("Confirm untagging evidence is captured before submitting for Control Room approval."),
				() => {
					// submit_untagging_to_control_room() re-reads the doc from the
					// database, so unsaved photo edits must be saved first.
					const proceed = () => _jr_call(frm, "submit_untagging_to_control_room");
					frm.is_dirty() ? frm.save().then(proceed) : proceed();
				},
				__("Confirm")
			);
		}).addClass("btn-primary");
	}

	// "Untagging Approved" doubles as the seal-return work window — the FT who
	// untagged the seal (now its custodian) captures return evidence and submits
	// it for the Control Room's final good-condition sign-off.
	if (status === "Untagging Approved" && isTech) {
		frm.add_custom_button(__("Submit Seal Return to Control Room"), () => {
			frappe.warn(
				__("Submit Seal Return to Control Room"),
				__("Confirm the seal has been returned in good condition and evidence is captured before submitting for Control Room approval."),
				() => {
					// submit_seal_return_to_control_room() re-reads the doc from the
					// database, so unsaved photo edits must be saved first.
					const proceed = () => _jr_call(frm, "submit_seal_return_to_control_room");
					frm.is_dirty() ? frm.save().then(proceed) : proceed();
				},
				__("Confirm")
			);
		}).addClass("btn-primary");
	}
}

function _jr_call(frm, method, extraArgs = {}) {
	frappe.call({
		method: JR_METHOD(method),
		args: { docname: frm.doc.name, ...extraArgs },
		freeze: true,
		callback: () => frm.reload_doc(),
	});
}

function _jr_prompt_reject(frm, method) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks"), reqd: 1 }],
		(values) => _jr_call(frm, method, { remarks: values.remarks }),
		__("Reject Journey Request")
	);
}

function _jr_refresh_seals(frm) {
	frappe.call({
		method: JR_METHOD("refresh_proposed_seal_status"),
		args: { docname: frm.doc.name },
		freeze: true,
		freeze_message: __("Fetching live seal data…"),
		callback(r) {
			const res = r.message || {};
			frappe.show_alert(
				{
					message: __("Refreshed {0} seal(s)", [res.refreshed || 0]),
					indicator: (res.errors || []).length ? "orange" : "green",
				},
				6
			);
			if ((res.errors || []).length) {
				frappe.msgprint({
					title: __("Some seals could not be refreshed"),
					message: res.errors.join("<br>"),
					indicator: "orange",
				});
			}
			frm.reload_doc();
		},
	});
}

function _jr_swap_seal(frm) {
	const seals = (frm.doc.seals || []).filter((r) => r.seal_device);
	if (!seals.length) {
		frappe.msgprint(__("There are no seals to swap."));
		return;
	}

	frappe.prompt(
		[
			{
				fieldname: "old_seal_device",
				fieldtype: "Select",
				label: __("Seal to Replace"),
				options: seals.map((r) => r.seal_device).join("\n"),
				reqd: 1,
			},
			{
				fieldname: "new_seal_device",
				fieldtype: "Link",
				options: "Seal Device",
				label: __("New Seal"),
				reqd: 1,
				get_query: () => ({ filters: { current_status: "Available" } }),
			},
		],
		(values) => {
			frappe.call({
				method: JR_METHOD("swap_seal"),
				args: {
					docname: frm.doc.name,
					old_seal_device: values.old_seal_device,
					new_seal_device: values.new_seal_device,
				},
				freeze: true,
				callback() {
					frappe.show_alert({ message: __("Seal swapped"), indicator: "green" }, 5);
					frm.reload_doc();
				},
			});
		},
		__("Swap Seal")
	);
}

function _journey_request_add_list_button(frm) {
	frm.add_custom_button(__("Back"), () => {
		frappe.set_route("journey-request-list");
	});
}

function _journey_request_add_seals_grid_button(frm) {
	const grid = frm.fields_dict.seals?.grid;
	if (!grid) return;

	// refresh() re-runs on every reload/status change — hide any button left
	// over from a previous render before deciding whether to show it again.
	grid.clear_custom_buttons();

	if (frm.is_new() || frm.doc.journey_request_status !== "Draft") {
		return;
	}

	const isAdmin = frappe.user.has_role("System Manager");
	const isTech = frappe.user.has_role("Field Technician") || isAdmin;
	if (!isTech) return;

	// "bottom" puts it in the grid footer next to "Add Row" — guaranteed
	// visible, unlike "top" which sits in a thin strip above the table.
	grid
		.add_custom_button(__("Submit to Control Room"), () =>
			_jr_call(frm, "submit_to_control_room")
		)
		.addClass("btn-primary");
}

const JR_CONTENT_FIELDS = [
	"vehicle",
	"entry_number",
	"container_number",
	"number_of_seals",
	"origin",
	"destination",
	"driver_contact",
	"entry_document",
	"seals",
];
const JR_TAGGING_FIELDS = [
	"tagging_photos",
	"actual_tagging_date_time",
	"tagging_completed",
	"tagging_remarks",
];
// tagging_location is intentionally excluded — it is pulled automatically from
// the seal device's GPS in complete_tagging() and stays read-only (see its
// "read_only": 1 in journey_request.json) rather than being technician-edited.
const JR_UNTAGGING_FIELDS = [
	"untagging_entry_document",
	"untagging_photos",
	"untagging_confirmed_by_technician",
];
const JR_SEAL_RETURN_FIELDS = [
	"seal_return_entry_document",
	"seal_return_photos",
	"seal_return_confirmed_by_technician",
	"seal_return_condition",
];

function _journey_request_apply_locks(frm) {
	if (frappe.user.has_role("System Manager")) {
		return;
	}

	const status = frm.doc.journey_request_status;
	const isTech = frappe.user.has_role("Field Technician");
	const isNew = frm.is_new();

	let lockedContent = !isNew;
	let lockedTagging = !isNew;
	let lockedUntagging = !isNew;
	let lockedSealReturn = !isNew;

	if (isTech && (isNew || status === "Draft")) {
		lockedContent = false;
		lockedTagging = false;
	} else if (isTech && status === "Tagging") {
		lockedContent = true;
		lockedTagging = false;
	} else if (isTech && status === "Untagging") {
		lockedContent = true;
		lockedTagging = true;
		lockedUntagging = false;
	} else if (isTech && status === "Untagging Approved") {
		// Seal-return work window: untagging is locked-in, seal return is editable.
		lockedContent = true;
		lockedTagging = true;
		lockedUntagging = true;
		lockedSealReturn = false;
	}

	for (const fieldname of JR_CONTENT_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedContent ? 1 : 0);
	}
	for (const fieldname of JR_TAGGING_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedTagging ? 1 : 0);
	}
	for (const fieldname of JR_UNTAGGING_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedUntagging ? 1 : 0);
	}
	for (const fieldname of JR_SEAL_RETURN_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedSealReturn ? 1 : 0);
	}

	frm.set_df_property("job_order", "read_only", 1);
	// set_df_property(fieldname, "read_only", ...) above already disables
	// Add/Delete Row on these Table fields — Grid.toggle_enable() takes a
	// (column_fieldname, enable) pair for a single column, not a whole-grid
	// toggle, so calling it with one boolean argument threw "field true not
	// found" and aborted the rest of refresh(frm).
}

function _journey_request_apply_role_visibility(frm) {
	const isFieldTechnician =
		frappe.user.has_role("Field Technician") && !frappe.user.has_role("System Manager");

	frm.set_df_property("jr_row_10_section", "hidden", isFieldTechnician ? 1 : 0);
	frm.set_df_property("approval_log", "hidden", isFieldTechnician ? 1 : 0);
	frm.toggle_display("jr_row_10_section", !isFieldTechnician);
	frm.toggle_display("approval_log", !isFieldTechnician);
}

// While the request is still Draft, every section past Seals (documents/photos,
// control room approval, tagging, customer care approval, approval history,
// remarks) is hidden via `depends_on` on those section breaks
// in journey_request.json — Frappe hides whole sections natively there, which is
// more reliable than toggling field visibility from JS.
