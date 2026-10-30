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
	'PCB Seal Management', // current title after the TNT -> PCB rename
];

frappe.router.on('change', () => {
	const route = frappe.router.current_route || [];
	if (route[0] !== 'Workspaces') return;
	if (!TNT_WORKSPACE_TITLES.includes(route[1])) return;

	frappe.route_flags.replace_route = true;
	frappe.set_route(TNT_LANDING_PAGE);
});

// Which module (TNT or RECTS) the user is working in, kept in sessionStorage so
// it survives a refresh and is per tab. Every TNT / RECTs landing page and list
// sets it on show; the Seal Device form reads it for its breadcrumb and Back
// button, so the two modules never bleed into each other's pages.
const TNT_MODULE_KEY = 'tnt_active_module';

window.tnt_set_module = function (module) {
	try {
		sessionStorage.setItem(TNT_MODULE_KEY, module);
	} catch (e) {
		// storage unavailable (private mode / blocked): callers fall back
	}
};

window.tnt_get_module = function () {
	try {
		return sessionStorage.getItem(TNT_MODULE_KEY);
	} catch (e) {
		return null;
	}
};

// Every form/list of this app's doctypes gets the module workspace as its first
// breadcrumb ("TNT Sealmanagement"). Rename it for whichever module the user is
// in: RECTs (linking to the RECTs dashboard) or PCB. The module is the one the
// landing pages remembered, falling back to the open form's own system /
// belongs_to when opened by a direct link. Frappe rebuilds the breadcrumbs on
// every route change, so watch the bar rather than patching each form.
const TNT_MODULE_CRUMBS = ['TNT Sealmanagement', 'TNT Seal Management', 'Tnt Seal Management'];

function tnt_crumb_module() {
	const remembered = window.tnt_get_module();
	if (remembered) return remembered;
	const doc = window.cur_frm && cur_frm.doc;
	return doc && (doc.system === 'RECTs' || doc.belongs_to === 'RECTs') ? 'RECTS' : 'TNT';
}

function tnt_relabel_module_crumb() {
	const $link = $('#navbar-breadcrumbs li').first().find('a');
	if (!$link.length || !TNT_MODULE_CRUMBS.includes($link.text().trim())) return;

	if (tnt_crumb_module() === 'RECTS') {
		$link.text(__('RECTs Sealmanagement')).attr('href', '/app/rects');
	} else {
		$link.text(__('PCB Seal Management'));
	}
}

$(() => {
	const bar = document.getElementById('navbar-breadcrumbs');
	if (bar) new MutationObserver(tnt_relabel_module_crumb).observe(bar, { childList: true, subtree: true });
});

// Clicking the workspace in the desk sidebar asks which system to open (TNT or
// RECTS) instead of navigating straight away. Captured on document so it runs
// before Frappe's router link handler; modified clicks (new tab etc.) and direct
// URLs still fall through to the bounce above.
const TNT_SYSTEM_CHOICES = [
	{ label: 'PCB', description: __('Seal management'), route: TNT_LANDING_PAGE },
	{ label: 'RECTs', description: __('RECTs module'), route: 'rects' },
];

function tnt_show_system_chooser() {
	const dialog = new frappe.ui.Dialog({ title: __('Choose System') });
	const $options = $('<div class="tnt-system-chooser"></div>');

	TNT_SYSTEM_CHOICES.forEach((choice) => {
		$(`
			<button type="button" class="btn btn-default btn-block text-left"
				style="padding: 16px; margin-bottom: 12px;">
				<div style="font-size: 16px; font-weight: 600;">${choice.label}</div>
				<div class="text-muted small">${choice.description}</div>
			</button>
		`)
			.on('click', () => {
				dialog.hide();
				frappe.set_route(choice.route);
			})
			.appendTo($options);
	});

	$(dialog.body).append($options);
	dialog.show();
}

document.addEventListener(
	'click',
	(e) => {
		if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
		const anchor = e.target.closest('.sidebar-item-container .item-anchor');
		if (!anchor) return;
		const name = anchor.closest('.sidebar-item-container').getAttribute('item-name');
		if (!TNT_WORKSPACE_TITLES.includes(name)) return;

		e.preventDefault();
		e.stopPropagation();
		tnt_show_system_chooser();
	},
	true
);

