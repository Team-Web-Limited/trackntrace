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
		_journey_request_configure_seal_vehicles(frm);
		_journey_request_configure_per_vehicle_fields(frm);
		if (frm.is_new() || _jr_effective_status(frm) === "Draft") {
			_journey_request_sync_number_of_seals(frm);
			_journey_request_autofill_seal_vehicles(frm);
		}
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
		frm.set_query("return_warehouse", () => ({ filters: { active: 1 } }));
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
			_journey_request_autofill_seal_vehicles(frm);
		} else if (target < current && target >= 0) {
			frappe.show_alert({
				message: __("Remove the extra seal rows to match Number of Seals."),
				indicator: "orange",
			});
		}
	},

});

frappe.ui.form.on("Journey Request Seal", {
	seals_add(frm) {
		_journey_request_autofill_seal_vehicles(frm);
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

function _jr_vehicle_label(row) {
	return row.registration_number || row.vehicle || row.name;
}

function _jr_has_stage(frm, stage) {
	const rows = frm.doc.vehicles || [];
	return rows.length ? rows.some((row) => row.status === stage) : frm.doc.journey_request_status === stage;
}

// With vehicles at different stages the request-level status only says how far the
// slowest one has got; the form's editability follows the stage the technician can
// actually work on (earliest first: Draft, then Tagging, Untagging, Seal Return).
function _jr_effective_status(frm) {
	const rows = frm.doc.vehicles || [];
	if (rows.length > 1) {
		for (const stage of ["Draft", "Tagging", "Untagging", "Awaiting Seal Return"]) {
			if (rows.some((row) => row.status === stage)) return stage;
		}
	}
	return frm.doc.journey_request_status;
}

// On a multi-vehicle request several vehicles can sit at the same stage; let the
// user act on one or on all of them. With one (or a legacy request) there is
// nothing to choose and the server acts on everything eligible.
function _jr_with_vehicle(frm, stage, callback) {
	const eligible = (frm.doc.vehicles || []).filter((row) => row.status === stage);
	if (eligible.length < 2) return callback(null);

	const ALL = __("All ({0} vehicles)", [eligible.length]);
	const byLabel = {};
	eligible.forEach((row) => (byLabel[_jr_vehicle_label(row)] = row.name));
	frappe.prompt(
		[
			{
				fieldname: "vehicle",
				fieldtype: "Select",
				label: __("Vehicle"),
				options: [ALL, ...Object.keys(byLabel)].join("\n"),
				default: ALL,
				reqd: 1,
			},
		],
		(values) => callback(byLabel[values.vehicle] || null),
		__("Which vehicle?"),
		__("Continue")
	);
}

// Which Draft vehicles to send up. With one there's nothing to choose; with several
// they're all ticked by default so "submit everything" stays one click, and any can
// be left out to submit later.
function _jr_choose_vehicles_to_submit(frm, callback) {
	const draft = (frm.doc.vehicles || []).filter((row) => row.status === "Draft");
	if (draft.length < 2) return callback(null);

	frappe.prompt(
		[
			{
				fieldname: "vehicles",
				fieldtype: "MultiCheck",
				label: __("Vehicles to submit"),
				columns: 1,
				options: draft.map((row) => ({
					label: _jr_vehicle_label(row),
					value: row.name,
					checked: 1,
				})),
			},
		],
		(values) => {
			const chosen = values.vehicles || [];
			if (!chosen.length) {
				frappe.msgprint(__("Select at least one vehicle to submit."));
				return;
			}
			callback(chosen);
		},
		__("Submit to Control Room"),
		__("Submit")
	);
}

// On a multi-vehicle request tagging, untagging and seal-return details belong to
// each vehicle (entered in the action dialogs, stored on its row), so the shared
// form fields step aside. The vehicles table itself stays hidden.
const JR_PER_VEHICLE_FIELDS = [
	"tagging_completed",
	"tagging_remarks",
	"actual_tagging_date_time",
	"tagging_location",
	"untagging_confirmed_by_technician",
	"seal_return_confirmed_by_technician",
	"seal_return_condition",
	"retrieval_card_number",
	"return_warehouse",
];

// One line per vehicle in the Actual Tagging section, since its own tagging details
// no longer have shared form fields on a multi-vehicle request.
function _journey_request_render_vehicle_summary(frm) {
	const field = frm.fields_dict.vehicle_stage_summary;
	if (!field) return;
	const multi = _jr_is_multi_vehicle(frm);
	frm.toggle_display("vehicle_stage_summary", multi);
	if (!multi) return;

	const esc = frappe.utils.escape_html;
	const dt = (value) => (value ? esc(frappe.datetime.str_to_user(value)) : "—");
	const rows = (frm.doc.vehicles || [])
		.filter((row) => row.status !== "Cancelled")
		.map(
			(row) => `<tr>
				<td>${esc(_jr_vehicle_label(row))}</td>
				<td>${esc(__(row.status || ""))}</td>
				<td>${dt(row.actual_tagging_date_time)}</td>
				<td>${esc(row.tagging_location || "—")}</td>
			</tr>`
		)
		.join("");
	field.$wrapper.html(`
		<div>
			<table class="table table-bordered table-sm" style="width: 100%; white-space: nowrap; margin-bottom: 0;">
				<thead><tr>
					<th>${__("Vehicle")}</th><th>${__("Status")}</th><th>${__("Tagged At")}</th>
					<th>${__("Tagging Location")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`);
}

function _journey_request_configure_per_vehicle_fields(frm) {
	_journey_request_render_vehicle_summary(frm);
	if (!_jr_is_multi_vehicle(frm)) return;
	JR_PER_VEHICLE_FIELDS.forEach((fieldname) => {
		frm.toggle_display(fieldname, false);
		frm.set_df_property(fieldname, "mandatory_depends_on", "");
	});
}

function _journey_request_configure_seal_vehicles(frm) {
	const grid = frm.fields_dict.seals?.grid;
	if (!grid) return;
	const labels = (frm.doc.vehicles || []).map(_jr_vehicle_label);
	grid.update_docfield_property("vehicle", "options", ["", ...labels].join("\n"));
	grid.update_docfield_property("vehicle", "hidden", labels.length < 2 ? 1 : 0);
	grid.refresh();
}

// Suggest Number of Seals from the vehicle count (one seal per vehicle) on a
// request that has no seal rows yet. It is only a starting point: once seal rows
// exist, or the user changes the number, it is left alone.
function _journey_request_sync_number_of_seals(frm) {
	if ((frm.doc.seals || []).length) return;
	const count = (frm.doc.vehicles || []).filter((row) => row.status !== "Cancelled").length;
	if (!count) return;
	if (cint(frm.doc.number_of_seals) !== count) frm.set_value("number_of_seals", count);
}

// With two or more vehicles the seals grid shows a Vehicle column; give each
// seal row that has none the first vehicle not yet holding a seal, in order.
// Rows the user already assigned are left alone, and once every vehicle has a
// seal any further row is left blank for the user to pick.
function _journey_request_autofill_seal_vehicles(frm) {
	const labels = (frm.doc.vehicles || []).map(_jr_vehicle_label);
	if (labels.length < 2) return;

	const seals = frm.doc.seals || [];
	const used = new Set(seals.map((row) => row.vehicle).filter(Boolean));
	let changed = false;
	seals.forEach((row) => {
		if (row.vehicle) return;
		const next = labels.find((label) => !used.has(label));
		if (!next) return;
		used.add(next);
		frappe.model.set_value(row.doctype, row.name, "vehicle", next);
		changed = true;
	});
	if (changed) frm.refresh_field("seals");
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

	if (_jr_has_stage(frm, "Pending Control Room Approval") && isControlRoom) {
		frm.add_custom_button(__("Refresh Seal Status"), () => _jr_refresh_seals(frm), __("Seals"));
		frm.add_custom_button(__("Swap Seal"), () => _jr_swap_seal(frm), __("Seals"));

		frm.add_custom_button(__("Approve"), () =>
			_jr_with_vehicle(frm, "Pending Control Room Approval", (vehicleRow) =>
				_jr_call(frm, "approve_by_control_room", {
					remarks: frm.doc.control_room_remarks,
					vehicle_row: vehicleRow,
				})
			)
		).addClass("btn-primary");

		frm.add_custom_button(__("Return for Amendment"), () =>
			_jr_with_vehicle(frm, "Pending Control Room Approval", (vehicleRow) =>
				_jr_prompt_return_for_amendment(frm, "return_for_amendment_by_control_room", vehicleRow)
			)
		);
	}

	if (_jr_has_stage(frm, "Tagging") && isTech) {
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
					const proceed = () =>
						_jr_with_vehicle(frm, "Tagging", (vehicleRow) =>
							_jr_prompt_tagging_details(frm, vehicleRow)
						);
					frm.is_dirty() ? frm.save().then(proceed) : proceed();
				},
				__("Confirm")
			);
		}).addClass("btn-primary");
	}

	if (_jr_has_stage(frm, "Untagging") && isTech) {
		frm.add_custom_button(__("Confirm Untagging"), () =>
			_jr_with_vehicle(frm, "Untagging", (vehicleRow) => _jr_prompt_confirm_untagging(frm, vehicleRow))
		).addClass(
			"btn-primary"
		);
	}

	// "Awaiting Seal Return" is the seal-return work window. The assigned FT
	// captures evidence and confirms the return, which sends it to the PCB Team
	// Leader for approval.
	if (_jr_has_stage(frm, "Awaiting Seal Return") && isTech) {
		frm.add_custom_button(__("Confirm Seal Return"), () =>
			_jr_with_vehicle(frm, "Awaiting Seal Return", (vehicleRow) => _jr_prompt_confirm_seal_return(frm, vehicleRow))
		).addClass(
			"btn-primary"
		);
	}

	if (_jr_has_stage(frm, "Pending Seal Return Approval") && isTeamLead) {
		frm.add_custom_button(__("Approve Seal Return"), () =>
			_jr_with_vehicle(frm, "Pending Seal Return Approval", (vehicleRow) => _jr_prompt_approve_seal_return(frm, vehicleRow))
		).addClass(
			"btn-primary"
		);
		frm.add_custom_button(__("Return for Amendment"), () =>
			_jr_with_vehicle(frm, "Pending Seal Return Approval", (vehicleRow) =>
				_jr_prompt_return_seal_return_for_amendment(frm, vehicleRow)
			)
		);
	}
}

