frappe.ui.form.on("Journey Request", {
	refresh(frm) {
		_journey_request_apply_locks(frm);
		_journey_request_add_list_button(frm);

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
	const isTech = frappe.user.has_role("Field Technician");
	const isControlRoom = frappe.user.has_role("Operations Control Room");
	const isCustomerCare = frappe.user.has_role("Customer Care");

	if (status === "Draft" && (isTech || frappe.user.has_role("System Manager"))) {
		frm.add_custom_button(__("Submit to Control Room"), () =>
			_jr_call(frm, "submit_to_control_room")
		).addClass("btn-primary");
	}

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

	if (status === "Pending Tagging" && (isTech || frappe.user.has_role("System Manager"))) {
		frm.add_custom_button(__("Complete Tagging"), () => {
			frappe.warn(
				__("Complete Tagging"),
				__(
					"Confirm tagging is finished. This cannot be undone. Ensure evidence photos are attached and Tagging Completed is ticked."
				),
				() => _jr_call(frm, "complete_tagging"),
				__("Confirm")
			);
		}).addClass("btn-primary");
	}

	if (status === "Pending Customer Care Approval" && isCustomerCare) {
		frm.add_custom_button(__("Approve"), () =>
			_jr_call(frm, "approve_journey_request", { remarks: frm.doc.customer_care_remarks })
		).addClass("btn-primary");

		frm.add_custom_button(__("Reject"), () =>
			_jr_prompt_reject(frm, "reject_journey_request")
		);
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
	const label = __("Journey Request List");
	frm.page.remove_inner_button(label);
	frm.page
		.add_inner_button(label, () => frappe.set_route("journey-request-list"))
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
	"tagging_location",
	"tagging_completed",
	"tagging_remarks",
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

	if (isTech && (isNew || status === "Draft")) {
		lockedContent = false;
		lockedTagging = false;
	} else if (isTech && status === "Pending Tagging") {
		lockedContent = true;
		lockedTagging = false;
	}

	for (const fieldname of JR_CONTENT_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedContent ? 1 : 0);
	}
	for (const fieldname of JR_TAGGING_FIELDS) {
		frm.set_df_property(fieldname, "read_only", lockedTagging ? 1 : 0);
	}

	frm.set_df_property("job_order", "read_only", 1);
	frm.fields_dict.seals?.grid?.toggle_enable(!lockedContent);
	frm.fields_dict.tagging_photos?.grid?.toggle_enable(!lockedTagging);
}
