// Mirrors format_kenyan_plate in vehicle.py: car KAX 840K, motorbike KMGQ 479X,
// trailer ZD 7072, matched with spaces and punctuation stripped.
const KENYAN_PLATE_PATTERNS = [/^(K[A-Z]{2}|KM[A-Z]{2})(\d{3})([A-Z])$/, /^(Z[A-Z])(\d{4})()$/];

function format_kenyan_plate(value) {
	const compact = (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
	for (const pattern of KENYAN_PLATE_PATTERNS) {
		const match = compact.match(pattern);
		if (match) return `${match[1]} ${match[2]}${match[3]}`;
	}
	return null;
}

// Formats a valid plate in place, or flags the field red with the expected format.
function check_registration_number(frm) {
	const field = frm.get_field("registration_number");
	const value = frm.doc.registration_number;
	field.$wrapper.find(".plate-format-error").remove();
	field.$wrapper.toggleClass("has-error", false);
	if (!value) return;

	if (frm.doc.special_plate) {
		const cleaned = value.trim().replace(/\s+/g, " ").toUpperCase();
		if (cleaned !== value) frm.set_value("registration_number", cleaned);
		return;
	}

	const formatted = format_kenyan_plate(value);
	if (formatted) {
		if (formatted !== value) frm.set_value("registration_number", formatted);
		return;
	}
	field.$wrapper.toggleClass("has-error", true);
	field.$wrapper
		.find(".control-input-wrapper")
		.append(
			`<div class="plate-format-error text-danger small mt-1">${__(
				"Not a valid Kenyan plate. Use the format KAX 840K (motorbike KMGQ 479X, trailer ZD 7072), or tick Foreign / Special Plate."
			)}</div>`
		);
}

frappe.ui.form.on("Vehicle", {
	refresh(frm) {
		// Legacy party_type/party_name custom fields (where present) are filled
		// from Customer (Owner) on save — see Vehicle._sync_legacy_party.
		["party_type", "party_name"].forEach((fieldname) => {
			if (!frm.fields_dict[fieldname]) return;
			frm.set_df_property(fieldname, "reqd", 0);
			frm.set_df_property(fieldname, "read_only", 1);
		});
		if (frm.doc.registration_number && frm.doc.registration_number !== frm.doc.registration_number.toUpperCase()) {
			frm.set_value("registration_number", frm.doc.registration_number.toUpperCase());
		}
	},

	registration_number(frm) {
		check_registration_number(frm);
	},

	special_plate(frm) {
		check_registration_number(frm);
	},
});