function _jr_is_multi_vehicle(frm) {
	return (frm.doc.vehicles || []).filter((row) => row.status !== "Cancelled").length > 1;
}

function _jr_target_label(frm, stage, vehicleRow) {
	if (!vehicleRow) return __("all vehicles at this stage");
	const row = (frm.doc.vehicles || []).find((r) => r.name === vehicleRow);
	return row ? _jr_vehicle_label(row) : "";
}

// Tagging details are per vehicle on a multi-vehicle request: each is confirmed
// with its own time and remarks, rather than one shared set of form fields.
function _jr_prompt_tagging_details(frm, vehicleRow) {
	if (!_jr_is_multi_vehicle(frm)) {
		return _jr_call(frm, "complete_tagging", { vehicle_row: vehicleRow });
	}
	frappe.prompt(
		[
			{
				fieldname: "tagging_confirmed",
				fieldtype: "Check",
				label: __("Tagging completed for {0}", [_jr_target_label(frm, "Tagging", vehicleRow)]),
				reqd: 1,
			},
			{
				fieldname: "actual_tagging_date_time",
				fieldtype: "Datetime",
				label: __("Actual Tagging Date and Time"),
				default: frappe.datetime.now_datetime(),
			},
			{ fieldname: "tagging_remarks", fieldtype: "Small Text", label: __("Tagging Remarks") },
		],
		(values) =>
			_jr_call(frm, "complete_tagging", {
				vehicle_row: vehicleRow,
				tagging_confirmed: values.tagging_confirmed ? 1 : 0,
				actual_tagging_date_time: values.actual_tagging_date_time,
				tagging_remarks: values.tagging_remarks || "",
			}),
		__("Complete Tagging"),
		__("Complete Tagging")
	);
}