// /app/uffizio-geofence is the DocType's list route, which the router matches
// before any Page, so the custom "uffizio-geofence-list" page takes over by
// bouncing the list view there. Forms (/app/uffizio-geofence/<id>) are untouched.
frappe.router.on('change', () => {
	const route = frappe.router.current_route || [];
	if (route[0] !== 'List' || route[1] !== 'Uffizio Geofence') return;

	frappe.route_flags.replace_route = true;
	frappe.set_route('uffizio-geofence-list');
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

// Seal stock state on the Warehouse form: whether the seal has an ERPNext serial
// in stock. A transfer to a warehouse posts a Material Transfer, so it needs one.
const TNT_SEAL_STOCK = {
	in_stock: { color: "green", label: __("In stock"), help: __("Has a serial in stock") },
	no_stock: { color: "red", label: __("No serial in stock"), help: __("Can't be transferred to a warehouse until it is received into stock") },
	pending: { color: "yellow", label: __("Pending approval"), help: __("A transfer is waiting for a stock approver; nothing moves until it is approved") },
};

// Used by the Warehouse form: the seals whose custody is frm.doc.name, colour-
// coded by whether they have a serial in stock (see seal_device.get_warehouse_seals).
window.tnt_render_custody_seals = function (frm, custody_type, title) {
	const e = frappe.utils.escape_html;
	const $wrapper = $(frm.layout.wrapper);
	$wrapper.find(`.${TNT_CUSTODY_SEALS_CLASS}`).remove();
	if (frm.is_new()) return;

	const $box = $(`
		<div class="${TNT_CUSTODY_SEALS_CLASS} form-section card-section" style="margin-top: 15px;">
			<div class="section-head">${e(title)}</div>
			<div class="wh-seals-body text-muted">${__("Loading...")}</div>
		</div>
	`).appendTo($wrapper);

	const name = frm.doc.name;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device.get_warehouse_seals",
		args: { warehouse: name },
		callback(r) {
			// Ignore a late response after navigating to another Warehouse.
			if (frm.doc.name !== name) return;
			const rows = (r && r.message) || [];
			const $body = $box.find(".wh-seals-body");
			if (!rows.length) {
				$body.text(__("No seals are currently held in this warehouse."));
				return;
			}
			// Moving seals between warehouses is limited to System Managers (Administrator has the role).
			const can_transfer = frappe.user.has_role("System Manager");
			const stateOf = (d) => (d.pending_transfer ? "pending" : d.in_stock ? "in_stock" : "no_stock");
			const pill = (key) => {
				const p = TNT_SEAL_STOCK[key];
				return `<span class="indicator-pill ${p.color}" title="${e(p.help)}">${e(p.label)}</span>`;
			};
			const counts = {};
			rows.forEach((d) => (counts[stateOf(d)] = (counts[stateOf(d)] || 0) + 1));
			const legend = Object.keys(TNT_SEAL_STOCK)
				.map((key) => `<span class="tnt-cs-legend-item">${pill(key)} <b>${counts[key] || 0}</b> <span class="text-muted">${e(TNT_SEAL_STOCK[key].help)}</span></span>`)
				.join("");
			const tr = rows
				.map(
					(d) => `<tr class="tnt-cs-row tnt-cs-row--${stateOf(d)}">
						<td><input type="checkbox" class="tnt-cs-pick" data-seal="${e(d.name)}"></td>
						<td><a href="/app/seal-device/${encodeURIComponent(d.name)}">${e(d.seal_number || d.name)}</a></td>
						<td>${e(d.device_id || "")}</td>
						<td>${pill(stateOf(d))}${
							d.pending_transfer
								? ` <a href="/app/stock-entry/${encodeURIComponent(d.pending_transfer)}">${e(d.pending_transfer)}</a>`
								: d.stock_warehouse ? ` <span class="text-muted">${e(d.stock_warehouse)}</span>` : ""
						}</td>
						<td>${e(d.current_status || "")}</td>
						<td>${e(d.lock_status || "")}</td>
						<td>${e(d.condition || "")}</td>
						<td>${d.current_custody_since ? frappe.datetime.str_to_user(d.current_custody_since) : ""}</td>
					</tr>`
				)
				.join("");
			$body.removeClass("text-muted").html(`
				<style>
					.tnt-cs-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0 10px; font-size: 12px; }
					.tnt-cs-legend-item { display: inline-flex; align-items: center; gap: 6px; }
					.tnt-warehouse-seals .indicator-pill { white-space: nowrap; }
					.tnt-cs-row > td { white-space: nowrap; }
					.tnt-cs-row > td:first-child { border-left: 4px solid transparent; }
					.tnt-cs-row--in_stock > td:first-child { border-left-color: var(--green-500); }
					.tnt-cs-row--no_stock > td:first-child { border-left-color: var(--red-500); }
					.tnt-cs-row--pending > td:first-child { border-left-color: var(--yellow-500); }
				</style>
				<p class="text-muted">${__("{0} seal(s)", [rows.length])}
					${can_transfer ? `<button class="btn btn-xs btn-default tnt-cs-transfer" style="margin-left:10px">${__("Transfer selected")}</button>` : ""}</p>
				<div class="tnt-cs-legend">${legend}</div>
				<div class="table-responsive">
					<table class="table table-bordered table-sm">
						<thead><tr>
							<th></th><th>${__("Seal Number")}</th><th>${__("Device ID")}</th><th>${__("Stock")}</th><th>${__("Status")}</th>
							<th>${__("Lock Status")}</th><th>${__("Condition")}</th><th>${__("In Custody Since")}</th>
						</tr></thead>
						<tbody>${tr}</tbody>
					</table>
				</div>`);
			$body.find(".tnt-cs-transfer").on("click", () => {
				// dataset, not .data(): jQuery turns digit-only seal names into numbers.
				const picked = $body.find(".tnt-cs-pick:checked").map((_i, el) => el.dataset.seal).get();
				window.tnt_transfer_seals(picked, () => window.tnt_render_custody_seals(frm, custody_type, title));
			});
		},
	});
	_tnt_render_transfer_approvals(frm, $box, () => window.tnt_render_custody_seals(frm, custody_type, title));
};

