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

