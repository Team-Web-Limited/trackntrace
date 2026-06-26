// Copyright (c) 2026, teamweb and contributors
// For license information, please see license.txt

// Default day counts per fixed contract period. The amounts
// (first_period_amount, extra_day_rate) are always per-rule, never derived here.
const PERIOD_TYPE_DAYS = {
	Weekly: 7,
	Monthly: 30,
	Quarterly: 90,
	"Semi-Annually": 180,
	Annually: 365,
};

frappe.ui.form.on("Seal Billing Rate", {
	refresh(frm) {
		_apply_period_type(frm);

		// Remove existing custom back button if any to avoid duplicates on refresh
		frm.page.wrapper.find(".custom-back-btn").remove();

		// Find the print button or standard action wrapper
		const print_btn = frm.page.wrapper.find(
			'.print-btn, button:has(.fa-print), button:has(.octicon-printer), button[title="Print"], button[title="Print..."], [data-original-title="Print"]'
		);

		const back_btn_html = `
			<button class="btn btn-default btn-xs btn-sm custom-back-btn" style="margin-right: 8px; display: inline-flex; align-items: center;">
				<span>${__("Back")}</span>
			</button>
		`;

		if (print_btn.length) {
			const $back_btn = $(back_btn_html);
			$back_btn.insertBefore(print_btn);
			$back_btn.on("click", () => {
				frappe.set_route("seal-billing-rate-list");
			});
		} else {
			// Fallback: If no print button is found, add it as a standard custom button
			frm.add_custom_button(__("Back"), () => {
				frappe.set_route("seal-billing-rate-list");
			});
		}
	},

	billing_type(frm) {
		_apply_period_type(frm);
	},

	billing_period_type(frm) {
		_apply_period_type(frm);
	},

	period_from_date(frm) {
		_apply_period_type(frm);
	},

	period_to_date(frm) {
		_apply_period_type(frm);
	},
});

function _apply_period_type(frm) {
	if (frm.doc.billing_type === "Special") {
		// Special is a private contract: first_period_days is entered directly,
		// no period type or date range involved.
		frm.set_df_property("first_period_days", "read_only", 0);
		frm.set_df_property(
			"first_period_days",
			"description",
			__("Enter the number of days for this contract.")
		);
		return;
	}

	const period = frm.doc.billing_period_type;

	if (period === "Date Range") {
		// Day count comes from the inclusive span between the two dates.
		const days = _inclusive_day_span(frm.doc.period_from_date, frm.doc.period_to_date);
		if (days && frm.doc.first_period_days !== days) {
			frm.set_value("first_period_days", days);
		}
		frm.set_df_property("first_period_days", "read_only", 1);
		frm.set_df_property(
			"first_period_days",
			"description",
			__("Derived from the date range (inclusive). Set the amounts below per rule.")
		);
		return;
	}

	if (period === "Days") {
		frm.set_df_property("first_period_days", "read_only", 0);
		frm.set_df_property(
			"first_period_days",
			"description",
			__("Enter the number of days for this billing rule.")
		);
		return;
	}

	const mapped = PERIOD_TYPE_DAYS[period];
	if (mapped) {
		// Fixed contract period: derive the day count and lock the field.
		if (frm.doc.first_period_days !== mapped) {
			frm.set_value("first_period_days", mapped);
		}
		frm.set_df_property("first_period_days", "read_only", 1);
		frm.set_df_property(
			"first_period_days",
			"description",
			__("Auto-set from the {0} period. Set the amounts below per rule.", [__(period)])
		);
	}
}

// Inclusive whole-day span between two date strings: Jun 1 -> Jun 10 = 10.
function _inclusive_day_span(from_date, to_date) {
	if (!from_date || !to_date) return 0;
	const a = frappe.datetime.str_to_obj(from_date);
	const b = frappe.datetime.str_to_obj(to_date);
	if (!a || !b || b < a) return 0;
	return Math.round((b - a) / 86400000) + 1;
}