// Seal Material Transfers into or out of this warehouse that are waiting for a
// stock approver, with Approve / Return For Amendment for users the Stock Entry
// workflow allows (e.g. Stock Manager). Others just see what is pending.
function _tnt_render_transfer_approvals(frm, $box, onDone) {
	const e = frappe.utils.escape_html;
	const name = frm.doc.name;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.stock_seal_transfers.get_seal_transfer_approvals",
		args: { warehouse: name },
		callback(r) {
			if (frm.doc.name !== name) return;
			const pending = (r && r.message) || [];
			if (!pending.length) return;
			const rows = pending
				.map((p) => {
					const buttons = (p.actions || [])
						.map(
							(action) =>
								`<button class="btn btn-xs ${action === "Approve" ? "btn-primary" : "btn-default"} tnt-ta-act"
									data-entry="${e(p.stock_entry)}" data-action="${e(action)}">${e(__(action))}</button>`
						)
						.join(" ");
					return `<tr>
						<td><a href="/app/stock-entry/${encodeURIComponent(p.stock_entry)}">${e(p.stock_entry)}</a></td>
						<td>${e(p.from.join(", "))} → ${e(p.to.join(", "))}</td>
						<td>${e(p.seals.join(", "))}</td>
						<td>${e(p.requested_by || "")}<div class="text-muted small">${frappe.datetime.str_to_user(p.requested_on)}</div></td>
						<td class="text-right" style="white-space:nowrap">${buttons || `<span class="text-muted">${__("Awaiting a stock approver")}</span>`}</td>
					</tr>`;
				})
				.join("");
			$(`
				<div class="tnt-ta" style="margin: 4px 0 14px;">
					<div class="section-head" style="font-size: var(--text-md);">${__("Transfers awaiting approval")}</div>
					<div class="table-responsive">
						<table class="table table-bordered table-sm">
							<thead><tr>
								<th>${__("Stock Entry")}</th><th>${__("From → To")}</th><th>${__("Seals")}</th>
								<th>${__("Requested By")}</th><th></th>
							</tr></thead>
							<tbody>${rows}</tbody>
						</table>
					</div>
				</div>
			`).insertAfter($box.find(".section-head").first());
			$box.find(".tnt-ta-act").on("click", function () {
				const entry = this.dataset.entry;
				const action = this.dataset.action;
				const message = action === "Approve"
					? __("Approve {0}? The seals' stock and custody move to the target warehouse.", [entry])
					: __("Return {0} for amendment? Nothing moves.", [entry]);
				frappe.confirm(message, () =>
					frappe.call({
						method: "tnt_seal_management.tnt_seal_management.api.stock_seal_transfers.act_on_seal_transfer",
						args: { stock_entry: entry, action },
						freeze: true,
						callback(res) {
							frappe.show_alert({ message: __("{0}: {1}", [entry, res.message]), indicator: action === "Approve" ? "green" : "orange" }, 6);
							onDone();
						},
					})
				);
			});
		},
	});
}

