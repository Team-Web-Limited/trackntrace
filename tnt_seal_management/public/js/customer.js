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

// RECTs is prepaid. A customer on both ECTS and RECTS bills its TNT journeys off
// its TNT rate (Customer Billing), so its RECTs side needs its own RECTs Prepay
// Rate: what it pays each period before RECTs journeys can go ahead.
const RECTS_PREPAY_API = "tnt_seal_management.tnt_seal_management.api.rects_billing";

frappe.ui.form.on("Customer", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.custom_division_rects || !frm.doc.custom_division_ects) return;
		frm.add_custom_button(__("RECTs Prepay Rate"), () => open_rects_prepay_dialog(frm));
	},
});

function open_rects_prepay_dialog(frm) {
	frappe.call({ method: `${RECTS_PREPAY_API}.get_rects_prepay_rate`, args: { customer: frm.doc.name } }).then(({ message: info }) => {
		const rule = info.rule || {};
		const esc = frappe.utils.escape_html;
		const status = info.status || {};
		const lines = [];
		if (rule.name) lines.push(`${__("Approval")}: <b>${esc(rule.approval_status || "")}</b>`);
		if (info.billed_to) lines.push(`${__("Current period")}: ${esc(info.billed_from)} – ${esc(info.billed_to)} (${esc(info.last_sales_order || "")})`);
		if (status.message) lines.push(`<span class="text-danger">${esc(status.message)}</span>`);
		else if (status.ok && info.billed_to) lines.push(`<span class="text-success">${__("Paid: RECTs journeys can go ahead.")}</span>`);
		const dialog = new frappe.ui.Dialog({
			title: __("RECTs Prepay Rate: {0}", [frm.doc.customer_name || frm.doc.name]),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "intro",
					options: `<p class="text-muted small">${__(
						"What this customer prepays for RECTs each period. A Sales Order is raised at the start of every period once the Managing Director approves the rate, and RECTs journey requests are blocked until it is paid. Their TNT journeys keep their own billing."
					)}</p>${lines.length ? `<p>${lines.join("<br>")}</p>` : ""}`,
				},
				{
					fieldtype: "Select",
					fieldname: "billing_period_type",
					label: __("Frequency"),
					options: ["Weekly", "Bi-Weekly", "Monthly", "Quarterly", "Semi-Annually", "Annually", "Custom"].join("\n"),
					default: rule.billing_period_type || "Monthly",
					reqd: 1,
				},
				{
					fieldtype: "Int",
					fieldname: "first_period_days",
					label: __("Days in a Period"),
					default: rule.first_period_days,
					depends_on: "eval:doc.billing_period_type=='Custom'",
					mandatory_depends_on: "eval:doc.billing_period_type=='Custom'",
				},
				{ fieldtype: "Column Break", fieldname: "col" },
				{
					fieldtype: "Link",
					fieldname: "currency",
					label: __("Currency"),
					options: "Currency",
					default: rule.currency || frm.doc.default_currency || "KES",
					reqd: 1,
				},
				{
					fieldtype: "Float",
					fieldname: "amount",
					label: __("Amount per Period"),
					default: rule.first_period_amount,
					reqd: 1,
				},
			],
			primary_action_label: __("Save"),
			primary_action(values) {
				frappe
					.call({
						method: `${RECTS_PREPAY_API}.set_rects_prepay_rate`,
						args: { customer: frm.doc.name, ...values },
						freeze: true,
					})
					.then(({ message: r }) => {
						dialog.hide();
						frappe.show_alert({
							message: r.sales_order
								? __("RECTs Prepay Rate saved. Sales Order {0} raised.", [r.sales_order])
								: __("RECTs Prepay Rate saved ({0}).", [r.approval_status || ""]),
							indicator: "green",
						});
						frm.reload_doc();
					});
			},
		});
		dialog.show();
	});
}
