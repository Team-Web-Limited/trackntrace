frappe.ui.form.on("PCB Job Order", {
	setup(frm) {
		frm.set_query("assigned_pcb_team_leader", () => ({
			query:
				"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.pcb_team_leader_query",
		}));
	},

	refresh(frm) {
		frm.add_custom_button(__("Back"), () => {
			frappe.set_route("pcb-job-order-list");
		});

		if (frm.is_new()) return;

		// Finance PCB doesn't act on assignments — hide the shortcut from them,
		// but keep it for System Managers (who may also hold the Finance PCB role).
		const hide_open_assignment =
			frappe.user.has_role("Finance PCB") && !frappe.user.has_role("System Manager");
		if (frm.doc.assignment_reference && !hide_open_assignment) {
			frm.add_custom_button(__("Open Assignment"), () => {
				frappe.set_route("Form", "PCB Assignment", frm.doc.assignment_reference);
			});
		}

		const can_update_status =
			frappe.user.has_role("System Manager") || frappe.user.has_role("Finance PCB");
		if (can_update_status && !["Completed", "Cancelled"].includes(frm.doc.job_order_status)) {
			if (frm.doc.assigned_pcb_team_leader) {
				frm.add_custom_button(
					__("Approve"),
					() => _pjo_update_status(frm, "Completed"),
					__("Actions")
				);
			}
			frm.add_custom_button(
				__("Cancel Job Order"),
				() => {
					frappe.confirm(__("Are you sure you want to cancel this job order?"), () =>
						_pjo_update_status(frm, "Cancelled")
					);
				},
				__("Actions")
			);
		}
	},
});

function _pjo_update_status(frm, status) {
	frappe.call({
		method:
			"tnt_seal_management.tnt_seal_management.doctype.pcb_job_order.pcb_job_order.update_job_order_status",
		args: { job_order_name: frm.doc.name, status },
		freeze: true,
		callback() {
			frappe.show_alert({ message: __("Job Order marked as {0}", [status]), indicator: "green" }, 5);
			frm.reload_doc();
		},
	});
}