/* Placement view, kept for later: listed seals here by custody OR by stock and
   colour-coded whether the two agree. Needs the commented-out placement
   variant of seal_device.get_warehouse_seals.

// Seal placement on the Warehouse form: does custody (seal management) agree
// with stock (ERPNext) about the seal being in this warehouse?
const TNT_SEAL_PLACEMENT = {
	here: { color: "green", label: __("Here"), help: __("Custody and stock are both in this warehouse") },
	stock_only: { color: "orange", label: __("Stock only"), help: __("In stock here, but custody is elsewhere or not recorded") },
	custody_only: { color: "red", label: __("Custody only"), help: __("Held here by custody, but its stock is in another warehouse") },
};

// Used by the Warehouse form: the seals at frm.doc.name by custody or by stock,
// colour-coded by whether the two agree (see seal_device.get_warehouse_seals).
window.tnt_render_custody_seals = function (frm, custody_type, title) {
	const e = frappe.utils.escape_html;
	const $wrapper = $(frm.layout.wrapper);
	$wrapper.find(`.${TNT_CUSTODY_SEALS_CLASS}`).remove();
	if (frm.is_new()) return;

	const $box = $(`
		<div class="${TNT_CUSTODY_SEALS_CLASS} form-section card-section" style="margin-top: 15px;">
			<div class="section-head">${e(title)}</div>
			<div class="wh-seals-body text-muted">${__("Loading...")}</div>
		</div>
	`).appendTo($wrapper);

	const name = frm.doc.name;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device.get_warehouse_seals",
		args: { warehouse: name },
		callback(r) {
			// Ignore a late response after navigating to another Warehouse.
			if (frm.doc.name !== name) return;
			const rows = (r && r.message) || [];
			const $body = $box.find(".wh-seals-body");
			if (!rows.length) {
				$body.text(__("No seals are held in this warehouse, by custody or by stock."));
				return;
			}
			const pill = (key) => {
				const p = TNT_SEAL_PLACEMENT[key];
				return `<span class="indicator-pill ${p.color}" title="${e(p.help)}">${e(p.label)}</span>`;
			};
			const counts = {};
			rows.forEach((d) => (counts[d.placement] = (counts[d.placement] || 0) + 1));
			const legend = Object.keys(TNT_SEAL_PLACEMENT)
				.map((key) => `<span class="tnt-cs-legend-item">${pill(key)} <b>${counts[key] || 0}</b> <span class="text-muted">${e(TNT_SEAL_PLACEMENT[key].help)}</span></span>`)
				.join("");
			const tr = rows
				.map(
					(d) => `<tr class="tnt-cs-row tnt-cs-row--${e(d.placement)}">
						<td><input type="checkbox" class="tnt-cs-pick" data-seal="${e(d.name)}"></td>
						<td><a href="/app/seal-device/${encodeURIComponent(d.name)}">${e(d.seal_number || d.name)}</a></td>
						<td>${pill(d.placement)}</td>
						<td>${e(d.current_status || "")}</td>
						<td>${e(d.lock_status || "")}</td>
						<td>${e(d.condition || "")}</td>
						<td>${e(d.current_custody_label || __("Not recorded"))}</td>
						<td>${e(d.stock_warehouse || __("Not in stock"))}</td>
						<td>${d.current_custody_since ? frappe.datetime.str_to_user(d.current_custody_since) : ""}</td>
					</tr>`
				)
				.join("");
			$body.removeClass("text-muted").html(`
				<style>
					.tnt-cs-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0 10px; font-size: 12px; }
					.tnt-cs-legend-item { display: inline-flex; align-items: center; gap: 6px; }
					.tnt-warehouse-seals .indicator-pill { white-space: nowrap; }
					.tnt-cs-row > td { white-space: nowrap; }
					.tnt-cs-row > td:first-child { border-left: 4px solid transparent; }
					.tnt-cs-row--here > td:first-child { border-left-color: var(--green-500); }
					.tnt-cs-row--stock_only > td:first-child { border-left-color: var(--orange-500); }
					.tnt-cs-row--custody_only > td:first-child { border-left-color: var(--red-500); }
				</style>
				<p class="text-muted">${__("{0} seal(s)", [rows.length])}
					<button class="btn btn-xs btn-default tnt-cs-transfer" style="margin-left:10px">${__("Transfer selected")}</button></p>
				<div class="tnt-cs-legend">${legend}</div>
				<div class="table-responsive">
					<table class="table table-bordered table-sm">
						<thead><tr>
							<th></th><th>${__("Seal Number")}</th><th>${__("Placement")}</th><th>${__("Status")}</th>
							<th>${__("Lock Status")}</th><th>${__("Condition")}</th><th>${__("Custody")}</th>
							<th>${__("Stock Warehouse")}</th><th>${__("In Custody Since")}</th>
						</tr></thead>
						<tbody>${tr}</tbody>
					</table>
				</div>`);
			$body.find(".tnt-cs-transfer").on("click", () => {
				// dataset, not .data(): jQuery turns digit-only seal names into numbers.
				const picked = $body.find(".tnt-cs-pick:checked").map((_i, el) => el.dataset.seal).get();
				window.tnt_transfer_seals(picked, () => window.tnt_render_custody_seals(frm, custody_type, title));
			});
		},
	});
};
*/