function _jr_prompt_approve_seal_return(frm, vehicleRow = null) {
	frappe.warn(
		__("Approve Seal Return"),
		__(
			"Approve this seal return? The journey will be completed and the seal(s) returned to the warehouse pool. This cannot be undone."
		),
		() => {
			frappe.prompt(
				[{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks (Optional)") }],
				(values) => _jr_call(frm, "approve_seal_return", { remarks: values.remarks || "", vehicle_row: vehicleRow }),
				__("Approve Seal Return"),
				__("Approve")
			);
		},
		__("Continue")
	);
}

function _jr_prompt_return_seal_return_for_amendment(frm, vehicleRow = null) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("What needs to be amended"), reqd: 1 }],
		(values) => _jr_call(frm, "return_seal_return_for_amendment", { remarks: values.remarks, vehicle_row: vehicleRow }),
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

function _jr_prompt_confirm_untagging(frm, vehicleRow = null) {
	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (Optional)"),
			},
		],
		(values) => {
			const proceed = () => _jr_confirm_untagging(frm, null, values.remarks || "", vehicleRow);
			frm.is_dirty() ? frm.save().then(proceed) : proceed();
		},
		__("Confirm Untagging"),
		__("Confirm")
	);
}

function _jr_confirm_untagging(frm, manualLocation = null, remarks = "", vehicleRow = null) {
	frappe.call({
		method: JR_METHOD("confirm_untagging"),
		args: { docname: frm.doc.name, manual_location: manualLocation, remarks, vehicle_row: vehicleRow },
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
					(values) => _jr_confirm_untagging(frm, values.manual_location, remarks, vehicleRow),
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

function _jr_prompt_confirm_seal_return(frm, vehicleRow = null) {
	if (_jr_is_multi_vehicle(frm)) {
		// Return details differ per vehicle, so they are entered here, not on the form.
		frappe.prompt(
			[
				{
					fieldname: "seal_return_confirmed",
					fieldtype: "Check",
					label: __("Confirmed: seal(s) for {0} physically returned", [
						_jr_target_label(frm, "Awaiting Seal Return", vehicleRow),
					]),
					reqd: 1,
				},
				{
					fieldname: "seal_return_condition",
					fieldtype: "Select",
					label: __("Seal Condition"),
					options: "Good\nDamaged\nLost",
					default: "Good",
					reqd: 1,
				},
				{ fieldname: "retrieval_card_number", fieldtype: "Data", label: __("Retrieval Card Number"), reqd: 1 },
				{ fieldname: "return_warehouse", fieldtype: "Link", options: "Custody Point", label: __("Warehouse"), reqd: 1, get_query: () => ({ filters: { active: 1 } }) },
				{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks (Optional)") },
			],
			(values) => {
				const extra = {
					seal_return_confirmed: values.seal_return_confirmed ? 1 : 0,
					seal_return_condition: values.seal_return_condition,
					retrieval_card_number: values.retrieval_card_number,
					return_warehouse: values.return_warehouse,
				};
				const proceed = () => _jr_confirm_seal_return(frm, null, values.remarks || "", vehicleRow, extra);
				frm.is_dirty() ? frm.save().then(proceed) : proceed();
			},
			__("Confirm Seal Return"),
			__("Confirm")
		);
		return;
	}
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
			const proceed = () => _jr_confirm_seal_return(frm, null, values.remarks || "", vehicleRow);
			frm.is_dirty() ? frm.save().then(proceed) : proceed();
		},
		__("Confirm Seal Return"),
		__("Confirm")
	);
}

function _jr_confirm_seal_return(frm, manualLocation = null, remarks = "", vehicleRow = null, extra = {}) {
	frappe.call({
		method: JR_METHOD("confirm_seal_return"),
		args: { docname: frm.doc.name, manual_location: manualLocation, remarks, vehicle_row: vehicleRow, ...extra },
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
					(values) => _jr_confirm_seal_return(frm, values.manual_location, remarks, vehicleRow, extra),
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

function _jr_prompt_return_for_amendment(frm, method, vehicleRow = null) {
	frappe.prompt(
		[{ fieldname: "remarks", fieldtype: "Small Text", label: __("What needs to be amended"), reqd: 1 }],
		(values) => _jr_call(frm, method, { remarks: values.remarks, vehicle_row: vehicleRow }),
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

	if (frm.is_new() || _jr_effective_status(frm) !== "Draft") {
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
		const proceed = () =>
			_jr_choose_vehicles_to_submit(frm, (vehicleRows) =>
				_jr_call(frm, "submit_to_control_room", { vehicle_rows: vehicleRows })
			);
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

	const status = _jr_effective_status(frm);
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
