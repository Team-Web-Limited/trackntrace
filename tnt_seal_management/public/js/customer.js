// Branch checkboxes on Customer: "All" ticks / unticks every branch, and the
// box follows the three branches (all ticked = All).
const CUSTOMER_BRANCH_FIELDS = ["custom_division_fms", "custom_division_ects", "custom_division_rects"];

function sync_all_branches(frm) {
	const all = CUSTOMER_BRANCH_FIELDS.every((f) => frm.doc[f]);
	if (!!frm.doc.custom_division_all !== all) frm.set_value("custom_division_all", all ? 1 : 0);
}

frappe.ui.form.on("Customer", {
	custom_division_all(frm) {
		const all = frm.doc.custom_division_all ? 1 : 0;
		// Only a deliberate tick/untick of "All" fans out; the sync below also fires this.
		if (all || CUSTOMER_BRANCH_FIELDS.every((f) => frm.doc[f])) {
			CUSTOMER_BRANCH_FIELDS.forEach((f) => frm.set_value(f, all));
		}
	},
	custom_division_fms: sync_all_branches,
	custom_division_ects: sync_all_branches,
	custom_division_rects: sync_all_branches,
});