// Hand seals over to a person or a seal warehouse (Branch ECTS Division or Both, e.g. Stores - TD).
// One step: custody moves as soon as this is confirmed. `onDone` runs afterwards.
window.tnt_transfer_seals = function (seals, onDone) {
	if (!seals || !seals.length) {
		frappe.msgprint(__("Select at least one seal first."));
		return;
	}
	// Warehouses and items come as plain lists: some roles that hand seals over
	// can't search the ERPNext Warehouse or Item doctypes through a Link field.
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.api.stock_seal_transfers.get_seal_transfer_options",
		args: { seals },
		callback(r) {
			_tnt_transfer_dialog(seals, r.message || {}, onDone);
		},
	});
};

function _tnt_transfer_dialog(seals, options, onDone) {
	const warehouses = options.warehouses || [];
	const d = new frappe.ui.Dialog({
		title: __("Transfer {0} seal(s)", [seals.length]),
		fields: [
			{
				fieldname: "to_custody_type",
				fieldtype: "Select",
				label: __("Hand over to"),
				options: "User\nWarehouse",
				default: "User",
				reqd: 1,
				onchange() {
					const type = d.get_value("to_custody_type");
					d.set_df_property("to_user", "hidden", type !== "User");
					d.set_df_property("to_user", "reqd", type === "User");
					d.set_df_property("to_point", "hidden", type !== "Warehouse");
					d.set_df_property("to_point", "reqd", type === "Warehouse");
					// Only a warehouse into a main store posts a Material Transfer, under an
					// item code; every other transfer is a plain handover.
					const stock = type === "Warehouse" && options.from_store
						&& (options.main_stores || []).includes(d.get_value("to_point"));
					d.set_df_property("item_code", "hidden", !stock);
					d.set_df_property("item_code", "reqd", stock);
					// Auto-fill the seals' own item code, but never over one the user
					// has picked; it stays editable either way.
					if (stock && options.default_item && !d.get_value("item_code")) {
						d.set_value("item_code", options.default_item);
					}
				},
			},
			{ fieldname: "to_user", fieldtype: "Link", options: "User", label: __("Person"), reqd: 1,
				get_query: () => ({ filters: { enabled: 1, user_type: "System User" } }) },
			{ fieldname: "to_point", fieldtype: "Select", options: ["", ...warehouses].join("\n"), label: __("Warehouse"), hidden: 1,
				onchange: () => d.fields_dict.to_custody_type.df.onchange() },
			{
				fieldname: "item_code",
				fieldtype: "Autocomplete",
				label: __("Item Code"),
				options: options.items || [],
				hidden: 1,
				description: __("Seal items are listed first. The selected seals must be stocked under this item."),
			},
			{ fieldname: "remarks", fieldtype: "Small Text", label: __("Remarks (Optional)") },
		],
		primary_action_label: __("Transfer"),
		primary_action(values) {
			const to = values.to_custody_type === "User" ? values.to_user : values.to_point;
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.doctype.seal_device.seal_device.transfer_custody",
				args: {
					seals,
					to_custody_type: values.to_custody_type,
					to_custodian: to,
					remarks: values.remarks,
					item_code: values.item_code || null,
				},
				freeze: true,
				callback(r) {
					if (!r.message) return;
					d.hide();
					const m = r.message;
					if (m.awaiting_approval) {
						frappe.msgprint({
							title: __("Sent for approval"),
							indicator: "orange",
							message: __("{0} seal(s) will move to {1} once a stock approver approves {2}. Nothing has moved yet.", [m.awaiting_approval, to, m.stock_entry])
								+ (m.transferred ? "<br>" + __("{0} seal(s) already stocked there were handed over now.", [m.transferred]) : ""),
						});
					} else {
						const stock = m.stock_entry ? __(" — stock moved by {0}", [m.stock_entry]) : "";
						frappe.show_alert({ message: __("{0} seal(s) handed to {1}", [m.transferred, to]) + stock, indicator: "green" }, 8);
					}
					if (onDone) onDone(r.message);
				},
			});
		},
	});
	d.show();
}

