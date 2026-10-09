// The "TNT Sealmanagement" Workspace exists only to carry a sidebar/breadcrumb
// entry; the real landing UI is the Page "tnt-seal-management". The two cannot
// share a route (Workspace and Page are separate doctypes in one namespace), so
// the workspace is named to slug differently and we bounce it to the Page here.
//
// The router resolves a workspace URL to ["Workspaces", <workspace title>] — it
// keys off `title`, not the slug in the address bar — so match on that shape.
const TNT_LANDING_PAGE = 'tnt-seal-management';
const TNT_WORKSPACE_TITLES = [
	'TNT Seal Management', // current title of the workspace record
	'TNT Sealmanagement', // name/label, in case the router keys off it
	'TNT Operations', // legacy names, kept so old links/bookmarks still land
	'TNT Operations Hub',
];

frappe.router.on('change', () => {
	const route = frappe.router.current_route || [];
	if (route[0] !== 'Workspaces') return;
	if (!TNT_WORKSPACE_TITLES.includes(route[1])) return;

	frappe.route_flags.replace_route = true;
	frappe.set_route(TNT_LANDING_PAGE);
});

(function () {
	const SESSION_EXPIRED_PATTERNS = [
		/Login to access/i,
		/Log in to access/i,
		/session expired/i,
		/Function .* is not whitelisted/i,
		/CSRFTokenError/i,
	];

	function contains_session_expired_text(value) {
		if (!value) return false;
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		return SESSION_EXPIRED_PATTERNS.some((pattern) => pattern.test(text));
	}

	function extract_response_payload(xhr) {
		if (!xhr) return null;
		if (xhr.responseJSON) return xhr.responseJSON;
		if (!xhr.responseText) return null;

		try {
			return JSON.parse(xhr.responseText);
		} catch (e) {
			return xhr.responseText;
		}
	}

	function response_indicates_session_expired(xhr) {
		const payload = extract_response_payload(xhr);
		if (contains_session_expired_text(payload)) return true;

		return (
			frappe.session?.user === 'Guest' &&
			frappe.session?.logged_in_user &&
			frappe.session.logged_in_user !== 'Guest'
		);
	}

	function redirect_to_login_once() {
		if (window.__tnt_redirecting_to_login) return;
		window.__tnt_redirecting_to_login = true;

		frappe.dom?.unfreeze?.();
		frappe.hide_msgprint?.();

		if (frappe.app?.redirect_to_login) {
			frappe.app.redirect_to_login();
			return;
		}

		window.location.href = `/login?redirect-to=${encodeURIComponent(
			window.location.pathname + window.location.search
		)}`;
	}



	function install_msgprint_guard() {
		if (!frappe.msgprint || frappe.msgprint.__tnt_session_guard) return;

		const original_msgprint = frappe.msgprint;
		const guarded_msgprint = function (message) {
			if (contains_session_expired_text(message)) {
				redirect_to_login_once();
				return null;
			}

			return original_msgprint.apply(this, arguments);
		};

		guarded_msgprint.__tnt_session_guard = true;
		frappe.msgprint = guarded_msgprint;
	}

	install_msgprint_guard();

	$(document).ajaxError((event, xhr) => {
		if (response_indicates_session_expired(xhr)) {
			redirect_to_login_once();
		}
	});

	frappe.after_ajax(() => {
		if (
			frappe.session?.user === 'Guest' &&
			frappe.session?.logged_in_user &&
			frappe.session.logged_in_user !== 'Guest'
		) {
			redirect_to_login_once();
		}
	});
})();


const TNT_CUSTODY_SEALS_CLASS = "tnt-warehouse-seals";

