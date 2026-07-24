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

		if (frm.doc.assignment_status === "Cancelled") return;

		const is_system_manager = frappe.user.has_role("System Manager");
		// Assigning a Tag Operator is the PCB Team Leader's action; cancelling —
		// which reverts the whole journey to Finance PCB approval — is not. Only
		// PCB Finance (or a System Manager) may cancel (see _ensure_cancel_permission).
		const can_assign = is_system_manager || frm.doc.pcb_team_leader === frappe.session.user;
		const can_cancel = is_system_manager || frappe.user.has_role("Finance PCB");

		if (
			can_assign &&
			frm.doc.assignment_status === "Pending" &&
			frm.doc.assigned_field_technician
		) {
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

		if (can_cancel) {
			// Cancelling unwinds real physical work, so it's only offered while
			// tagging hasn't actually begun yet — ask the server, which is the
			// single source of truth (see can_cancel_assignment /
			// _ensure_tagging_not_started), rather than re-deriving journey
			// status here.
			frappe.call({
				method:
					"tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment.can_cancel_assignment",
				args: { assignment_name: frm.doc.name },
				callback(r) {
					if (!r.message?.can_cancel) return;
					frm.add_custom_button(
						__("Cancel Assignment"),
						() => {
							frappe.confirm(
								__("Cancel this assignment? The linked Seal Journey will be reverted to Pending Finance PCB Approval and the assigned Tag Operator released."),
								() => _asg_update_status(frm, "Cancelled")
							);
						},
						__("Actions")
					);
				},
			});
		}
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