// Assignments <-> Journey Requests switch, shown in the page header (where the
// status chips used to be) of both list pages, styled like the Customer Billing
// Customers / Completed Journeys tabs. Each tab routes to its own page; the
// switch only appears for users allowed to open both.
const TNT_WORK_TABS = [
	['assignment-list', 'Assignments'],
	['journey-request-list', 'Journey Requests'],
];

// Roles that may open Assignments (PCB Assignment's read permission). The page
// itself also admits Field Technician, who can only work from Journey Requests.
const TNT_ASSIGNMENT_ROLES = [
	'System Manager', 'PCB Team Leader', 'Finance PCB', 'Management', 'Managing Director', 'Account Manager',
];

window.tnt_can_open_assignments = () => TNT_ASSIGNMENT_ROLES.some((role) => frappe.user.has_role(role));

window.tnt_render_work_tabs = function (wrapper, active) {
	const allowed = frappe.boot.page_info || {};
	if (!TNT_WORK_TABS.every(([name]) => allowed[name]) || !window.tnt_can_open_assignments()) return;

	tnt_inject_work_tab_styles();
	const $tabs = $(`
		<div class="tnt-work-tabs">
			${TNT_WORK_TABS.map(
				([name, label]) =>
					`<button class="tnt-work-tab ${name === active ? 'active' : ''}" data-page="${name}">${__(label)}</button>`
			).join('')}
		</div>
	`);
	$tabs.on('click', '.tnt-work-tab', function () {
		const target = $(this).data('page');
		// Stay in the system the user is working in (PCB, or /rects for RECTs).
		const rects = String(frappe.get_route()[1] || '').toLowerCase() === 'rects';
		if (target !== active) frappe.set_route(...(rects ? [target, 'rects'] : [target]));
	});
	$(wrapper).find('.page-head .page-actions').before($tabs);
};

function tnt_inject_work_tab_styles() {
	if (document.getElementById('tnt-work-tab-styles')) return;
	const style = document.createElement('style');
	style.id = 'tnt-work-tab-styles';
	style.textContent = `
		.tnt-work-tabs { display: flex; align-items: center; gap: 8px; flex: 1; padding: 0 20px; overflow-x: auto; }
		.tnt-work-tab {
			flex-shrink: 0;
			padding: 7px 18px;
			border: 1px solid rgba(14, 165, 233, .3);
			border-radius: 999px;
			background: var(--card-bg, #fff);
			color: #0369a1;
			font-weight: 700;
			font-size: 13px;
			white-space: nowrap;
			cursor: pointer;
		}
		.tnt-work-tab:hover { background: #f0f9ff; }
		.tnt-work-tab.active { background: #0284c7; border-color: #0284c7; color: #fff; }
		[data-theme="dark"] .tnt-work-tab:not(.active) { background: #1e293b; border-color: #334155; color: #7dd3fc; }
	`;
	document.head.appendChild(style);
}
