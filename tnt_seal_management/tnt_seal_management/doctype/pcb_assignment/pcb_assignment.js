frappe.ui.form.on("PCB Assignment", {
	setup(frm) {
		frm.set_query("assigned_field_technician", () => ({
			query:
				"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.field_technician_query",
		}));
	},

	refresh(frm) {
		frm.add_custom_button(__("Back"), () => {
			frappe.set_route("assignment-list");
		});

		if (frm.is_new()) return;

		const can_update_status =
			frappe.user.has_role("System Manager") ||
			frm.doc.pcb_team_leader === frappe.session.user;
		if (!can_update_status || frm.doc.assignment_status === "Cancelled") return;

		if (frm.doc.assignment_status === "Pending" && frm.doc.assigned_field_technician) {
			frm.add_custom_button(
				__("Assign"),
				() => _asg_update_status(frm, "Assigned"),
				__("Actions")
			);
		}

		// Untagging/Seal Return assignments have no separate approval step —
		// picking a Field Technician and saving auto-progresses straight to
		// "Untagging Assigned" / "Seal Return Assigned" (see
		// PCBAssignment._auto_progress_untagging_status /
		// _auto_progress_seal_return_status) and hands off the Journey Request.

		frm.add_custom_button(
			__("Cancel Assignment"),
			() => {
				frappe.confirm(__("Are you sure you want to cancel this assignment?"), () =>
					_asg_update_status(frm, "Cancelled")
				);
			},
			__("Actions")
		);
	},
});

function _asg_update_status(frm, status) {
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment.update_assignment_status",
		args: { assignment_name: frm.doc.name, status },
		freeze: true,
		callback() {
			frappe.show_alert({ message: __("Assignment marked as {0}", [status]), indicator: "green" }, 5);
			frm.reload_doc();
		},
	});
}
