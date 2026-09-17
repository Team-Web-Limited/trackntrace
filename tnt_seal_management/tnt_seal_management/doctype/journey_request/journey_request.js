frappe.ui.form.on("Journey Request", {
	refresh(frm) {
		frm.add_fetch("seal_device", "lock_status", "lock_status");
		frm.add_fetch("seal_device", "last_api_status", "api_device_status");
		frm.add_fetch("seal_device", "battery_level", "battery_level");
		frm.add_fetch("seal_device", "current_location", "api_location");
		frm.add_fetch("seal_device", "last_api_sync_time", "api_last_update_time");

		_journey_request_apply_journey_type_options(frm);
		_journey_request_apply_locks(frm);
		_journey_request_lock_pre_tagging_checklist(frm);
		_journey_request_configure_photo_tables(frm);
		_journey_request_lock_remarks_log(frm);
		_journey_request_apply_role_visibility(frm);
		_journey_request_add_list_button(frm);
		_journey_request_add_seals_grid_button(frm);

		frm.set_query("seal_device", "seals", () => ({
			query:
				"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.available_seal_query",
			filters: { journey_request: frm.doc.name || "" },
		}));

		// Origin/Destination are the journey's start/end points, so only
		// Terminal-type locations belong there; Checkpoints are the
		// intermediate stops in the table below.
		frm.set_query("origin", () => ({ filters: { location_role: "Terminal" } }));
		frm.set_query("destination", () => ({ filters: { location_role: "Terminal" } }));
		frm.set_query("checkpoint", "checkpoints", () => ({
			filters: { location_role: "Checkpoint" },
		}));

		// A sub-seal's parent must be one of the other seals already on this
		// journey, so restrict the Parent Seal picker to the sibling rows.
		frm.set_query("parent_seal", "seals", (doc, cdt, cdn) => {
			const others = (frm.doc.seals || [])
				.filter((s) => s.seal_device && s.name !== cdn)
				.map((s) => s.seal_device);
			return { filters: { name: ["in", others.length ? others : [""]] } };
		});

		if (frm.is_new()) {
			return;
		}

		_journey_request_add_buttons(frm);
	},

	// client_name is fetched from the Job Order, so the customer (and with it
	// which rate sets exist) only becomes known once a Job Order is picked.
	job_order(frm) {
		_journey_request_apply_journey_type_options(frm);
	},

	client_name(frm) {
		_journey_request_apply_journey_type_options(frm);
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

frappe.ui.form.on("Seal Trip Photo", {
	entry_document_add(frm, cdt, cdn) {
		_journey_request_set_photo_type(cdt, cdn, "Pre-Tagging");
	},

	tagging_photos_add(frm, cdt, cdn) {
		_journey_request_set_photo_type(cdt, cdn, "Tagging");
	},

	untagging_entry_document_add(frm, cdt, cdn) {
		_journey_request_set_photo_type(cdt, cdn, "Untagging");
	},

	seal_return_entry_document_add(frm, cdt, cdn) {
		_journey_request_set_photo_type(cdt, cdn, "Seal Return");
	},
});

const JR_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.${name}`;

function _journey_request_lock_pre_tagging_checklist(frm) {
	frm.set_df_property("pre_tagging_checklist", "cannot_add_rows", true);
	frm.set_df_property("pre_tagging_checklist", "cannot_delete_rows", true);
}

function _journey_request_lock_remarks_log(frm) {
	frm.set_df_property("remarks_log", "cannot_add_rows", true);
	frm.set_df_property("remarks_log", "cannot_delete_rows", true);
}

const JR_PHOTO_TABLE_TYPES = {
	entry_document: "Pre-Tagging",
	tagging_photos: "Tagging",
	untagging_entry_document: "Untagging",
	seal_return_entry_document: "Seal Return",
};

function _journey_request_configure_photo_tables(frm) {
	for (const fieldname of Object.keys(JR_PHOTO_TABLE_TYPES)) {
		const grid = frm.fields_dict[fieldname]?.grid;
		if (!grid) continue;
		grid.update_docfield_property("photo_type", "read_only", 1);
	}
}

function _journey_request_set_photo_type(cdt, cdn, photoType) {
	frappe.model.set_value(cdt, cdn, "photo_type", photoType);
}

function _journey_request_add_buttons(frm) {
	const status = frm.doc.journey_request_status;
	// System Manager / Administrator may act at any stage of the workflow.
	const isAdmin = frappe.user.has_role("System Manager");
	const isTech = frappe.user.has_role("Field Technician") || isAdmin;
	const isControlRoom = frappe.user.has_role("Operations Control Room") || isAdmin;
	const isTeamLead = frappe.user.has_role("PCB Team Leader") || isAdmin;

	// "Submit to Control Room" lives on the Seals grid toolbar instead — see
	// _journey_request_add_seals_grid_button.

	if (status === "Pending Control Room Approval" && isControlRoom) {
		frm.add_custom_button(__("Refresh Seal Status"), () => _jr_refresh_seals(frm), __("Seals"));
		frm.add_custom_button(__("Swap Seal"), () => _jr_swap_seal(frm), __("Seals"));

		frm.add_custom_button(__("Approve"), () =>
			_jr_call(frm, "approve_by_control_room", { remarks: frm.doc.control_room_remarks })
		).addClass("btn-primary");

		frm.add_custom_button(__("Return for Amendment"), () =>
			_jr_prompt_return_for_amendment(frm, "return_for_amendment_by_control_room")
		);
	}

	if (status === "Tagging" && isTech) {
		frm.add_custom_button(__("Complete Tagging"), () => {
			frappe.warn(
				__("Complete Tagging"),
				__(
					"Confirm tagging is finished. This starts the journey and cannot be undone. Ensure evidence photos are attached and Tagging Completed is ticked."
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

	if (status === "Untagging" && isTech) {
		frm.add_custom_button(__("Confirm Untagging"), () => _jr_prompt_confirm_untagging(frm)).addClass(
			"btn-primary"
		);
	}

	// "Awaiting Seal Return" is the seal-return work window. The assigned FT
	// captures evidence and confirms the return, which sends it to the PCB Team
	// Leader for approval.
	if (status === "Awaiting Seal Return" && isTech) {
		frm.add_custom_button(__("Confirm Seal Return"), () => _jr_prompt_confirm_seal_return(frm)).addClass(
			"btn-primary"
		);
	}

	if (status === "Pending Seal Return Approval" && isTeamLead) {
		frm.add_custom_button(__("Approve Seal Return"), () => _jr_prompt_approve_seal_return(frm)).addClass(
			"btn-primary"
		);
		frm.add_custom_button(__("Return for Amendment"), () => _jr_prompt_return_seal_return_for_amendment(frm));
	}
}

function _jr_prompt_approve_seal_return(frm) {
	frappe.warn(
		__("Approve Seal Return"),
		__(
			"Approve this seal return? The journey will be completed and the seal(s) returned to the warehouse pool. This cannot be undone."
		),
		() => {
			frappe.prompt(
				[{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks (Optional)") }],
				(values) => _jr_call(frm, "approve_seal_return", { remarks: values.remarks || "" }),
				__("Approve Seal Return"),
				__("Approve")
			);
		},
		__("Continue")
	);
}

function _jr_prompt_return_seal_return_for_amendment(frm) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("What needs to be amended"), reqd: 1 }],
		(values) => _jr_call(frm, "return_seal_return_for_amendment", { remarks: values.remarks }),
		__("Return Seal Return for Amendment"),
		__("Return")
	);
}

function _jr_call(frm, method, extraArgs = {}) {
	frappe.call({
		method: JR_METHOD(method),
		args: { docname: frm.doc.name, ...extraArgs },
		freeze: true,
		callback: () => frm.reload_doc(),
	});
}

function _jr_prompt_confirm_untagging(frm) {
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (Optional)"),
			},
		],
		(values) => {
			const proceed = () => _jr_confirm_untagging(frm, null, values.remarks || "");
			frm.is_dirty() ? frm.save().then(proceed) : proceed();
		},
		__("Confirm Untagging"),
		__("Confirm")
	);
}

function _jr_confirm_untagging(frm, manualLocation = null, remarks = "") {
	frappe.call({
		method: JR_METHOD("confirm_untagging"),
		args: { docname: frm.doc.name, manual_location: manualLocation, remarks },
		freeze: true,
		freeze_message: __("Confirming untagging and capturing location…"),
		callback(r) {
			const result = r.message || {};
			if (result.requires_manual_location) {
				frappe.prompt(
					[
						{
							fieldname: "manual_location",
							fieldtype: "Data",
							label: __("Untagging Location"),
							reqd: 1,
							description: __("Live GPS was unavailable. Enter the untagging location manually."),
						},
					],
					(values) => _jr_confirm_untagging(frm, values.manual_location, remarks),
					__("GPS Location Unavailable"),
					__("Confirm Untagging")
				);
				return;
			}

			frappe.show_alert({ message: __("Untagging confirmed"), indicator: "green" }, 6);
			frm.reload_doc();
		},
	});
}

function _jr_prompt_confirm_seal_return(frm) {
	if (!frm.doc.seal_return_confirmed_by_technician) {
		frappe.msgprint({
			message: __("Tick Confirmed by Technician to confirm the seal has been physically returned."),
			title: __("Confirmation Required"),
			indicator: "orange",
		});
		return;
	}
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (Optional)"),
			},
		],
		(values) => {
			const proceed = () => _jr_confirm_seal_return(frm, null, values.remarks || "");
			frm.is_dirty() ? frm.save().then(proceed) : proceed();
		},
		__("Confirm Seal Return"),
		__("Confirm")
	);
}

function _jr_confirm_seal_return(frm, manualLocation = null, remarks = "") {
	frappe.call({
		method: JR_METHOD("confirm_seal_return"),
		args: { docname: frm.doc.name, manual_location: manualLocation, remarks },
		freeze: true,
		freeze_message: __("Confirming seal return and capturing location…"),
		callback(r) {
			const result = r.message || {};
			if (result.requires_manual_location) {
				frappe.prompt(
					[
						{
							fieldname: "manual_location",
							fieldtype: "Data",
							label: __("Seal Return Location"),
							reqd: 1,
							description: __("Live GPS and stored device location were unavailable. Enter the return location manually."),
						},
					],
					(values) => _jr_confirm_seal_return(frm, values.manual_location, remarks),
					__("GPS Location Unavailable"),
					__("Confirm Seal Return")
				);
				return;
			}

			frappe.show_alert(
				{
					message: __("Seal return confirmed — sent to the PCB Team Leader for approval"),
					indicator: "green",
				},
				6
			);
			frm.reload_doc();
		},
	});
}

function _jr_prompt_return_for_amendment(frm, method) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("What needs to be amended"), reqd: 1 }],
		(values) => _jr_call(frm, method, { remarks: values.remarks }),
		__("Return Journey Request for Amendment"),
		__("Return")
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

	frm.add_custom_button(__("Submit to Control Room"), () => {
		const incomplete = (frm.doc.pre_tagging_checklist || []).some((row) => !row.completed);
		if (incomplete) {
			frappe.msgprint({
				message: __(
					"Complete every item on the Pre-Tagging Checklist before submitting to the Control Room."
				),
				title: __("Pre-Tagging Checklist Incomplete"),
				indicator: "orange",
			});
			return;
		}
		const proceed = () => _jr_call(frm, "submit_to_control_room");
		frm.is_dirty() ? frm.save().then(proceed) : proceed();
	}).addClass("btn-primary");
}

const JR_CONTENT_FIELDS = [
	// journey_type picks which rate set bills the journey, so it's locked from
	// Tagging onward exactly like the rest of the journey's content — the
	// server enforces this too (CONTENT_FIELDS in journey_request.py).
	"journey_type",
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
	"untagging_confirmed_by_technician",
];
const JR_SEAL_RETURN_FIELDS = [
	"seal_return_entry_document",
	"seal_return_confirmed_by_technician",
	"seal_return_condition",
];

// Journey Type decides which of the customer's rate sets bills this journey,
// so only types that customer actually has usable rates for are offered.
// Import/Export appear once that rate set exists and is approved (see
// journey_request.get_available_journey_types); Local is always available.
// The server re-checks this on save — see JourneyRequest.validate_journey_type.
function _journey_request_apply_journey_type_options(frm) {
	const applyOptions = (types) => {
		frm.set_df_property("journey_type", "options", types.join("\n"));
		// A value that's no longer on offer (the rates were removed or sent back
		// for approval after this request was raised) would otherwise sit in the
		// control as a blank-looking selection. Leave an already-saved journey
		// alone — it's locked from Tagging onward anyway, and rewriting it here
		// would silently re-price the journey.
		if (frm.is_new() && !types.includes(frm.doc.journey_type)) {
			frm.set_value("journey_type", "Local");
		}
		frm.refresh_field("journey_type");
	};

	if (!frm.doc.client_name) {
		applyOptions(["Local"]);
		return;
	}

	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.get_available_journey_types",
		args: { customer: frm.doc.client_name },
		callback(r) {
			applyOptions((r && r.message) || ["Local"]);
		},
	});
}

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
	} else if (isTech && status === "Awaiting Seal Return") {
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

// While the request is still Draft, workflow-only sections after Documents &
// Photos remain hidden via `depends_on`. Documents & Photos stays visible because
// tagging evidence is required before submission to the Control Room.