// Shared by the Warehouse and Custody Point forms: lists the seals held at
// (custody_type, frm.doc.name).
window.tnt_render_custody_seals = function (frm, custody_type, title) {
	const e0 = frappe.utils.escape_html;
	const $wrapper = $(frm.layout.wrapper);
	$wrapper.find(`.${TNT_CUSTODY_SEALS_CLASS}`).remove();
	if (frm.is_new()) return;

	const $box = $(`
		<div class="${TNT_CUSTODY_SEALS_CLASS} form-section card-section" style="margin-top: 15px;">
			<div class="section-head">${e0(title)}</div>
			<div class="wh-seals-body text-muted">${__("Loading...")}</div>
		</div>
	`).appendTo($wrapper);

	const name = frm.doc.name;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device.get_custody_seals",
		args: { custody_type, custodian: name },
		callback(r) {
			// Ignore a late response after navigating to another Warehouse.
			if (frm.doc.name !== name) return;
			const rows = (r && r.message) || [];
			const $body = $box.find(".wh-seals-body");
			if (!rows.length) {
				$body.text(__("No seals are currently held in this warehouse."));
				return;
			}
			const e = frappe.utils.escape_html;
			const tr = rows
				.map(
					(d) => `<tr>
						<td><input type="checkbox" class="tnt-cs-pick" data-seal="${e(d.name)}"></td>
						<td><a href="/app/seal-device/${encodeURIComponent(d.name)}">${e(d.seal_number || d.name)}</a></td>
						<td>${e(d.device_id || "")}</td>
						<td>${e(d.current_status || "")}</td>
						<td>${e(d.lock_status || "")}</td>
						<td>${e(d.condition || "")}</td>
						<td>${d.current_custody_since ? frappe.datetime.str_to_user(d.current_custody_since) : ""}</td>
					</tr>`
				)
				.join("");
			$body.removeClass("text-muted").html(`
				<p class="text-muted">${__("{0} seal(s)", [rows.length])}
					<button class="btn btn-xs btn-default tnt-cs-transfer" style="margin-left:10px">${__("Transfer selected")}</button></p>
				<div class="table-responsive">
					<table class="table table-bordered table-sm">
						<thead><tr>
							<th></th><th>${__("Seal Number")}</th><th>${__("Device ID")}</th><th>${__("Status")}</th>
							<th>${__("Lock Status")}</th><th>${__("Condition")}</th><th>${__("In Custody Since")}</th>
						</tr></thead>
						<tbody>${tr}</tbody>
					</table>
				</div>`);
			$body.find(".tnt-cs-transfer").on("click", () => {
				const picked = $body.find(".tnt-cs-pick:checked").map((_i, el) => $(el).data("seal")).get();
				window.tnt_transfer_seals(picked, () => window.tnt_render_custody_seals(frm, custody_type, title));
			});
		},
	});
};


// Hand seals over to a person or a location (Custody Point, e.g. Stores - TD).
// One step: custody moves as soon as this is confirmed. `onDone` runs afterwards.
window.tnt_transfer_seals = function (seals, onDone) {
	if (!seals || !seals.length) {
		frappe.msgprint(__("Select at least one seal first."));
		return;
	}
	const d = new frappe.ui.Dialog({
		title: __("Transfer {0} seal(s)", [seals.length]),
		fields: [
			{
				fieldname: "to_custody_type",
				fieldtype: "Select",
				label: __("Hand over to"),
				options: "User\nCustody Point",
				default: "User",
				reqd: 1,
				onchange() {
					const type = d.get_value("to_custody_type");
					d.set_df_property("to_user", "hidden", type !== "User");
					d.set_df_property("to_user", "reqd", type === "User");
					d.set_df_property("to_point", "hidden", type !== "Custody Point");
					d.set_df_property("to_point", "reqd", type === "Custody Point");
				},
			},
			{ fieldname: "to_user", fieldtype: "Link", options: "User", label: __("Person"), reqd: 1,
				get_query: () => ({ filters: { enabled: 1, user_type: "System User" } }) },
			{ fieldname: "to_point", fieldtype: "Link", options: "Custody Point", label: __("Location"), hidden: 1,
				get_query: () => ({ filters: { active: 1 } }) },
			{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks (Optional)") },
		],
		primary_action_label: __("Transfer"),
		primary_action(values) {
			const to = values.to_custody_type === "User" ? values.to_user : values.to_point;
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device.transfer_custody",
				args: { seals, to_custody_type: values.to_custody_type, to_custodian: to, remarks: values.remarks },
				freeze: true,
				callback(r) {
					if (!r.message) return;
					d.hide();
					frappe.show_alert({ message: __("{0} seal(s) handed to {1}", [r.message.transferred, to]), indicator: "green" });
					if (onDone) onDone(r.message);
				},
			});
		},
	});
	d.show();
};
