const CR_QUEUE_PAGE_LENGTH = 30;

frappe.pages["control-room"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Control Room"),
		single_column: true,
	});
	page.control_room_head = $('<div class="cr-head-filters"></div>').insertBefore(
		$(wrapper).find(".page-head-content .page-actions").first()
	);

	page.control_room_state = {
		tab: "requests",
		loading: false,
		requests: [],
		requestTotal: 0,
		requestOverall: 0,
		requestPage: 1,
		arrivalTotal: 0,
		arrivalOverall: 0,
		arrivalPage: 1,
		queuePageLength: CR_QUEUE_PAGE_LENGTH,
		dialog: null,
		dialog_docname: null,
		search: "",
		from_date: "",
		to_date: "",
		alerts: [],
		alertsLoaded: false,
		alertStatus: "open",
		alertLevel: "all",
		alertType: "all",
		alertTotal: 0,
		alertFilterOptions: { levels: [], types: [] },
		alertSummary: { open: 0, critical_open: 0, unacknowledged_open: 0 },
		alertTypeGroups: [],
		alertFilterOpen: false,
		alertFilterBranch: "",
		alertPollTimer: null,
		arrivals: [],
		arrivalsLoading: false,
		arrivalsLoaded: false,
		arrivalDialog: null,
		dialog_kind: "tagging",
		journeys: [],
		journeysLoaded: false,
		journeysLoading: false,
		journeySearch: "",
		journeyView: "in_transit",
		journeySummary: {},
		journeyPage: 1,
		journeyTotal: 0,
		journeyOverall: 0,
		completedOverall: 0,
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	// One refresh for the whole page: every tab's list plus the alert filter/pills.
	page.add_inner_button(__("Refresh"), () => {
		_control_room_load_queue(page);
		_control_room_load_arrivals(page);
		_control_room_load_journeys(page);
		_control_room_load_alerts(page);
	}).addClass("cr-page-refresh-btn");

	_control_room_inject_styles();
	_control_room_render(page);
	_control_room_load_queue(page);
	_control_room_load_arrivals(page);
	_control_room_load_journeys(page);

	// Stash the page so on_page_show can re-apply a deep-link when the user
	// re-enters this already-built page from the bell.
	wrapper._cr_page = page;

	// A bell notification deep-links via ?tab=alert&alert=<name>. Frappe's
	// router strips that query into frappe.route_options and navigates to the
	// bare path, so we read it from there (not the URL). If no deep-link is
	// pending, fall back to a normal alert load (pills + filter options).
	if (!_control_room_apply_route_options(page)) _control_room_load_alerts(page);

	// Stop the alert poll if the user navigates away from this page entirely 
	// (switching tabs within the page is handled in the .cr-tab click handler).
	$(document).on("page-change", () => _control_room_stop_alert_polling(page));
};

// Fires every time the page is shown (including re-entering it from the bell),
// unlike on_page_load which only runs once when the DOM is first built.
frappe.pages["control-room"].on_page_show = function (wrapper) {
	const page = wrapper._cr_page;
	if (page) _control_room_apply_route_options(page);
};

// Consume a pending frappe.route_options deep-link (set by the global anchor
// handler from the bell's ?tab=alert&alert=<name> link). Returns true if a
// deep-link was applied — in which case it has already loaded the alerts.
function _control_room_apply_route_options(page) {
	const ro = frappe.route_options;
	if (!ro || (!ro.alert && ro.tab !== "alert")) return false;

	const state = page.control_room_state;
	const alertName = ro.alert;
	// Consume once so it can't leak into later navigations.
	frappe.route_options = null;

	state.tab = "journeys";
	_control_room_render(page);
	_control_room_load_journeys(page);
	_control_room_load_alerts(page);
	_control_room_start_alert_polling(page);
	if (alertName) {
		// Open that alert (with its Action button), whatever its status.
		frappe.call({
			method: CR_ALERT_METHOD("get_alert_queue"),
			args: { search: String(alertName), status: "all", page_length: 20 },
			callback(r) {
				const alert = ((r.message || {}).rows || []).find((a) => a.name === String(alertName));
				if (alert) _control_room_pick_alert_dialog(page, alert.seal_device, [alert]);
			},
		});
	}
	return true;
}

// Polling only runs while the Active journeys tab is showing, and only
// re-fetches — it never auto-acknowledges or mutates anything, so a Control Room
// user idling on the tab just sees the alerts refresh in the background.
const CR_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function _control_room_start_alert_polling(page) {
	_control_room_stop_alert_polling(page);
	page.control_room_state.alertPollTimer = setInterval(() => {
		if (page.control_room_state.tab !== "journeys") {
			_control_room_stop_alert_polling(page);
			return;
		}
		_control_room_load_alerts(page);
		_control_room_load_journeys(page);
	}, CR_ALERT_POLL_INTERVAL_MS);
}

function _control_room_stop_alert_polling(page) {
	if (page.control_room_state.alertPollTimer) {
		clearInterval(page.control_room_state.alertPollTimer);
		page.control_room_state.alertPollTimer = null;
	}
}

const CR_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.${name}`;

// Pills sitting beside the tabs: one per alert type ("Connectivity 48",
// "Battery 24"), worst level first. They show on every tab; clicking one filters
// the Active journeys table to seals with that type of alert.

// Alert filter dropdown: a tree with three branches (Status, Level, Type), each
// opening into its options. Picking an option filters the Active journeys table
// to the seals with matching alerts (and jumps to that tab).
function _control_room_alert_filter_html(state) {
	const esc = frappe.utils.escape_html;
	const levels = state.alertFilterOptions.levels || [];
	const types = state.alertFilterOptions.types || [];
	const all = { value: "all", label: __("All") };
	const branches = [
		{
			key: "status",
			label: __("Status"),
			current: state.alertStatus,
			fallback: "open",
			options: [
				{ value: "open", label: __("Open") },
				{ value: "resolved", label: __("Resolved") },
				all,
			],
		},
		{
			key: "level",
			label: __("Level"),
			current: state.alertLevel,
			fallback: "all",
			options: [all, ...levels.map((v) => ({ value: v, label: v }))],
		},
		{
			key: "type",
			label: __("Type"),
			current: state.alertType,
			fallback: "all",
			options: [all, ...types.map((v) => ({ value: v, label: v }))],
		},
	];
	const activeCount = branches.filter((b) => b.current !== b.fallback).length;
	// Last branch is an action, not a filter: exports the alerts matching the above.
	branches.push({
		key: "download",
		label: __("Alerts Report"),
		current: "",
		fallback: "",
		options: [
			{ value: "excel", label: __("Excel") },
			{ value: "pdf", label: __("PDF") },
		],
	});

	const tree = branches
		.map((b) => {
			const open = state.alertFilterBranch === b.key;
			const currentLabel = b.key === "download" ? "" : (b.options.find((o) => o.value === b.current) || all).label;
			const opts = b.options
				.map(
					(o) => `<button class="cr-mf-opt ${o.value === b.current ? "selected" : ""}" data-branch="${b.key}" data-value="${esc(o.value)}">
						<span class="cr-mf-check">${o.value === b.current ? "✓" : ""}</span>${esc(o.label)}
					</button>`
				)
				.join("");
			return `
				<div class="cr-mf-node ${open ? "open" : ""}">
					<button class="cr-mf-branch" data-branch="${b.key}">
						<span class="cr-mf-caret">▸</span>
						<span class="cr-mf-branch-label">${b.label}</span>
						<span class="cr-mf-branch-value">${esc(currentLabel)}</span>
					</button>
					<div class="cr-mf-children">${opts}</div>
				</div>`;
		})
		.join("");

	return `
		<button class="cr-mf-toggle ${activeCount ? "has-filters" : ""}">
			${__("Alert filter")}
			${activeCount ? `<span class="cr-mf-active">${activeCount}</span>` : ""}
			<span class="cr-mf-caret-down">▾</span>
		</button>
		<div class="cr-mf-menu ${state.alertFilterOpen ? "open" : ""}">${tree}</div>
	`;
}

function _control_room_info_pills_html(state) {
	const groups = state.alertTypeGroups || [];
	if (!groups.length) return "";

	return groups
		.map((group) => {
			const levelClass = (group.level || "info").toLowerCase();
			const label = frappe.utils.escape_html(group.label || "");
			return `<button class="cr-info-pill cr-info-pill--${levelClass}" data-cr-group="${label}"
				title="${__("Show {0} alerts", [label])}">
					<span class="cr-info-pill-label">${label}</span>
					<span class="cr-info-pill-count">${group.count || 0}</span>
				</button>`;
		})
		.join("");
}

// Alert filter + type pills live in the page header (between the title and the
// Dashboard / Refresh buttons), so they stay put across tabs and re-renders.
function _control_room_download_html() {
	return `
		<div class="cr-alert-download-dropdown">
			<button class="cr-alert-download-btn">
				${__("Download Report")}
				<span class="cr-alert-download-arrow">&#9662;</span>
			</button>
			<div class="cr-alert-download-menu">
				<div class="cr-alert-download-item" data-format="excel">${__("Excel")}</div>
				<div class="cr-alert-download-item" data-format="pdf">${__("PDF")}</div>
			</div>
		</div>
	`;
}

function _control_room_render_head(page) {
	const state = page.control_room_state;
	page.control_room_head.html(`
		<div class="cr-mf" data-cr-alert-filter>${_control_room_alert_filter_html(state)}</div>
		<div class="cr-info-pills" data-cr-info-pills>${_control_room_info_pills_html(state)}</div>
	`);
}

function _control_room_render(page) {
	const state = page.control_room_state;
	_control_room_render_head(page);
	$(page.body).html(`
		<div class="cr-page">
			<section class="cr-panel">
				<div class="cr-tabs">
					<button class="cr-tab ${state.tab === "requests" ? "active" : ""}" data-tab="requests">
						${__("Journey requests")}
						<span class="cr-tab-count" data-cr-request-count>${state.requestOverall || 0}</span>
					</button>
					<button class="cr-tab ${state.tab === "arrivals" ? "active" : ""}" data-tab="arrivals">
						${__("Arrivals")}
						<span class="cr-tab-count" data-cr-arrival-count>${state.arrivalOverall || 0}</span>
					</button>
					<button class="cr-tab ${state.tab === "journeys" ? "active" : ""}" data-tab="journeys">
						${__("Active journeys")}
						<span class="cr-tab-count" data-cr-journey-count>${state.journeyOverall || 0}</span>
					</button>
					<button class="cr-tab ${state.tab === "completed" ? "active" : ""}" data-tab="completed">
						${__("Completed journeys")}
						<span class="cr-tab-count" data-cr-completed-count>${state.completedOverall || 0}</span>
					</button>
					<div class="cr-tabs-end">
						<label class="cr-date-field">
							<span>${__("From")}</span>
							<input class="cr-from-date" type="date" value="${frappe.utils.escape_html(state.from_date || "")}">
						</label>
						<label class="cr-date-field">
							<span>${__("To")}</span>
							<input class="cr-to-date" type="date" value="${frappe.utils.escape_html(state.to_date || "")}">
						</label>
						<button class="cr-clear-btn cr-clear-all-btn" title="${__("Clear every filter on every tab")}">${__("Clear")}</button>
					</div>
				</div>
				<div class="cr-toolbar" style="display: ${state.tab === "requests" || state.tab === "arrivals" ? "block" : "none"}">
					<div class="cr-toolbar-top">
						<label class="cr-field cr-search-inline">
							<input class="cr-search" type="search" placeholder="${__("Journey, client, job order, entry, container, vehicle, seal or technician")}" value="${frappe.utils.escape_html(state.search || "")}">
						</label>
						<div class="cr-actions">
							${_control_room_download_html()}
						</div>
					</div>
				</div>
				<div class="cr-toolbar" style="display: ${_cr_is_journey_tab(state) ? "block" : "none"}">
					<div class="cr-toolbar-top">
						<label class="cr-field" style="display: ${state.tab === "journeys" ? "flex" : "none"}">
							<select class="cr-journey-view" aria-label="${__("Journey Status")}" title="${__("Journey Status")}">
								${_control_room_journey_view_options(state)}
							</select>
						</label>
						<label class="cr-field cr-search-inline cr-journey-search-field">
							<input class="cr-journey-search" type="search" placeholder="${__("Journey, client, vehicle, seal, entry, container, origin or destination")}" value="${frappe.utils.escape_html(state.journeySearch || "")}">
						</label>
						<div class="cr-actions">
							${_control_room_download_html()}
						</div>
					</div>
				</div>
				<div class="cr-tab-body" data-cr-body></div>
			</section>
		</div>
	`);

	const delayedSearch = _cr_debounce(() => {
		page.control_room_state.search = ($(page.body).find(".cr-search").val() || "").trim();
		_control_room_reload_approve(page);
	}, 350);

	$(page.body)
		.off("input", ".cr-search")
		.on("input", ".cr-search", delayedSearch);

	$(page.body)
		.off("change", ".cr-from-date, .cr-to-date")
		.on("change", ".cr-from-date, .cr-to-date", function () {
			page.control_room_state.from_date = $(page.body).find(".cr-from-date").val() || "";
			page.control_room_state.to_date = $(page.body).find(".cr-to-date").val() || "";
			page.control_room_state.journeyPage = 1;
			// The dates apply to every tab, so reload every list.
			_control_room_reload_approve(page);
			_control_room_load_journeys(page);
		});

	$(page.body)
		.off("click", ".cr-clear-btn")
		.on("click", ".cr-clear-btn", function () {
			// One reset for every tab: searches, the shared dates, journey status and
			// the header Alert filter.
			Object.assign(page.control_room_state, {
				search: "",
				from_date: "",
				to_date: "",
				journeySearch: "",
				journeyView: "in_transit",
				journeyPage: 1,
				alertStatus: "open",
				alertLevel: "all",
				alertType: "all",
				alertFilterOpen: false,
			});
			_control_room_render(page);
			_control_room_reload_approve(page);
			_control_room_load_journeys(page);
		});

	const delayedJourneySearch = _cr_debounce(() => {
		page.control_room_state.journeySearch = ($(page.body).find(".cr-journey-search").val() || "").trim();
		page.control_room_state.journeyPage = 1;
		_control_room_load_journeys(page);
	}, 350);
	$(page.body).off("input", ".cr-journey-search").on("input", ".cr-journey-search", delayedJourneySearch);
	$(page.body)
		.off("click", ".cr-journey-page-btn")
		.on("click", ".cr-journey-page-btn", function () {
			const nextPage = Number($(this).data("page"));
			if (!nextPage || nextPage === page.control_room_state.journeyPage) return;
			page.control_room_state.journeyPage = nextPage;
			_control_room_load_journeys(page);
		});

	$(page.body)
		.off("click", ".cr-tab")
		.on("click", ".cr-tab", function () {
			const tab = $(this).data("tab");
			if (!tab || tab === page.control_room_state.tab) return;
			page.control_room_state.tab = tab;
			_control_room_render(page);
			_control_room_render_body(page);
			// Journeys and Completed share the list, search and dates; reload for the new view.
			if (_cr_is_journey_tab(page.control_room_state)) {
				page.control_room_state.journeyPage = 1;
				_control_room_load_journeys(page);
			}
			if (tab === "journeys") {
				if (!page.control_room_state.alertsLoaded) _control_room_load_alerts(page);
				_control_room_start_alert_polling(page);
			} else {
				_control_room_stop_alert_polling(page);
			}
		});

	const refreshAlertFilter = () => _control_room_render_head(page);
	const $head = page.control_room_head;

	$head
		.off("click", ".cr-mf-toggle")
		.on("click", ".cr-mf-toggle", function (e) {
			e.stopPropagation();
			const state = page.control_room_state;
			state.alertFilterOpen = !state.alertFilterOpen;
			refreshAlertFilter();
		});

	$head
		.off("click", ".cr-mf-branch")
		.on("click", ".cr-mf-branch", function (e) {
			e.stopPropagation();
			const state = page.control_room_state;
			const key = $(this).data("branch");
			state.alertFilterBranch = state.alertFilterBranch === key ? "" : key;
			refreshAlertFilter();
		});

	$head
		.off("click", ".cr-mf-opt")
		.on("click", ".cr-mf-opt", function (e) {
			e.stopPropagation();
			const state = page.control_room_state;
			const value = String($(this).attr("data-value"));
			const branch = $(this).data("branch");
			if (branch === "download") {
				state.alertFilterOpen = false;
				refreshAlertFilter();
				if (value === "excel") _control_room_export_alerts_excel(page);
				else _control_room_export_alerts_pdf(page);
				return;
			}
			if (branch === "status") state.alertStatus = value;
			else if (branch === "level") state.alertLevel = value;
			else if (branch === "type") state.alertType = value;
			_control_room_apply_alert_filter(page);
		});

	$(document)
		.off("click.cr-alert-filter")
		.on("click.cr-alert-filter", (e) => {
			const state = page.control_room_state;
			if (!state.alertFilterOpen || $(e.target).closest(".cr-mf").length) return;
			state.alertFilterOpen = false;
			refreshAlertFilter();
		});

	$head
		.off("click", ".cr-info-pill")
		.on("click", ".cr-info-pill", function () {
			const group = $(this).attr("data-cr-group");
			if (!group) return;
			const state = page.control_room_state;
			// Toggle: clicking the active pill clears the filter again.
			state.alertType = state.alertType === String(group) ? "all" : String(group);
			state.alertStatus = "open";
			_control_room_apply_alert_filter(page);
		});

	$(page.body)
		.off("click", ".cr-alert-download-btn")
		.on("click", ".cr-alert-download-btn", function (e) {
			e.stopPropagation();
			const $menu = $(this).siblings(".cr-alert-download-menu");
			const wasOpen = $menu.hasClass("open");
			$(page.body).find(".cr-alert-download-menu").removeClass("open");
			if (!wasOpen) {
				const rect = this.getBoundingClientRect();
				$menu.css({ top: rect.bottom + 6, left: rect.left }).addClass("open");
			}
		});

	$(page.body)
		.off("click", ".cr-alert-download-item")
		.on("click", ".cr-alert-download-item", function () {
			$(page.body).find(".cr-alert-download-menu").removeClass("open");
			_control_room_export_current_tab(page, $(this).data("format"));
		});

	$(document)
		.off("click.cr-download-dropdown")
		.on("click.cr-download-dropdown", () => {
			$(page.body).find(".cr-alert-download-menu").removeClass("open");
		});

	$(page.body)
		.off("click", ".cr-queue-page-btn")
		.on("click", ".cr-queue-page-btn", function () {
			const state = page.control_room_state;
			const nextPage = Number($(this).data("page"));
			const kind = $(this).data("kind");
			if (!nextPage) return;
			if (kind === "arrivals") {
				if (nextPage === state.arrivalPage) return;
				state.arrivalPage = nextPage;
				_control_room_load_arrivals(page);
			} else {
				if (nextPage === state.requestPage) return;
				state.requestPage = nextPage;
				_control_room_load_queue(page);
			}
		});

	$(page.body)
		.off("change", ".cr-journey-view")
		.on("change", ".cr-journey-view", function () {
			page.control_room_state.journeyView = $(this).val() || "in_transit";
			page.control_room_state.journeyPage = 1;
			_control_room_load_journeys(page);
		});

	$(page.body)
		.off("click", ".cr-seals-btn")
		.on("click", ".cr-seals-btn", function () {
			const j = (page.control_room_state.journeys || []).find((x) => x.name === this.dataset.journey);
			if (j) _control_room_show_journey_seals(j);
		});

	$(page.body)
		.off("click", ".cr-journey-alerts-btn")
		.on("click", ".cr-journey-alerts-btn", function () {
			_control_room_open_seal_alerts(page, this.dataset.device);
		});

	$(page.body)
		.off("click", ".cr-arrival-open")
		.on("click", ".cr-arrival-open", function () {
			const docname = $(this).data("name");
			const journey = (page.control_room_state.arrivals || []).find((row) => row.name === docname);
			if (journey) _control_room_open_arrival_dialog(page, journey);
		});

	$(document)
		.off("click.controlRoomArrival", ".cr-arrival-unlock-btn")
		.on("click.controlRoomArrival", ".cr-arrival-unlock-btn", function () {
			const $btn = $(this);
			const docname = $btn.data("name");
			const method = $btn.data("method");
			if (!docname || !method) return;
			_control_room_confirm_arrival(page, docname, method, $btn);
		});

	_control_room_bind_actions(page);
	_control_room_render_body(page);
}

function _control_room_render_body(page) {
	const state = page.control_room_state;
	const $body = $(page.body).find("[data-cr-body]");

	if (_cr_is_journey_tab(state)) {
		if (state.journeysLoading && !state.journeys.length) {
			$body.html(`<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading journeys…")}</div>`);
			return;
		}
		if (!state.journeys.length) {
			const filtered =
				state.journeySearch ||
				state.from_date ||
				state.to_date ||
				state.alertStatus !== "open" ||
				state.alertLevel !== "all" ||
				state.alertType !== "all";
			$body.html(`
				<div class="cr-empty">
					<div class="cr-empty-icon">🚚</div>
					<h3>${filtered ? __("No matching journeys") : state.tab === "completed" ? __("No completed journeys") : __("No journeys in transit")}</h3>
					<p>${filtered ? __("Try a different search term, date range or alert filter.") : __("Journeys appear here once tagging is completed and they are In Transit.")}</p>
				</div>
			`);
			return;
		}
		$body.html(`
			<div class="cr-table-wrap cr-alert-table-wrap cr-journey-table-wrap ${state.tab === "completed" ? "cr-journey-table-wrap--completed" : ""}">${_control_room_journey_table(state.journeys, state.tab === "completed")}</div>
			${_control_room_journey_pagination(state)}
		`);
		return;
	}

	const filtersActive = !!(state.search || state.from_date || state.to_date);

	if (state.tab === "arrivals") {
		if (state.arrivalsLoading && !state.arrivals.length) {
			$body.html(`<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading arrivals…")}</div>`);
			return;
		}
		if (!state.arrivals.length) {
			$body.html(
				state.arrivalOverall && filtersActive
					? `<div class="cr-empty">
						<div class="cr-empty-icon">🔍</div>
						<h3>${__("No matching arrivals found")}</h3>
						<p>${__("Try clearing filters or adjusting your search term.")}</p>
					</div>`
					: `<div class="cr-empty">
						<h3>${__("No arrivals awaiting confirmation")}</h3>
						<p>${__("When a journey arrives, it appears here so you can confirm the seal was unlocked.")}</p>
					</div>`
			);
			return;
		}
		$body.html(_control_room_arrivals_section_html(state));
		return;
	}

	if (state.loading) {
		$body.html(`<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading journey requests…")}</div>`);
		return;
	}

	if (!state.requests.length) {
		$body.html(
			state.requestOverall && filtersActive
				? `<div class="cr-empty">
					<div class="cr-empty-icon">🔍</div>
					<h3>${__("No matching requests found")}</h3>
					<p>${__("Try clearing filters or adjusting your search term.")}</p>
				</div>`
				: `<div class="cr-empty">
					<h3>${__("Nothing awaiting approval")}</h3>
					<p>${__("When a Tag Operator submits a seal journey for checking, it appears here for your review.")}</p>
				</div>`
		);
		return;
	}

	$body.html(`
		<div class="cr-table-wrap cr-queue-scroll">${_control_room_request_table(state.requests, "tagging")}</div>
		${_control_room_queue_pagination(state.requestTotal, state.requestPage, state.queuePageLength, "requests")}
	`);
}

function _control_room_queue_pagination(total, currentPage, pageLength, kind) {
	const totalPages = Math.max(1, Math.ceil(total / pageLength));
	const current = Math.min(Math.max(currentPage || 1, 1), totalPages);
	const firstRow = total ? (current - 1) * pageLength + 1 : 0;
	const lastRow = Math.min(current * pageLength, total);
	return `
		<div class="cr-alert-pagination">
			<span class="cr-alert-page-summary">${__("Showing {0}-{1} of {2}", [firstRow, lastRow, total])}</span>
			<div class="cr-alert-page-actions">
				<button class="cr-alert-page-btn cr-queue-page-btn" data-kind="${kind}" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>${__("Previous")}</button>
				<span>${__("Page {0} of {1}", [current, totalPages])}</span>
				<button class="cr-alert-page-btn cr-queue-page-btn" data-kind="${kind}" data-page="${current + 1}" ${current === totalPages ? "disabled" : ""}>${__("Next")}</button>
			</div>
		</div>
	`;
}

function _control_room_arrivals_section_html(state) {
	if (state.arrivalsLoading) {
		return `<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading arrivals…")}</div>`;
	}
	const arrivals = state.arrivals || [];
	if (!arrivals.length) return "";

	return `
		<section class="cr-arrivals">
			<h3 class="cr-section-title">${__("Arrivals — Confirm Seal Unlocked")}</h3>
			<div class="cr-arrival-table-wrap cr-arrival-scroll">
				<table class="cr-arrival-table">
					<thead>
						<tr>
							<th>${__("Journey")}</th>
							<th>${__("Vehicle")}</th>
							<th>${__("Seal Device")}</th>
							<th>${__("Last Location")}</th>
							<th class="cr-arrival-action-col">${__("Action")}</th>
						</tr>
					</thead>
					<tbody>${arrivals.map(_control_room_arrival_row).join("")}</tbody>
				</table>
			</div>
			${_control_room_queue_pagination(state.arrivalTotal, state.arrivalPage, state.queuePageLength, "arrivals")}
		</section>
	`;
}

function _control_room_arrival_row(journey) {
	return `
		<tr>
			<td class="cr-arrival-journey">${frappe.utils.escape_html(journey.name)}</td>
			<td>${frappe.utils.escape_html(journey.vehicle_plate_number || "—")}</td>
			<td>${frappe.utils.escape_html(journey.assigned_seal || "—")}</td>
			<td class="cr-arrival-location">${_cr_location_html(journey)}</td>
			<td class="cr-arrival-action-col">
				<button class="cr-arrival-open" data-name="${frappe.utils.escape_html(journey.name)}">${__("View")}</button>
			</td>
		</tr>
	`;
}

function _control_room_open_arrival_dialog(page, journey) {
	const state = page.control_room_state;
	if (state.arrivalDialog) {
		state.arrivalDialog.hide();
		state.arrivalDialog.$wrapper.remove();
	}

	const dialog = new frappe.ui.Dialog({
		title: __("Arrival — {0}", [journey.name]),
		size: "large",
	});
	dialog.$body.html(_control_room_arrival_card(journey));
	dialog.$wrapper.addClass("cr-arrival-dialog");
	dialog.$wrapper.on("hidden.bs.modal", () => {
		if (state.arrivalDialog === dialog) state.arrivalDialog = null;
		dialog.$wrapper.remove();
	});
	state.arrivalDialog = dialog;
	dialog.show();
}

function _control_room_arrival_card(journey) {
	const route = `${frappe.utils.escape_html(journey.origin || "—")} → ${frappe.utils.escape_html(journey.destination || "—")}`;
	const started = journey.journey_start_date_time
		? frappe.datetime.str_to_user(journey.journey_start_date_time)
		: "—";
	const lastSeen = journey.api_last_update_time
		? frappe.datetime.str_to_user(journey.api_last_update_time)
		: "—";

	return `
		<article class="cr-arrival" data-name="${frappe.utils.escape_html(journey.name)}">
			<header class="cr-arrival-head">
				<span class="cr-req-id">${frappe.utils.escape_html(journey.name)}</span>
				<span class="cr-arrival-status">${__("In Transit")}</span>
			</header>
			<div class="cr-meta">
				${_cr_meta(__("Customer"), frappe.utils.escape_html(journey.customer || "—"))}
				${_cr_meta(__("Vehicle"), frappe.utils.escape_html(journey.vehicle_plate_number || "—"))}
				${_cr_meta(__("Container"), frappe.utils.escape_html(journey.container_number || "—"))}
				${_cr_meta(__("Seal Device"), frappe.utils.escape_html(journey.assigned_seal || "—"))}
				${_cr_meta(__("Route"), route, true)}
				${_cr_meta(__("Last Known Location"), _cr_location_html(journey), true)}
				${_cr_meta(__("Journey Started"), started)}
				${_cr_meta(__("Last API Update"), lastSeen)}
			</div>
			<footer class="cr-arrival-actions">
				<div class="cr-arrival-unlock-prompt">${__("Confirm arrival — how is the seal unlocked?")}</div>
				<div class="cr-arrival-unlock-buttons">
					<button class="cr-arrival-unlock-btn cr-arrival-unlock-btn--physical" data-name="${frappe.utils.escape_html(journey.name)}" data-method="physical">
						${__("Physical Unlock — Send for Untagging")}
					</button>
					<button class="cr-arrival-unlock-btn cr-arrival-unlock-btn--remote" data-name="${frappe.utils.escape_html(journey.name)}" data-method="remote">
						${__("Remote Unlock — Skip to Seal Return")}
					</button>
					<button class="cr-arrival-unlock-btn cr-arrival-unlock-btn--retained" data-name="${frappe.utils.escape_html(journey.name)}" data-method="remote_retained">
						${__("Remote Unlock — Seal Stays on Vehicle")}
					</button>
					<button class="cr-arrival-unlock-btn cr-arrival-unlock-btn--end" data-name="${frappe.utils.escape_html(journey.name)}" data-method="end_journey">
						${__("End Journey")}
					</button>
				</div>
			</footer>
		</article>
	`;
}

function _control_room_confirm_arrival(page, docname, method, $btn) {
	// Four ways an arrival closes out, picked by the Control Room on the call:
	// physical untagging, remote unlock with the seal collected from the client,
	// or remote unlock at a destination too far to collect from — where the seal
	// rides home on the vehicle and the journey ends right here.
	const messages = {
		physical: __(
			"Confirm arrival for {0} with a PHYSICAL unlock? An untagging assignment will be raised for the PCB Team Leader to assign a Tag Operator. Location will be captured live from the seal's GPS. This cannot be undone.",
			[docname]
		),
		remote: __(
			"Confirm arrival for {0} with a REMOTE unlock? Untagging will be skipped and a seal return assignment will be raised for the PCB Team Leader to assign a Tag Operator. Location will be captured live from the seal's GPS. This cannot be undone.",
			[docname]
		),
		remote_retained: __(
			"Confirm arrival for {0} with a REMOTE unlock and the seal LEFT ON THE VEHICLE?",
			[docname]
		),
		end_journey: __("End {0} now?", [docname]),
	};
	const notes = {
		physical: __("{0}: arrival confirmed (physical unlock) — sent for untagging", [docname]),
		remote: __("{0}: arrival confirmed (remote unlock) — sent for seal return", [docname]),
		remote_retained: __(
			"{0}: arrival confirmed (remote unlock, seal retained) — journey completed, seal released for re-tagging",
			[docname]
		),
		end_journey: __(
			"{0}: journey ended — no collection at destination, seal released, custody retained by customer",
			[docname]
		),
	};
	const message = messages[method] || messages.physical;

	frappe.confirm(message, () => {
		$btn.prop("disabled", true);
		frappe.call({
			method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.confirm_arrival",
			args: { docname, unlock_method: method },
			freeze: true,
			freeze_message: __("Confirming arrival…"),
			callback() {
				const note = notes[method] || notes.physical;
				frappe.show_alert({ message: note, indicator: "green" }, 6);
				page.control_room_state.arrivalDialog?.hide();
				_control_room_load_arrivals(page);
			},
			error() {
				$btn.prop("disabled", false);
			},
		});
	});
}

function _cr_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _control_room_request_table(requests, kind = "tagging") {
	const rows = requests
		.map((req) => {
			let clientHtml = frappe.utils.escape_html(req.client_name || "—");
			if (req.client_name) {
				const words = req.client_name.split(" ");
				if (words.length > 3) {
					const truncated = words.slice(0, 3).join(" ") + "...";
					clientHtml = `<span title="${frappe.utils.escape_html(req.client_name)}">${frappe.utils.escape_html(truncated)}</span>`;
				}
			}

			const sealSerialNumbers = (req.seals || [])
				.map((s) => s.seal_number)
				.filter(Boolean)
				.join(", ") || "—";

			return `
				<tr class="cr-row" data-name="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
					<td>${clientHtml}</td>
					<td>${frappe.utils.escape_html(req.vehicle || "—")}</td>
					<td>${frappe.utils.escape_html(sealSerialNumbers)}</td>
					<td>${frappe.utils.escape_html(req.origin || "—")}</td>
					<td>${frappe.utils.escape_html(req.destination || "—")}</td>
					<td class="text-right">
						<button class="cr-open" data-docname="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
							${__("Open")}
						</button>
					</td>
				</tr>
			`;
		})
		.join("");

	return `
		<table class="cr-queue-table">
			<thead>
				<tr>
					<th>${__("Client Name")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Seal Serial Number(s)")}</th>
					<th>${__("Origin")}</th>
					<th>${__("Destination")}</th>
					<th class="text-right">${__("Action")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

const CR_REQUEST_STATUS_LABEL = {
	tagging: () => __("Pending Control Room Approval"),
};

function _control_room_request_card(req, kind = "tagging") {
	const seals = req.seals || [];
	const sealNumberByDevice = {};
	seals.forEach((s) => {
		if (s.seal_device) sealNumberByDevice[s.seal_device] = s.seal_number || s.seal_device;
	});
	const statusLabel = (CR_REQUEST_STATUS_LABEL[kind] || CR_REQUEST_STATUS_LABEL.tagging)();
	const vehicles = req.vehicles || [];
	const multiVehicle = vehicles.length > 1;
	const vehicleBlock = vehicles.length ? _control_room_vehicle_block(vehicles) : "";
	// On a multi-vehicle request each seal names the vehicle it is fitted to, so
	// the Control Room can match seals to the vehicle they're approving.
	const vehicleLabelFor = multiVehicle ? _cr_seal_vehicle_labels(vehicles) : null;
	const orderedSeals = _cr_order_seals_with_subseals(seals);
	const sealRows = orderedSeals.length
		? orderedSeals.map((s) => _control_room_seal_row(s, sealNumberByDevice, vehicleLabelFor)).join("")
		: `<tr><td colspan="${multiVehicle ? 8 : 7}" class="cr-seal-empty">${__("No seals on this request")}</td></tr>`;

	return `
		<article class="cr-req" data-req="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
			<header class="cr-req-head">
				<div>
					<span class="cr-req-id">${frappe.utils.escape_html(req.name)}</span>
					<span class="cr-req-status">${statusLabel}</span>
				</div>
				<div class="cr-req-client">${frappe.utils.escape_html(req.client_name || "—")}</div>
			</header>

			<div class="cr-meta">
				${_cr_meta(__("Tag Operator"), req.assigned_technician_name || "—")}
				${_cr_meta(__("Job Order"), req.job_order || "—")}
				${_cr_meta(__("Vehicle"), req.vehicle || "—")}
				${_cr_meta(__("Driver"), req.driver_contact || "—")}
				${_cr_meta(__("Route"), `${frappe.utils.escape_html(req.origin || "—")} → ${frappe.utils.escape_html(req.destination || "—")}`, true)}
				${_cr_meta(__("Entry / Container"), `${frappe.utils.escape_html(req.entry_number || "—")} / ${frappe.utils.escape_html(req.container_number || "—")}`, true)}
			</div>

			${vehicleBlock}

			<div class="cr-seal-wrap">
				<table class="cr-seal-table">
					<thead>
						<tr>
							${multiVehicle ? `<th>${__("Vehicle")}</th>` : ""}
							<th>${__("Seal")}</th>
							<th>${__("Relationship")}</th>
							<th>${__("Lock")}</th>
							<th>${__("Device Status")}</th>
							<th>${__("Battery")}</th>
							<th>${__("Location")}</th>
							<th>${__("Last Update")}</th>
						</tr>
					</thead>
					<tbody>${sealRows}</tbody>
				</table>
			</div>

			<footer class="cr-req-actions">
				<button class="cr-act cr-act--refresh" data-act="refresh">${__("Refresh Seal Status")}</button>
				<div class="cr-req-actions-right">
					<button class="cr-act cr-act--reject" data-act="return_amend">${multiVehicle ? __("Return All Pending") : __("Return for Amendment")}</button>
					<button class="cr-act cr-act--approve" data-act="approve">${multiVehicle ? __("Approve All Pending") : __("Approve")}</button>
				</div>
			</footer>
		</article>
	`;
}

function _control_room_vehicle_block(vehicles) {
	const rows = vehicles
		.map((v) => {
			const label = frappe.utils.escape_html(v.registration_number || v.vehicle || v.name);
			const pending = v.status === "Pending Control Room Approval";
			const state = pending
				? `<span class="cr-pill cr-pill--warn">${__("Pending")}</span>`
				: v.status === "Draft"
				? `<span class="cr-pill cr-pill--muted">${__("Returned")}</span>`
				: `<span class="cr-pill cr-pill--ok">${__("Approved")}</span>`;
			const actions = pending
				? `<button class="cr-act cr-act--reject" data-act="return_vehicle" data-vehicle-row="${frappe.utils.escape_html(v.name)}" data-vehicle-label="${label}">${__("Return")}</button>
				   <button class="cr-act cr-act--approve" data-act="approve_vehicle" data-vehicle-row="${frappe.utils.escape_html(v.name)}" data-vehicle-label="${label}">${__("Approve")}</button>`
				: "";
			return `<tr><td>${label}</td><td>${state}</td><td class="cr-vehicle-actions">${actions}</td></tr>`;
		})
		.join("");
	return `
		<div class="cr-seal-wrap">
			<table class="cr-seal-table">
				<thead><tr><th>${__("Vehicle")}</th><th>${__("Status")}</th><th></th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>
	`;
}

function _cr_meta(label, value, wide) {
	return `
		<div class="cr-meta-item ${wide ? "cr-meta-item--wide" : ""}">
			<span class="cr-meta-label">${label}</span>
			<span class="cr-meta-value">${value}</span>
		</div>
	`;
}

// A seal's `vehicle` holds whichever label the technician picked for it — the
// plate, the Vehicle name or (rarely) the vehicle row name; show the plate.
function _cr_seal_vehicle_labels(vehicles) {
	const byKey = {};
	vehicles.forEach((v) => {
		const label = v.registration_number || v.vehicle || v.name;
		[v.name, v.vehicle, v.registration_number].filter(Boolean).forEach((key) => (byKey[key] = label));
	});
	return (value) => (value ? byKey[value] || value : "");
}

function _control_room_seal_row(seal, sealNumberByDevice = {}, vehicleLabelFor = null) {
	const lock = seal.lock_status || "—";
	const lockClass =
		lock === "Locked" ? "cr-pill--ok" : lock === "Unlocked" ? "cr-pill--warn" : "cr-pill--muted";

	const battery = _cr_battery(seal.battery_level);
	const lastUpdate = seal.api_last_update_time
		? frappe.datetime.str_to_user(seal.api_last_update_time)
		: "—";

	const isSubSeal = !!seal.parent_seal;
	const parentLabel = isSubSeal
		? sealNumberByDevice[seal.parent_seal] || seal.parent_seal
		: null;
	const relationship = isSubSeal
		? `<span class="cr-pill cr-pill--sub">${__("Sub-seal of {0}", [frappe.utils.escape_html(parentLabel)])}</span>`
		: `<span class="cr-pill cr-pill--parent">${__("Parent Seal")}</span>`;

	return `
		<tr class="${isSubSeal ? "cr-seal-row--sub" : ""}">
			${vehicleLabelFor ? `<td>${frappe.utils.escape_html(vehicleLabelFor(seal.vehicle) || "—")}</td>` : ""}
			<td>
				<div class="cr-seal-no">${isSubSeal ? "↳ " : ""}${frappe.utils.escape_html(seal.seal_number || seal.seal_device || "—")}</div>
				<div class="cr-seal-dev">${frappe.utils.escape_html(seal.seal_device || "")}</div>
			</td>
			<td>${relationship}</td>
			<td><span class="cr-pill ${lockClass}">${frappe.utils.escape_html(lock)}</span></td>
			<td>${frappe.utils.escape_html(seal.api_device_status || "—")}</td>
			<td><span class="cr-batt ${battery.cls}">${battery.label}</span></td>
			<td class="cr-seal-loc">${frappe.utils.escape_html(seal.api_location || "—")}</td>
			<td>${frappe.utils.escape_html(lastUpdate)}</td>
		</tr>
	`;
}

function _cr_order_seals_with_subseals(seals) {
	// Lists each parent seal followed immediately by its sub-seals, so the
	// approver can see lock relationships without hunting through the table.
	const byParentDevice = {};
	const topLevel = [];
	seals.forEach((s) => {
		if (s.parent_seal) {
			byParentDevice[s.parent_seal] = byParentDevice[s.parent_seal] || [];
			byParentDevice[s.parent_seal].push(s);
		} else {
			topLevel.push(s);
		}
	});

	const ordered = [];
	topLevel.forEach((parent) => {
		ordered.push(parent);
		(byParentDevice[parent.seal_device] || []).forEach((child) => ordered.push(child));
	});

	// Sub-seals whose parent isn't on this request (shouldn't normally happen)
	// still need to be shown, so append any leftovers.
	const includedChildren = new Set(ordered.filter((s) => s.parent_seal).map((s) => s.seal_device));
	Object.values(byParentDevice)
		.flat()
		.forEach((child) => {
			if (!includedChildren.has(child.seal_device)) ordered.push(child);
		});

	return ordered;
}

function _cr_battery(raw) {
	const value = parseInt(raw, 10);
	if (Number.isNaN(value) || value < 0 || value > 100) {
		// Sensors sometimes report sentinel values like 255 — treat as unknown.
		return { label: "—", cls: "cr-batt--muted" };
	}
	let cls = "cr-batt--ok";
	if (value <= 20) cls = "cr-batt--low";
	else if (value <= 50) cls = "cr-batt--mid";
	return { label: `${value}%`, cls };
}

function _control_room_bind_actions(page) {
	// Approve/Return for Amendment/Refresh buttons only render inside a frappe.ui.Dialog,
	// which Frappe mounts under document.body rather than page.body — so the
	// click delegation for them must live on document, not page.body.
	$(document)
		.off("click", ".cr-act")
		.on("click", ".cr-act", function () {
			const $card = $(this).closest(".cr-req, .cr-modal-card");
			const docname = $card.data("req");
			const kind = $card.data("kind") || "tagging";
			const act = $(this).data("act");
			if (!docname || !act) return;

			const vehicleRow = $(this).data("vehicle-row") || null;
			const vehicleLabel = $(this).data("vehicle-label") || null;

			if (act === "refresh") _control_room_refresh_seals(page, docname);
			else if (act === "approve") _control_room_approve(page, docname, kind);
			else if (act === "return_amend") _control_room_return_for_amendment(page, docname, kind);
			else if (act === "approve_vehicle")
				_control_room_approve(page, docname, kind, vehicleRow, vehicleLabel);
			else if (act === "return_vehicle")
				_control_room_return_for_amendment(page, docname, kind, vehicleRow, vehicleLabel);
		});

	$(page.body)
		.off("click", ".cr-open")
		.on("click", ".cr-open", function () {
			const docname = $(this).data("docname");
			const kind = $(this).data("kind") || "tagging";
			if (!docname) return;
			_control_room_open_dialog(page, docname, kind);
		})
		.off("click", ".cr-row")
		.on("click", ".cr-row", function (event) {
			if ($(event.target).closest(".cr-open").length) return;
			const docname = $(this).data("name");
			const kind = $(this).data("kind") || "tagging";
			if (docname) _control_room_open_dialog(page, docname, kind);
		});
}

function _control_room_load_queue(page) {
	page.control_room_state.loading = true;
	_control_room_render_body(page);

	const state = page.control_room_state;
	frappe.call({
		method: CR_METHOD("get_control_room_queue"),
		args: {
			search: state.search || "",
			from_date: state.from_date || "",
			to_date: state.to_date || "",
			page: state.requestPage || 1,
			page_length: state.queuePageLength,
		},
		callback(r) {
			const res = r.message || {};
			const totalPages = Math.max(1, Math.ceil((res.total || 0) / state.queuePageLength));
			if (state.requestPage > totalPages) {
				state.requestPage = totalPages;
				_control_room_load_queue(page);
				return;
			}
			state.loading = false;
			state.requests = res.requests || [];
			state.requestTotal = res.total || 0;
			state.requestOverall = res.overall || 0;
			_control_room_update_approve_count(page);
			_control_room_render_body(page);
			_control_room_refresh_dialog(page);
		},
		error() {
			page.control_room_state.loading = false;
			_control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load approval queue"), indicator: "red" }, 5);
		},
	});
}

function _control_room_load_arrivals(page) {
	const state = page.control_room_state;
	state.arrivalsLoading = true;
	if (state.tab === "arrivals") _control_room_render_body(page);

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_arrival_queue",
		args: {
			search: state.search || "",
			from_date: state.from_date || "",
			to_date: state.to_date || "",
			page: state.arrivalPage || 1,
			page_length: state.queuePageLength,
		},
		callback(r) {
			const res = r.message || {};
			const totalPages = Math.max(1, Math.ceil((res.total || 0) / state.queuePageLength));
			if (state.arrivalPage > totalPages) {
				state.arrivalPage = totalPages;
				_control_room_load_arrivals(page);
				return;
			}
			state.arrivalsLoading = false;
			state.arrivalsLoaded = true;
			state.arrivals = res.journeys || [];
			state.arrivalTotal = res.total || 0;
			state.arrivalOverall = res.overall || 0;
			_control_room_update_approve_count(page);
			if (state.tab === "arrivals") _control_room_render_body(page);
		},
		error() {
			state.arrivalsLoading = false;
			if (state.tab === "arrivals") _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load arrivals queue"), indicator: "red" }, 5);
		},
	});
}

// Search / date filters are applied on the server, so any change restarts both
// approve-tab queues from page 1.
function _control_room_reload_approve(page) {
	const state = page.control_room_state;
	state.requestPage = 1;
	state.arrivalPage = 1;
	_control_room_load_queue(page);
	_control_room_load_arrivals(page);
}

function _control_room_update_approve_count(page) {
	const state = page.control_room_state;
	$(page.body).find("[data-cr-request-count]").text(state.requestOverall || 0);
	$(page.body).find("[data-cr-arrival-count]").text(state.arrivalOverall || 0);
}



// ---------------------------------------------------------------------------
// Journey List tab — every Seal Journey In Transit (get_control_room_journey_list).
// ---------------------------------------------------------------------------

function _cr_is_journey_tab(state) {
	return state.tab === "journeys" || state.tab === "completed";
}

// Active journeys shows In Transit or all not-yet-ended journeys; the Completed
// journeys tab is always the completed ones.
function _cr_journey_effective_view(state) {
	return state.tab === "completed" ? "completed" : state.journeyView;
}

function _control_room_load_journeys(page) {
	const state = page.control_room_state;
	state.journeysLoading = true;
	if (_cr_is_journey_tab(state)) _control_room_render_body(page);

	const view = _cr_journey_effective_view(state);
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_control_room_journey_list",
		args: {
			search: state.journeySearch || "",
			page: state.journeyPage || 1,
			page_length: state.queuePageLength,
			view,
			from_date: state.from_date || "",
			to_date: state.to_date || "",
			// The Alert filter only applies to the Active journeys tab.
			alert_status: view === "completed" ? "open" : state.alertStatus,
			alert_level: view === "completed" ? "all" : state.alertLevel,
			alert_type: view === "completed" ? "all" : state.alertType,
		},
		callback(r) {
			if (view !== _cr_journey_effective_view(state)) return; // tab switched meanwhile
			const res = r.message || {};
			const totalPages = Math.max(1, Math.ceil((res.total || 0) / state.queuePageLength));
			if (state.journeyPage > totalPages) {
				state.journeyPage = totalPages;
				_control_room_load_journeys(page);
				return;
			}
			state.journeysLoading = false;
			state.journeysLoaded = true;
			state.journeys = res.journeys || [];
			state.journeyTotal = res.total || 0;
			state.journeyOverall = res.overall || 0;
			state.journeySummary = res.summary || {};
			state.completedOverall = res.completed_overall || 0;
			$(page.body).find("[data-cr-journey-count]").text(state.journeyOverall);
			$(page.body).find("[data-cr-completed-count]").text(state.completedOverall);
			$(page.body).find(".cr-journey-view").html(_control_room_journey_view_options(state));
			if (_cr_is_journey_tab(state)) _control_room_render_body(page);
		},
		error() {
			state.journeysLoading = false;
			if (_cr_is_journey_tab(state)) _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load the journey list"), indicator: "red" }, 5);
		},
	});
}

// Location cell, same as Journey Monitoring: a map link (Google Maps at the
// exact coordinates) only when there is a GPS fix, labelled with the first few
// words of the place name and the full name + coordinates on hover; plain
// truncated text when there is a name but no fix.
function _cr_location_html(j) {
	const esc = frappe.utils.escape_html;
	const raw = j.location ? String(j.location) : "";
	const short = (v) => {
		const words = v.trim().split(/\s+/);
		return words.length <= 3 ? v.trim() : `${words.slice(0, 3).join(" ")}...`;
	};
	if (j.latitude != null && j.longitude != null) {
		const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${j.latitude},${j.longitude}`)}`;
		const title = `${raw ? raw + " — " : ""}${j.latitude}, ${j.longitude}`;
		return `<a class="cr-location-truncated cr-location-link" href="${mapUrl}" target="_blank"
			rel="noopener noreferrer" title="${esc(title)}">${esc(raw ? short(raw) : __("View on map"))}</a>`;
	}
	if (raw) return `<span class="cr-location-truncated" title="${esc(raw)}">${esc(short(raw))}</span>`;
	return "—";
}

// Journey-status badge colours (same as Journey Monitoring).
const CR_STATUS_CLASS = {
	"In Transit": "blue",
	"Ready for Journey": "blue",
	"Arrived": "idle",
	"Completed": "active",
	"Cancelled": "offline",
	"Finance PCB Rejected": "offline",
};

const CR_CUSTODY_TAG = {
	"Warehouse": __("Warehouse"),
	"Team Lead": __("Team Lead"),
	"Field Technician": __("Field Tech"),
	"Customer": __("Customer"),
};

// One row per seal (like Journey Monitoring); the journey-level cells span the
// journey's seals.
function _cr_journey_rows_html(j, completed) {
	const esc = frappe.utils.escape_html;
	const dash = "—";
	const allSeals = (j.seals || []).length ? j.seals : [null];
	// Completed journeys stay one row each; several seals sit behind a button.
	const seals = completed ? [allSeals[0]] : allSeals;
	const span = seals.length > 1 ? ` rowspan="${seals.length}"` : "";

	const batch =
		j.tagging_booking && j.batch_size > 1
			? `<div class="cr-muted-line">${esc(`${j.tagging_booking} · ${__("vehicle {0} of {1}", [j.batch_position, j.batch_size])}`)}</div>`
			: "";
	const status = j.journey_status || __("Unknown");
	let warehouse = dash;
	if (j.current_warehouse) {
		const tag = CR_CUSTODY_TAG[j.custodian_type] || j.custodian_type || "";
		const label = tag ? `${tag} - ${j.current_warehouse}` : j.current_warehouse;
		warehouse = `<span title="${esc(label)}">${esc(label)}</span>`;
	}
	const longer =
		j.longer_in_journey && j.longer_in_journey > 0
			? `<span class="cr-badge cr-badge--warning">${Math.ceil(j.longer_in_journey)} ${__("Days")}</span>`
			: dash;

	const journeyCells = `
		<td${span} class="cr-nowrap"><a href="/app/seal-journey/${encodeURIComponent(j.name)}" target="_blank" rel="noopener">${esc(j.name)}</a></td>
		<td${span}>${esc(j.customer || dash)}</td>
		<td${span} class="cr-nowrap">${j.vehicle_plate_number ? esc(j.vehicle_plate_number) + batch : dash}</td>
		<td${span} class="cr-nowrap">${esc(j.entry_number || dash)}</td>
		<td${span} class="cr-nowrap">${esc(j.container_number || dash)}</td>
		<td${span}>${esc(j.origin || dash)}</td>
		<td${span}>${esc(j.destination || dash)}</td>
		${completed ? "" : `<td${span}><span class="cr-badge cr-badge--${CR_STATUS_CLASS[status] || "unknown"}">${esc(status)}</span></td>`}
		${completed ? "" : `<td${span}>${warehouse}</td><td${span}>${longer}</td>`}
	`;
	const taggedBy = `<td${span}>${esc(j.tagged_by || dash)}</td>`;

	return seals
		.map((s, idx) => {
			const sealNo = completed && allSeals.length > 1
				? `<button class="cr-seals-btn" data-journey="${esc(j.name)}" title="${__("View seals")}">${__("{0} seals", [allSeals.length])}</button>`
				: s
				? `<a href="/app/seal-device/${encodeURIComponent(s.seal_device)}" target="_blank" rel="noopener">${esc(s.seal_number || s.seal_device)}</a>`
				: dash;
			const lock = s && s.lock_status
				? `<span class="cr-badge cr-badge--${s.lock_status === "Locked" ? "active" : "offline"}">${esc(s.lock_status)}</span>`
				: dash;
			const battery = s && (s.battery_level || s.battery_level === 0) ? esc(String(s.battery_level)) : dash;
			// Per-seal fix, falling back to the journey-level one.
			const loc = s && (s.latitude != null || s.api_location)
				? _cr_location_html({ location: s.api_location, latitude: s.latitude, longitude: s.longitude })
				: _cr_location_html(j);
			const alerts = s && s.alert_count
				? `<button class="cr-journey-alerts-btn" data-device="${esc(s.seal_device)}" title="${__("View alerts")}">${s.alert_count}</button>`
				: dash;
			return `
				<tr>
					${idx === 0 ? journeyCells : ""}
					<td class="cr-nowrap">${sealNo}</td>
					${completed ? "" : `<td>${lock}</td><td>${battery}</td><td class="cr-nowrap">${loc}</td><td>${alerts}</td>`}
					${idx === 0 ? taggedBy : ""}
				</tr>
			`;
		})
		.join("");
}

// Seal numbers of a completed journey with several seals, each linked to its record.
function _control_room_show_journey_seals(journey) {
	const esc = frappe.utils.escape_html;
	const rows = (journey.seals || [])
		.map(
			(s) => `<tr><td><a href="/app/seal-device/${encodeURIComponent(s.seal_device)}" target="_blank" rel="noopener">${esc(s.seal_number || s.seal_device)}</a></td></tr>`
		)
		.join("");
	const dialog = new frappe.ui.Dialog({
		title: __("Seals — {0}", [journey.name]),
		fields: [{ fieldname: "seals_html", fieldtype: "HTML" }],
	});
	dialog.fields_dict.seals_html.$wrapper.html(
		`<table class="cr-queue-table"><thead><tr><th>${__("Seal Number")}</th></tr></thead><tbody>${rows}</tbody></table>`
	);
	dialog.show();
}

// Journey Status filter options, with counts (same views as Journey Monitoring).
function _control_room_journey_view_options(state) {
	return [
		["active", __("Active")],
		["in_transit", __("In Transit")],
		["longer", __("Longer in Journey")],
	]
		.map(
			([v, label]) =>
				`<option value="${v}" ${state.journeyView === v ? "selected" : ""}>${label} (${(state.journeySummary || {})[v] || 0})</option>`
		)
		.join("");
}

// ``completed`` trims the live-tracking columns (warehouse, longer in journey,
// lock, battery, location, alerts) that mean nothing once a journey has ended.
function _control_room_journey_table(journeys, completed) {
	const rows = journeys.map((j) => _cr_journey_rows_html(j, completed)).join("");

	return `
		<table class="cr-queue-table">
			<thead>
				<tr>
					<th>${__("Journey")}</th>
					<th>${__("Client Name")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Entry Number")}</th>
					<th>${__("Container Number")}</th>
					<th>${__("Origin")}</th>
					<th>${__("Destination")}</th>
					${completed ? "" : `<th>${__("Status")}</th>`}
					${completed ? "" : `<th>${__("Warehouse")}</th><th>${__("Longer in Journey")}</th>`}
					<th>${__("Seal Number")}</th>
					${completed ? "" : `<th>${__("Lock")}</th><th>${__("Battery")}</th><th>${__("Current Location")}</th><th>${__("Alerts")}</th>`}
					<th>${__("Tagged By")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

function _control_room_journey_pagination(state) {
	const total = state.journeyTotal || 0;
	const pageLength = state.queuePageLength;
	const totalPages = Math.max(1, Math.ceil(total / pageLength));
	const currentPage = Math.min(Math.max(state.journeyPage || 1, 1), totalPages);
	const firstRow = total ? (currentPage - 1) * pageLength + 1 : 0;
	const lastRow = Math.min(currentPage * pageLength, total);
	return `
		<div class="cr-alert-pagination">
			<span class="cr-alert-page-summary">${__("Showing {0}-{1} of {2}", [firstRow, lastRow, total])}</span>
			<div class="cr-alert-page-actions">
				<button class="cr-journey-page-btn cr-alert-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>${__("Previous")}</button>
				<span>${__("Page {0} of {1}", [currentPage, totalPages])}</span>
				<button class="cr-journey-page-btn cr-alert-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>${__("Next")}</button>
			</div>
		</div>
	`;
}

// Loads the alert summary, filter options and per-type pill counts. The alerts
// themselves are shown through the Active journeys table (Alerts button).
function _control_room_load_alerts(page) {
	const state = page.control_room_state;

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.get_alert_queue",
		args: { status: "open", page_length: 1 },
		callback(r) {
			const res = r.message || {};
			state.alertsLoaded = true;
			state.alertFilterOptions = res.filter_options || { levels: [], types: [] };
			state.alertSummary = res.summary || { open: 0, critical_open: 0, unacknowledged_open: 0 };
			state.alertTypeGroups = res.type_groups || [];
			_control_room_render_head(page);
		},
		error() {
			frappe.show_alert({ message: __("Could not load alert queue"), indicator: "red" }, 5);
		},
	});
}

// Re-run the Active journeys list with the Alert filter in state.
function _control_room_apply_alert_filter(page) {
	const state = page.control_room_state;
	state.alertFilterOpen = false;
	state.journeyPage = 1;
	state.tab = "journeys";
	_control_room_render(page);
	_control_room_render_body(page);
	_control_room_load_journeys(page);
	_control_room_start_alert_polling(page);
}

// ---------------------------------------------------------------------------
// Download Report for whichever tab is showing: fetch every row for the tab's
// current search / dates / filters (the list APIs page at 100), lay it out as the
// tab's table, then export it as Excel (server-built) or PDF (HTML rendered by
// export_pdf).
// ---------------------------------------------------------------------------

const CR_TAB_REPORT_TITLE = {
	requests: __("Journey Requests Report"),
	arrivals: __("Arrivals Report"),
	journeys: __("Active Journeys Report"),
	completed: __("Completed Journeys Report"),
};

function _control_room_fetch_all(method, args, key) {
	const pageLength = 100;
	const all = [];
	return new Promise((resolve, reject) => {
		const next = (pageNo) =>
			frappe.call({
				method,
				args: { ...args, page: pageNo, page_length: pageLength },
				callback(r) {
					const res = r.message || {};
					const rows = res[key] || [];
					all.push(...rows);
					if (rows.length && all.length < (res.total || 0)) next(pageNo + 1);
					else resolve(all);
				},
				error: reject,
			});
		next(1);
	});
}

function _control_room_tab_report(state) {
	const text = (v) => (v || v === 0 ? String(v) : "");
	const base = { search: state.search || "", from_date: state.from_date || "", to_date: state.to_date || "" };

	if (state.tab === "requests") {
		return _control_room_fetch_all(CR_METHOD("get_control_room_queue"), base, "requests").then((reqs) => ({
			columns: [__("Request"), __("Client Name"), __("Vehicle"), __("Seal Serial Number(s)"), __("Origin"), __("Destination")],
			rows: reqs.map((q) => [
				q.name,
				q.client_name,
				q.vehicle,
				(q.seals || []).map((s) => s.seal_number).filter(Boolean).join(", "),
				q.origin,
				q.destination,
			]),
		}));
	}

	if (state.tab === "arrivals") {
		return _control_room_fetch_all(
			"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_arrival_queue",
			base,
			"journeys"
		).then((js) => ({
			columns: [__("Journey"), __("Vehicle"), __("Seal Device"), __("Last Location")],
			rows: js.map((j) => [j.name, j.vehicle_plate_number, j.assigned_seal, j.location]),
		}));
	}

	const completed = state.tab === "completed";
	const view = _cr_journey_effective_view(state);
	const args = {
		...base,
		search: state.journeySearch || "",
		view,
		alert_status: completed ? "open" : state.alertStatus,
		alert_level: completed ? "all" : state.alertLevel,
		alert_type: completed ? "all" : state.alertType,
	};
	return _control_room_fetch_all(
		"tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_control_room_journey_list",
		args,
		"journeys"
	).then((js) => {
		const common = (j) => [j.name, j.customer, j.vehicle_plate_number, j.entry_number, j.container_number, j.origin, j.destination];
		if (completed) {
			return {
				columns: [__("Journey"), __("Client Name"), __("Vehicle"), __("Entry Number"), __("Container Number"), __("Origin"), __("Destination"), __("Seal Number"), __("Tagged By")],
				rows: js.map((j) => [
					...common(j),
					(j.seals || []).map((s) => s.seal_number || s.seal_device).join(", "),
					j.tagged_by,
				]),
			};
		}
		const rows = [];
		js.forEach((j) => {
			const warehouse = j.current_warehouse
				? `${CR_CUSTODY_TAG[j.custodian_type] ? CR_CUSTODY_TAG[j.custodian_type] + " - " : ""}${j.current_warehouse}`
				: "";
			const longer = j.longer_in_journey > 0 ? `${Math.ceil(j.longer_in_journey)} ${__("Days")}` : "";
			(j.seals && j.seals.length ? j.seals : [null]).forEach((s) => {
				rows.push([
					...common(j),
					j.journey_status,
					warehouse,
					longer,
					s ? s.seal_number || s.seal_device : "",
					s ? s.lock_status : "",
					s && (s.battery_level || s.battery_level === 0) ? `${s.battery_level}%` : "",
					(s && s.api_location) || j.location,
					s ? s.alert_count || 0 : "",
					j.tagged_by,
				]);
			});
		});
		return {
			columns: [__("Journey"), __("Client Name"), __("Vehicle"), __("Entry Number"), __("Container Number"), __("Origin"), __("Destination"), __("Status"), __("Warehouse"), __("Longer in Journey"), __("Seal Number"), __("Lock"), __("Battery"), __("Current Location"), __("Alerts"), __("Tagged By")],
			rows,
		};
	});
}

function _control_room_export_current_tab(page, format) {
	const state = page.control_room_state;
	const title = CR_TAB_REPORT_TITLE[state.tab];
	frappe.show_alert({ message: __("Preparing report…"), indicator: "blue" }, 3);

	_control_room_tab_report(state)
		.then(({ columns, rows }) => {
			if (!rows.length) {
				frappe.show_alert({ message: __("Nothing to export for the current filters."), indicator: "orange" }, 5);
				return;
			}
			const filename = `${title} - ${frappe.datetime.get_today()}`;
			if (format === "excel") {
				open_url_post("/api/method/tnt_seal_management.tnt_seal_management.api.control_room_export.export_excel", {
					title,
					columns: JSON.stringify(columns),
					rows: JSON.stringify(rows),
					filename,
				});
				return;
			}
			const esc = frappe.utils.escape_html;
			const generatedOn = frappe.datetime.str_to_user(frappe.datetime.now_datetime());
			const html = `
				<html>
					<head><title>${esc(title)}</title><style>${_control_room_alert_print_styles()}</style></head>
					<body>
						<table class="cr-print-header">
							<tr>
								<td class="cr-print-header-title">
									<h2>${esc(title)}</h2>
									<p class="cr-print-meta">${__("Generated")}: ${generatedOn} &nbsp;•&nbsp; ${__("{0} row(s)", [rows.length])}</p>
								</td>
								<td class="cr-print-header-logo">{{TNT_LOGO}}</td>
							</tr>
						</table>
						<table class="cr-print-table">
							<thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
							<tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v || v === 0 ? String(v) : "—")}</td>`).join("")}</tr>`).join("")}</tbody>
						</table>
					</body>
				</html>
			`;
			open_url_post("/api/method/tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.export_pdf", {
				html,
				filename,
			});
		})
		.catch(() => frappe.show_alert({ message: __("Failed to prepare the report"), indicator: "red" }, 5));
}

// ---------------------------------------------------------------------------
// PDF export — from the Alert filter menu. Mirrors the Seal Device Dashboard's export
// (build HTML client-side from the full filtered set, POST it to a
// whitelisted method that renders it with get_pdf), styled in the app's
// blue theme.
// ---------------------------------------------------------------------------

function _control_room_export_alerts_pdf(page) {
	const state = page.control_room_state;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.get_all_alerts_for_export",
		args: {
			level: state.alertLevel || "all",
			alert_type: state.alertType || "all",
			status: state.alertStatus || "open",
		},
		freeze: true,
		freeze_message: __("Preparing report…"),
		callback(r) {
			const alerts = r.message || [];
			if (!alerts.length) {
				frappe.show_alert({ message: __("No alerts match the current filters."), indicator: "orange" }, 5);
				return;
			}

			const statusLabel = $(page.body).find(".cr-alert-status option:selected").text() || __("Open");
			const generatedOn = frappe.datetime.str_to_user(frappe.datetime.now_datetime());

			const rows = alerts.map(_control_room_alert_pdf_row_html).join("");
			const html = `
				<html>
					<head>
						<title>${__("Seal Alert Report")}</title>
						<style>${_control_room_alert_print_styles()}</style>
					</head>
					<body>
						<table class="cr-print-header">
							<tr>
								<td class="cr-print-header-title">
									<h2>${__("Seal Alert Report")}</h2>
									<p class="cr-print-meta">
										${__("Status")}: ${frappe.utils.escape_html(statusLabel)}
										&nbsp;•&nbsp; ${__("Generated")}: ${generatedOn}
										&nbsp;•&nbsp; ${__("{0} alert(s)", [alerts.length])}
									</p>
								</td>
								<td class="cr-print-header-logo">{{TNT_LOGO}}</td>
							</tr>
						</table>
						<table class="cr-print-table">
							<thead>
								<tr>
									<th>${__("Level")}</th>
									<th>${__("Type")}</th>
									<th>${__("Message")}</th>
									<th>${__("Client Name")}</th>
									<th>${__("Vehicle")}</th>
									<th>${__("Seal")}</th>
									<th>${__("Location")}</th>
									<th>${__("Occurred At")}</th>
									<th>${__("Resolution")}</th>
								</tr>
							</thead>
							<tbody>${rows}</tbody>
						</table>
					</body>
				</html>
			`;

			open_url_post("/api/method/tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.export_pdf", {
				html: html,
				filename: `Seal Alert Report - ${frappe.datetime.get_today()}`,
			});
		},
		error() {
			frappe.show_alert({ message: __("Failed to prepare the report"), indicator: "red" }, 5);
		},
	});
}

// ---------------------------------------------------------------------------
// Excel export — the same filtered set as the PDF, but built server-side into
// an .xlsx workbook so the rows stay sortable/filterable in a spreadsheet.
// ---------------------------------------------------------------------------

function _control_room_export_alerts_excel(page) {
	const state = page.control_room_state;

	// The server throws on an empty result, which would replace this page with
	// an error page (open_url_post posts the current window), so check the count
	// for these same filters first.
	frappe.call({
		method: CR_ALERT_METHOD("get_alert_queue"),
		args: {
			status: state.alertStatus || "open",
			level: state.alertLevel || "all",
			alert_type: state.alertType || "all",
			page_length: 1,
		},
		callback(r) {
			if (!(r.message || {}).total) {
				frappe.show_alert({ message: __("No alerts match the current filters."), indicator: "orange" }, 5);
				return;
			}
			open_url_post("/api/method/tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.export_excel", {
				level: state.alertLevel || "all",
				alert_type: state.alertType || "all",
				status: state.alertStatus || "open",
				filename: `Seal Alert Report - ${frappe.datetime.get_today()}`,
			});
		},
	});
}

function _control_room_alert_pdf_row_html(a) {
	const esc = frappe.utils.escape_html;
	const dash = "—";
	const occurred = a.occurred_at ? frappe.datetime.str_to_user(a.occurred_at) : dash;
	const levelClass = (a.level || "info").toLowerCase();
	const resStatus = a.is_resolved ? "Resolved" : a.resolution_status === "Escalated" ? "Escalated" : "Open";

	return `
		<tr>
			<td><span class="cr-print-badge cr-print-badge--${levelClass}">${esc(a.level || "—")}</span></td>
			<td>${esc(a.alert_type || dash)}</td>
			<td>${esc(a.message || dash)}</td>
			<td>${esc(a.client_name || dash)}</td>
			<td>${esc(a.vehicle || dash)}</td>
			<td>${esc(a.seal_device || dash)}</td>
			<td>${esc(a.seal_location || dash)}</td>
			<td>${esc(occurred)}</td>
			<td>${esc(resStatus)}</td>
		</tr>
	`;
}

function _control_room_alert_print_styles() {
	return `
		body { font-family: sans-serif; padding: 24px; color: #0c4a6e; }
		h2 { margin-top: 0; margin-bottom: 2px; color: #075985; }
		/* Table, not flexbox: the wkhtmltopdf on this box predates the patched
		   Qt WebKit and ignores flex, which drops the logo below the title. */
		.cr-print-header {
			width: 100%;
			border-collapse: collapse;
			margin-bottom: 16px;
		}
		.cr-print-header td {
			padding: 0 0 14px 0;
			vertical-align: middle;
			border-bottom: 3px solid #0284c7;
		}
		.cr-print-header-logo { width: 240px; text-align: right; }
		.cr-print-meta { color: #0369a1; margin-top: 4px; margin-bottom: 0; font-size: 12px; }
		.tnt-pdf-logo { max-height: 60px; max-width: 220px; }
		.cr-print-table { width: 100%; border-collapse: collapse; font-size: 11px; }
		.cr-print-table th, .cr-print-table td {
			border-bottom: 1px solid #e0f2fe;
			padding: 7px 8px;
			text-align: left;
		}
		.cr-print-table th {
			background: #0284c7;
			color: #fff;
			font-weight: 700;
			text-transform: uppercase;
			font-size: 10px;
			letter-spacing: .04em;
		}
		.cr-print-table tbody tr:nth-child(even) { background: #f0f9ff; }
		.cr-print-badge {
			display: inline-block;
			border-radius: 999px;
			padding: 3px 9px;
			font-size: 10px;
			font-weight: 700;
		}
		.cr-print-badge--critical { background: #fee2e2; color: #b91c1c; }
		.cr-print-badge--warning { background: #fef3c7; color: #92400e; }
		.cr-print-badge--info { background: #e0f2fe; color: #075985; }
	`;
}


// Action dialog for an alert. Resolved closes it. Escalated keeps it open and,
// optionally, emails it straight from here: the draft (from get_escalation_email)
// is addressed to whoever holds the seal right now and carries the alert details;
// the operator can change recipients, add CC and edit the text before sending.
// The email goes out as a Communication on the alert (see acknowledge_alert).
const CR_ALERT_METHOD = (m) => `tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.${m}`;

function _control_room_open_alert_action(page, docname) {
	let draftLoaded = false;
	const showEmail = "eval:doc.status === 'Escalated'";
	const showEmailFields = "eval:doc.status === 'Escalated' && doc.send_email";

	const dialog = new frappe.ui.Dialog({
		title: __("Action {0}", [docname]),
		size: "large",
		fields: [
			{
				fieldname: "status",
				fieldtype: "Select",
				label: __("Status"),
				options: ["Resolved", "Escalated"].join("\n"),
				default: "Resolved",
				reqd: 1,
				description: __("Resolved if handled. Escalated if acknowledged but further action is still needed."),
				onchange: () => {
					if (dialog.get_value("status") === "Escalated") load_draft();
				},
			},
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (optional)"),
			},
			{ fieldtype: "Section Break", label: __("Escalation Email"), depends_on: showEmail },
			{
				fieldname: "send_email",
				fieldtype: "Check",
				label: __("Send an email with this escalation"),
				default: 1,
				depends_on: showEmail,
			},
			{
				fieldname: "recipients",
				fieldtype: "Data",
				label: __("To"),
				depends_on: showEmailFields,
				description: __("Separate several addresses with commas."),
			},
			{ fieldname: "cc", fieldtype: "Data", label: __("CC"), depends_on: showEmailFields },
			{ fieldname: "subject", fieldtype: "Data", label: __("Subject"), depends_on: showEmailFields },
			{ fieldname: "message", fieldtype: "Text Editor", label: __("Message"), depends_on: showEmailFields },
		],
		primary_action_label: __("Submit"),
		primary_action(values) {
			const emailing = values.status === "Escalated" && values.send_email;
			if (emailing) {
				const missing = [
					[values.recipients, __("To")],
					[values.subject, __("Subject")],
					[frappe.utils.html2text(values.message || "").trim(), __("Message")],
				]
					.filter(([v]) => !(v || "").trim())
					.map(([, label]) => label);
				if (missing.length) {
					frappe.msgprint(__("Fill in the escalation email: {0}", [missing.join(", ")]));
					return;
				}
			}
			frappe.call({
				method: CR_ALERT_METHOD("acknowledge_alert"),
				args: {
					docname,
					status: values.status,
					remarks: values.remarks || null,
					send_email: emailing ? 1 : 0,
					recipients: emailing ? values.recipients : null,
					cc: emailing ? values.cc || null : null,
					subject: emailing ? values.subject : null,
					message: emailing ? values.message : null,
				},
				freeze: true,
				freeze_message: emailing ? __("Escalating and sending email…") : __("Saving…"),
				callback(r) {
					dialog.hide();
					const sent = (r.message || {}).email;
					frappe.show_alert(
						{
							message: sent
								? __("Alert escalated — email sent to {0}", [sent.recipients.concat(sent.cc).join(", ")])
								: __("Alert marked {0}", [values.status]),
							indicator: "green",
						},
						6
					);
					_control_room_load_alerts(page);
					_control_room_load_journeys(page);
				},
			});
		},
	});

	function load_draft() {
		if (draftLoaded) return;
		draftLoaded = true;
		frappe.call({
			method: CR_ALERT_METHOD("get_escalation_email"),
			args: { docname },
			callback(r) {
				const draft = r.message || {};
				// Only fill what the operator hasn't typed yet.
				["recipients", "subject", "message"].forEach((f) => {
					if (!dialog.get_value(f) && draft[f]) dialog.set_value(f, draft[f]);
				});
				// Only speak up when there is no address to pre-fill.
				if (!draft.recipients) {
					dialog.fields_dict.recipients.set_description(
						draft.recipient_label
							? __("{0} is holding the seal but has no email address on file — enter recipients.", [draft.recipient_label])
							: __("This seal has no current custodian with an email — enter recipients.")
					);
				}
			},
		});
	}

	dialog.show();
}

function _control_room_open_seal_alerts(page, sealDevice) {
	const state = page.control_room_state;
	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.get_alert_queue",
		args: {
			search: sealDevice,
			status: state.alertStatus,
			level: state.alertLevel,
			alert_type: state.alertType,
			page_length: 100,
		},
		callback(r) {
			const alerts = ((r.message || {}).rows || []).filter((a) => a.seal_device === sealDevice);
			if (!alerts.length) {
				frappe.show_alert({ message: __("No alerts for {0}", [sealDevice]), indicator: "orange" }, 5);
			} else {
				_control_room_pick_alert_dialog(page, sealDevice, alerts);
			}
		},
	});
}

function _control_room_pick_alert_dialog(page, sealDevice, alerts) {
	const esc = frappe.utils.escape_html;
	const rows = alerts
		.map(
			(a, i) => `
			<tr>
				<td>${esc(a.level || "—")}</td>
				<td>${esc(a.alert_type || "—")}</td>
				<td>${esc(a.message || "—")}</td>
				<td>${a.occurred_at ? frappe.datetime.str_to_user(a.occurred_at) : "—"}</td>
				<td class="cr-nowrap">
					<button class="cr-alert-open-btn cr-res-badge--open cr-pick-alert" data-idx="${i}">${__("Open")}</button>
					<button class="cr-alert-ack-btn cr-pick-action" data-name="${esc(a.name)}">${
						a.resolution_status === "Escalated" ? __("Update") : __("Action")
					}</button>
				</td>
			</tr>`
		)
		.join("");
	const dialog = new frappe.ui.Dialog({
		title: __("Open alerts — {0}", [sealDevice]),
		size: "large",
		fields: [{ fieldname: "list_html", fieldtype: "HTML" }],
	});
	dialog.fields_dict.list_html.$wrapper.html(`
		<table class="cr-queue-table">
			<thead><tr><th>${__("Level")}</th><th>${__("Type")}</th><th>${__("Message")}</th><th>${__("Occurred At")}</th><th></th></tr></thead>
			<tbody>${rows}</tbody>
		</table>`);
	dialog.$wrapper.on("click", ".cr-pick-alert", function () {
		_control_room_open_alert_details(alerts[Number(this.dataset.idx)]);
	});
	dialog.$wrapper.on("click", ".cr-pick-action", function () {
		dialog.hide();
		_control_room_open_alert_action(page, this.dataset.name);
	});
	dialog.show();
}

function _control_room_open_alert_details(alert) {
	const esc = frappe.utils.escape_html;
	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : "—");
	const val = (v) => (v || v === 0 ? esc(String(v)) : "—");
	const target = alert.seal_journey || alert.journey_request || alert.seal_device || "—";
	const resStatus = alert.is_resolved
		? "Resolved"
		: alert.resolution_status === "Escalated"
		? "Escalated"
		: "Open";
	const resClass =
		resStatus === "Resolved" ? "resolved" : resStatus === "Escalated" ? "escalated" : "open";

	const row = (label, value) => `
		<tr>
			<th>${label}</th>
			<td>${value}</td>
		</tr>`;

	const html = `
		<div class="cr-alert-details">
			<div class="cr-alert-details-section">${__("Alert")}</div>
			<table class="cr-alert-details-table">
				${row(__("Level"), `<span class="cr-alert-badge cr-alert-badge--${(alert.level || "info").toLowerCase()}">${val(alert.level)}</span>`)}
				${row(__("Type"), val(alert.alert_type))}
				${row(__("Location"), _cr_location_html({ location: alert.seal_location, latitude: alert.latitude, longitude: alert.longitude }))}
				${alert.source_alert_type ? row(__("Source Alert"), val(alert.source_alert_type)) : ""}
				${alert.occurrence_count > 1 ? row(__("Occurrences"), val(String(alert.occurrence_count))) : ""}
				${alert.occurrence_count > 1 && alert.last_occurred_at ? row(__("Last Occurred"), dt(alert.last_occurred_at)) : ""}
				${row(__("Message"), val(alert.message))}
				${row(__("Client Name"), val(alert.client_name))}
				${row(__("Vehicle"), val(alert.vehicle))}
				${row(__("Source"), val(alert.alert_source))}
				${row(__("Target"), val(target))}
				${row(__("Occurred At"), dt(alert.occurred_at))}
			</table>

			<div class="cr-alert-details-section">${__("Resolution")}</div>
			<table class="cr-alert-details-table">
				${row(__("Status"), `<span class="cr-res-badge cr-res-badge--${resClass}">${esc(resStatus)}</span>`)}
				${row(__("Acknowledged By"), alert.acknowledged_by ? val(alert.acknowledged_by) : __("— (auto / system)"))}
				${row(__("Acknowledged At"), dt(alert.acknowledged_at))}
				${row(__("Closed At"), alert.is_resolved ? dt(alert.resolved_at) : "—")}
				${row(__("Remarks"), val(alert.acknowledgement_remarks))}
			</table>
		</div>`;

	const dialog = new frappe.ui.Dialog({
		title: __("Alert {0}", [alert.name]),
		size: "large",
		fields: [{ fieldname: "details_html", fieldtype: "HTML" }],
	});
	dialog.fields_dict.details_html.$wrapper.html(html);
	dialog.set_secondary_action_label(__("Close"));
	dialog.set_secondary_action(() => dialog.hide());
	dialog.show();
}

function _control_room_request_list_for_kind(state, kind) {
	return state.requests;
}

const CR_DIALOG_TITLE = {
	tagging: () => __("Control Room Review"),
};

function _control_room_open_dialog(page, docname, kind = "tagging") {
	const request = _control_room_request_list_for_kind(page.control_room_state, kind).find(
		(row) => row.name === docname
	);
	if (!request) {
		frappe.show_alert({ message: __("Could not find {0}", [docname]), indicator: "orange" }, 5);
		return;
	}

	if (page.control_room_state.dialog) {
		page.control_room_state.dialog.hide();
		page.control_room_state.dialog.$wrapper.remove();
		page.control_room_state.dialog = null;
	}

	const dialog = new frappe.ui.Dialog({
		title: (CR_DIALOG_TITLE[kind] || CR_DIALOG_TITLE.tagging)(),
		size: "extra-large",
		fields: [{ fieldname: "details_html", fieldtype: "HTML" }],
	});

	dialog.$wrapper.addClass("cr-dialog");
	dialog.fields_dict.details_html.$wrapper.html(
		`<div class="cr-modal-card" data-req="${frappe.utils.escape_html(request.name)}" data-kind="${kind}">${_control_room_request_card(
			request,
			kind
		)}</div>`
	);
	dialog.set_secondary_action_label(__("Close"));
	dialog.set_secondary_action(() => dialog.hide());
	dialog.onhide = () => {
		if (page.control_room_state.dialog === dialog) {
			page.control_room_state.dialog = null;
			page.control_room_state.dialog_docname = null;
		}
	};

	page.control_room_state.dialog = dialog;
	page.control_room_state.dialog_docname = docname;
	page.control_room_state.dialog_kind = kind;
	dialog.show();
}

function _control_room_refresh_dialog(page) {
	const state = page.control_room_state;
	const { dialog, dialog_docname, dialog_kind } = state;
	if (!dialog || !dialog_docname) return;

	const kind = dialog_kind || "tagging";
	const request = _control_room_request_list_for_kind(state, kind).find(
		(row) => row.name === dialog_docname
	);
	if (!request) {
		dialog.hide();
		return;
	}

	dialog.fields_dict.details_html.$wrapper.html(
		`<div class="cr-modal-card" data-kind="${kind}">${_control_room_request_card(request, kind)}</div>`
	);
}

function _control_room_reload_queue_for_kind(page, kind) {
	_control_room_load_queue(page);
}

const CR_APPROVE_METHOD = {
	tagging: "approve_by_control_room",
};
const CR_RETURN_AMEND_METHOD = {
	tagging: "return_for_amendment_by_control_room",
};
const CR_APPROVE_MESSAGE = {
	tagging: (docname) => __("{0} approved — tagging can begin", [docname]),
};

function _control_room_approve(page, docname, kind = "tagging", vehicleRow = null, vehicleLabel = null) {
	const method = CR_APPROVE_METHOD[kind] || CR_APPROVE_METHOD.tagging;
	const target = vehicleLabel ? `${docname} · ${vehicleLabel}` : docname;
	const successMessage = (CR_APPROVE_MESSAGE[kind] || CR_APPROVE_MESSAGE.tagging)(target);

	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (optional)"),
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD(method),
				args: { docname, remarks: values.remarks || null, vehicle_row: vehicleRow },
				freeze: true,
				freeze_message: __("Approving…"),
				callback() {
					frappe.show_alert({ message: successMessage, indicator: "green" }, 6);
					page.control_room_state.dialog?.hide();
					_control_room_reload_queue_for_kind(page, kind);
				},
			});
		},
		__("Approve {0}", [target]),
		__("Approve")
	);
}

function _control_room_return_for_amendment(page, docname, kind = "tagging", vehicleRow = null, vehicleLabel = null) {
	const method = CR_RETURN_AMEND_METHOD[kind] || CR_RETURN_AMEND_METHOD.tagging;
	const target = vehicleLabel ? `${docname} · ${vehicleLabel}` : docname;

	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("What needs to be amended"),
				reqd: 1,
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD(method),
				args: { docname, remarks: values.remarks, vehicle_row: vehicleRow },
				freeze: true,
				freeze_message: __("Returning…"),
				callback() {
					frappe.show_alert({ message: __("{0} returned for amendment", [target]), indicator: "orange" }, 6);
					page.control_room_state.dialog?.hide();
					_control_room_reload_queue_for_kind(page, kind);
				},
			});
		},
		__("Return {0} for Amendment", [target]),
		__("Return")
	);
}

function _control_room_refresh_seals(page, docname) {
	frappe.call({
		method: CR_METHOD("refresh_proposed_seal_status"),
		args: { docname },
		freeze: true,
		freeze_message: __("Fetching live seal data…"),
		callback(r) {
			const res = r.message || {};
			frappe.show_alert(
				{
					message: __("Refreshed {0} seal(s)", [res.refreshed || 0]),
					indicator: (res.errors || []).length ? "orange" : "green",
				},
				6
			);
			if ((res.errors || []).length) {
				frappe.msgprint({
					title: __("Some seals could not be refreshed"),
					message: res.errors.join("<br>"),
					indicator: "orange",
				});
			}
			_control_room_load_queue(page);
		},
	});
}

function _control_room_inject_styles() {
	if (document.getElementById("control-room-page-styles")) return;

	const style = document.createElement("style");
	style.id = "control-room-page-styles";
	style.textContent = `
		.cr-page {
			max-width: 1580px;
			margin: 0 auto;
			padding: 24px 20px 48px;
			font-family: var(--font-stack);
		}
		.cr-panel {
			border: 1px solid rgba(14, 165, 233, .18);
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .06);
			overflow: hidden;
		}
		.cr-tabs {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 10px;
			padding: 16px 18px;
			border-bottom: 1px solid #dbeafe;
			background: #f8fbff;
		}
		/* The title area normally fills the header row; let it shrink to its
		   text so the alert filter and pills get the middle of the row. */
		#page-control-room .page-head-content .title-area { flex: 0 0 auto; width: auto; }
		.cr-head-filters {
			display: flex;
			flex: 1 1 auto;
			min-width: 0;
			flex-wrap: nowrap;
			align-items: center;
			justify-content: center;
			gap: 8px;
			margin: 0 16px;
		}
		.cr-head-filters .cr-info-pills { flex-wrap: nowrap; }
		.cr-head-filters .cr-info-pill,
		.cr-head-filters .cr-mf-toggle { padding: 5px 12px; white-space: nowrap; }
		@media (max-width: 991px) {
			#page-control-room .page-head-content { flex-wrap: wrap; }
			.cr-head-filters { order: 3; flex-basis: 100%; flex-wrap: wrap; justify-content: flex-start; margin: 8px 0; }
			.cr-head-filters .cr-info-pills { flex-wrap: wrap; }
		}
		.cr-info-pills {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
		}
		.cr-mf { position: relative; }
		.cr-mf-toggle {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			border: 1px solid #bfdbfe;
			border-radius: 999px;
			background: #fff;
			color: #075985;
			padding: 7px 14px;
			font-size: 12px;
			font-weight: 700;
			cursor: pointer;
		}
		.cr-mf-toggle:hover, .cr-mf-toggle.has-filters { border-color: #0284c7; }
		.cr-mf-active { min-width: 18px; padding: 0 6px; border-radius: 999px; background: #0284c7; color: #fff; font-size: 11px; text-align: center; }
		.cr-mf-menu {
			display: none;
			position: absolute;
			top: calc(100% + 6px);
			left: 0;
			z-index: 30;
			min-width: 230px;
			padding: 8px;
			border: 1px solid #e2e8f0;
			border-radius: 12px;
			background: #fff;
			box-shadow: 0 10px 30px rgba(15, 23, 42, .15);
		}
		.cr-mf-menu.open { display: block; }
		.cr-mf-branch, .cr-mf-opt {
			display: flex;
			align-items: center;
			gap: 8px;
			width: 100%;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: #334155;
			padding: 7px 10px;
			font-size: 12px;
			text-align: left;
			cursor: pointer;
		}
		.cr-mf-branch { font-weight: 700; }
		.cr-mf-branch:hover, .cr-mf-opt:hover { background: #f1f5f9; }
		.cr-mf-caret { display: inline-block; width: 10px; transition: transform .15s; color: #64748b; }
		.cr-mf-node.open > .cr-mf-branch .cr-mf-caret { transform: rotate(90deg); }
		.cr-mf-branch-label { flex: 1; }
		.cr-mf-branch-value { color: #0369a1; font-weight: 600; }
		.cr-mf-children {
			display: none;
			margin: 2px 0 4px 15px;
			padding-left: 8px;
			border-left: 2px solid #e2e8f0;
			max-height: 240px;
			overflow-y: auto;
		}
		.cr-mf-node.open > .cr-mf-children { display: block; }
		.cr-mf-opt { font-weight: 500; position: relative; }
		.cr-mf-opt::before { content: ""; position: absolute; left: -8px; top: 50%; width: 8px; border-top: 2px solid #e2e8f0; }
		.cr-mf-opt.selected { color: #075985; font-weight: 700; background: #e0f2fe; }
		.cr-mf-check { display: inline-block; width: 12px; color: #0284c7; }
		[data-theme="dark"] .cr-mf-toggle { background: #1e293b; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .cr-mf-menu { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .cr-mf-branch, [data-theme="dark"] .cr-mf-opt { color: #e2e8f0; }
		[data-theme="dark"] .cr-mf-branch:hover, [data-theme="dark"] .cr-mf-opt:hover { background: #0f172a; }
		[data-theme="dark"] .cr-mf-opt.selected { background: #082f49; color: #7dd3fc; }
		[data-theme="dark"] .cr-mf-children, [data-theme="dark"] .cr-mf-opt::before { border-color: #334155; }
		.cr-info-pill {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			border: 1px solid #e2e8f0;
			border-radius: 999px;
			background: #fff;
			color: #475569;
			padding: 7px 14px;
			font-size: 12px;
			font-weight: 700;
			cursor: pointer;
		}
		.cr-info-pill:hover { border-color: #94a3b8; }
		.cr-info-pill-count {
			min-width: 20px;
			padding: 1px 7px;
			border-radius: 999px;
			background: #f1f5f9;
			color: #334155;
			font-size: 11px;
			font-weight: 800;
			text-align: center;
		}
		.cr-info-pill--critical { border-color: #fecaca; color: #b91c1c; }
		.cr-info-pill--critical .cr-info-pill-count { background: #fee2e2; color: #b91c1c; }
		.cr-info-pill--warning { border-color: #fde68a; color: #92400e; }
		.cr-info-pill--warning .cr-info-pill-count { background: #fef3c7; color: #92400e; }
		.cr-info-pill--info { border-color: #bfdbfe; color: #075985; }
		.cr-info-pill--info .cr-info-pill-count { background: #e0f2fe; color: #0369a1; }
		.cr-tab {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			border: 1px solid #bfdbfe;
			border-radius: 999px;
			background: #fff;
			color: #075985;
			padding: 9px 18px;
			font-size: 13px;
			font-weight: 800;
			cursor: pointer;
		}
		.cr-tab.active { border-color: #0284c7; background: #0284c7; color: #fff; }
		.cr-tab-count {
			min-width: 20px;
			padding: 1px 7px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-tab.active .cr-tab-count { background: rgba(255,255,255,.25); color: #fff; }
		.cr-tab-count--critical { background: #fee2e2; color: #b91c1c; }
		.cr-tab.active .cr-tab-count--critical { background: #fff; color: #b91c1c; }
		.cr-tab-body { padding: 22px; }
		.cr-alert-badge {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 700;
			text-transform: capitalize;
			white-space: nowrap;
		}
		.cr-alert-badge--critical { background: #fee2e2; color: #b91c1c; }
		.cr-alert-badge--warning { background: #fef3c7; color: #92400e; }
		.cr-alert-badge--info { background: #e0f2fe; color: #0369a1; }
		.cr-alert-badge--resolved { background: #dcfce7; color: #15803d; }
		.cr-alert-ack-btn {
			border: 1px solid #cbd5e1;
			background: #fff;
			color: #0f172a;
			border-radius: 6px;
			padding: 4px 10px;
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
		}
		.cr-alert-ack-btn:hover { background: #f1f5f9; }
		.cr-res-cell { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
		.cr-nowrap { white-space: nowrap; }
		.cr-res-badge {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
			white-space: nowrap;
		}
		.cr-res-badge--open { background: #f1f5f9; color: #475569; }
		.cr-res-badge--escalated { background: #fef3c7; color: #92400e; }
		.cr-res-badge--resolved { background: #dcfce7; color: #15803d; }
		/* status button: reads the resolution status, opens the details modal */
		.cr-alert-open-btn {
			border: none;
			border-radius: 999px;
			padding: 4px 12px;
			font-size: 11px;
			font-weight: 800;
			cursor: pointer;
			white-space: nowrap;
		}
		.cr-alert-open-btn:hover { filter: brightness(0.96); box-shadow: 0 0 0 2px rgba(2, 132, 199, .18); }
		.cr-alert-details-section {
			margin: 16px 0 8px;
			font-size: 12px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .05em;
			color: #0369a1;
		}
		.cr-alert-details-section:first-child { margin-top: 0; }
		.cr-alert-details-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.cr-alert-details-table th {
			text-align: left;
			width: 180px;
			padding: 8px 12px;
			background: #f8fafc;
			border: 1px solid #e2e8f0;
			color: #64748b;
			font-weight: 700;
			vertical-align: top;
		}
		.cr-alert-details-table td {
			padding: 8px 12px;
			border: 1px solid #e2e8f0;
			color: #1e293b;
			overflow-wrap: anywhere;
		}
		[data-theme="dark"] .cr-alert-details-table th { background: #0f172a; color: #94a3b8; border-color: #334155; }
		[data-theme="dark"] .cr-alert-details-table td { color: #e2e8f0; border-color: #334155; }
		[data-theme="dark"] .cr-res-badge--open { background: #1e293b; color: #cbd5e1; }
		.cr-alert-table-wrap {
			height: 520px;
			overflow: auto;
			overflow-x: auto;
			/* full-bleed: cancel the 22px .cr-tab-body padding so rows reach the
			   panel edges and no space is wasted */
			margin: -22px -22px 0;
			border: none;
			border-bottom: 1px solid #e2e8f0;
			border-radius: 0;
			box-shadow: none;
		}
		/* keep columns from squishing; forces horizontal scroll on narrow widths */
		.cr-alert-table-wrap .cr-queue-table { min-width: 1560px; }
		.cr-journey-table-wrap .cr-queue-table { min-width: 2100px; }
		.cr-journey-table-wrap--completed .cr-queue-table { min-width: 1100px; }
		.cr-journey-table-wrap .cr-queue-table th,
		.cr-journey-table-wrap .cr-queue-table td { white-space: nowrap; }
		.cr-journey-alerts-btn { min-width: 26px; padding: 2px 9px; border: 0; border-radius: 10px; background: #fee2e2; color: #b91c1c; font-size: 12px; font-weight: 700; cursor: pointer; }
		.cr-journey-alerts-btn:hover { filter: brightness(0.96); box-shadow: 0 0 0 2px rgba(185, 28, 28, .18); }
		.cr-seals-btn { padding: 2px 10px; border: 1px solid #7dd3fc; border-radius: 10px; background: #e0f2fe; color: #075985; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
		.cr-seals-btn:hover { background: #bae6fd; }
		.cr-muted-line { color: #94a3b8; font-size: 11px; }
		.cr-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
		.cr-badge--active { background: #dcfce7; color: #166534; }
		.cr-badge--idle { background: #fef3c7; color: #92400e; }
		.cr-badge--offline, .cr-badge--critical { background: #fee2e2; color: #b91c1c; }
		.cr-badge--unknown { background: #f1f5f9; color: #475569; }
		.cr-badge--blue { background: #e0f2fe; color: #075985; }
		.cr-badge--warning { background: #ffedd5; color: #c2410c; }
		.cr-badge--info { background: #dbeafe; color: #1d4ed8; }
		.cr-journey-seal + .cr-journey-seal { margin-top: 8px; }
		.cr-journey-seal a { font-weight: 600; }
		.cr-location-truncated { cursor: help; border-bottom: 1px dashed #94a3b8; white-space: nowrap; }
		.cr-location-link { cursor: pointer; color: #0284c7; border-bottom-color: #0284c7; }
		.cr-location-link:hover { color: #0369a1; text-decoration: none; }
		[data-theme="dark"] .cr-location-link { color: #38bdf8; border-bottom-color: #38bdf8; }
		.cr-alert-table-wrap .cr-queue-table th:first-child,
		.cr-alert-table-wrap .cr-queue-table td:first-child { padding-left: 14px; }
		.cr-alert-table-wrap .cr-queue-table th:last-child,
		.cr-alert-table-wrap .cr-queue-table td:last-child { padding-right: 14px; }
		.cr-alert-table-wrap .cr-queue-table thead {
			position: sticky;
			top: 0;
			z-index: 1;
		}
		.cr-alert-pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding-top: 14px;
			color: #64748b;
			font-size: 13px;
		}
		.cr-alert-page-actions { display: flex; align-items: center; gap: 10px; }
		.cr-alert-page-btn {
			border: 1px solid #bae6fd;
			border-radius: 8px;
			background: #e0f2fe;
			color: #075985;
			padding: 6px 12px;
			font-size: 12px;
			font-weight: 700;
			cursor: pointer;
		}
		.cr-alert-page-btn:hover:not(:disabled) { background: #bae6fd; }
		.cr-alert-page-btn:disabled { cursor: not-allowed; opacity: .45; }

		/* ---- toolbar ---- */
		.cr-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.cr-toolbar-top {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 12px;
		}
		.cr-search-inline {
			flex: 1;
			min-width: 280px;
			display: flex;
			align-items: center;
		}
		/* Active journeys search: two thirds of the width it would otherwise fill */
		.cr-journey-search-field { flex: 0 0 calc((100% - 330px) * 2 / 3); min-width: 280px; }
		.cr-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.cr-search-inline input:focus {
			outline: none;
			border-color: #0284c7;
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		/* ---- regular fields ---- */
		.cr-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.cr-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.cr-field input[type="date"],
		.cr-field select {
			width: 160px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 36px 0 10px;
			font-size: 13px;
			font-weight: 650;
			box-shadow: 0 1px 2px rgba(14, 165, 233, .04);
		}
		.cr-field select {
			appearance: none;
			background-image: linear-gradient(45deg, transparent 50%, #0284c7 50%), linear-gradient(135deg, #0284c7 50%, transparent 50%);
			background-position: calc(100% - 16px) 16px, calc(100% - 11px) 16px;
			background-size: 5px 5px, 5px 5px;
			background-repeat: no-repeat;
		}
		.cr-field input[type="date"]:focus,
		.cr-field select:focus {
			outline: none;
			border-color: #0284c7;
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- actions ---- */
		.cr-actions { display: flex; gap: 8px; padding-top: 20px; align-items: flex-end; }
		/* The 20px top padding lines buttons up with labelled fields; the toolbars no longer have labels. */
		.cr-toolbar-top .cr-actions { padding-top: 0; align-items: center; }
		.cr-clear-btn,
		.cr-alert-clear-btn,
		.cr-alert-download-btn,
		.cr-alert-refresh-btn {
			padding: 9px 16px;
			border: 1px solid #cbd5e1;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #475569;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			height: 38px;
			transition: background .12s, border-color .12s;
		}
		.cr-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }
		.cr-tabs-end { display: flex; align-items: center; gap: 10px; margin-left: auto; }
		.cr-date-field { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; }
		.cr-date-field input[type="date"] { height: 36px; padding: 4px 8px; border: 1px solid #bae6fd; border-radius: 10px; background: var(--card-bg, #fff); color: inherit; font-size: 12px; }
		[data-theme="dark"] .cr-date-field input[type="date"] { background: #1e293b; border-color: #334155; }
		.cr-alert-clear-btn {
			border-color: #cbd5e1;
			background: #fff;
			color: #475569;
		}
		.cr-alert-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }
		.cr-alert-download-btn {
			border-color: #cbd5e1;
			background: #fff;
			color: #475569;
		}
		.cr-alert-download-btn:hover { background: #f8fafc; border-color: #94a3b8; }
		.cr-alert-refresh-btn {
			border-color: #7dd3fc;
			background: #e0f2fe;
			color: #075985;
			box-shadow: 0 2px 6px rgba(14, 165, 233, .08);
		}
		.cr-alert-refresh-btn:hover { background: #bae6fd; border-color: #38bdf8; color: #0c4a6e; }
		.cr-alert-download-dropdown { position: relative; }
		.cr-alert-download-dropdown .cr-alert-download-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.cr-alert-download-arrow { color: #94a3b8; font-size: 11px; }
		.cr-alert-download-menu {
			display: none;
			position: fixed;
			min-width: 160px;
			border: 1px solid #cbd5e1;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .12);
			z-index: 1000;
			overflow: hidden;
		}
		.cr-alert-download-menu.open { display: block; }
		.cr-alert-download-item {
			padding: 10px 16px;
			font-size: 13px;
			font-weight: 600;
			color: #334155;
			cursor: pointer;
			transition: background .12s;
		}
		.cr-alert-download-item:hover { background: #f0f9ff; }
		.cr-page-refresh-btn {
			border-radius: 999px !important;
			border-color: #bae6fd !important;
			background: #e0f2fe !important;
			color: #075985 !important;
			font-weight: 800 !important;
			box-shadow: 0 2px 8px rgba(14, 165, 233, .12) !important;
		}
		.cr-page-refresh-btn:hover { background: #bae6fd !important; border-color: #38bdf8 !important; }

		.cr-queue-head { margin-bottom: 16px; }
		.cr-queue-head h3 { margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-queue-sub { color: #64748b; font-size: 13px; }

		.cr-arrivals {
			margin: -22px -22px 22px;
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-section-title {
			margin: 0 0 12px;
			font-size: 15px;
			font-weight: 800;
			color: #0f172a;
		}
		.cr-arrivals .cr-section-title {
			margin: 0;
			padding: 13px 16px;
			border-bottom: 1px solid #bae6fd;
			background: #f0f9ff;
			color: #075985;
		}
		.cr-arrival-table-wrap { width: 100%; overflow-x: auto; }
		.cr-arrival-table {
			width: 100%;
			min-width: 760px;
			border-collapse: collapse;
			font-size: 13px;
		}
		.cr-arrival-table th {
			padding: 9px 14px;
			border-bottom: 1px solid #bae6fd;
			background: #e0f2fe;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .04em;
			text-align: left;
			text-transform: uppercase;
			white-space: nowrap;
		}
		.cr-arrival-table td {
			padding: 10px 14px;
			border-bottom: 1px solid #f1f5f9;
			background: #fff;
			color: #334155;
			vertical-align: middle;
		}
		.cr-arrival-table tbody tr:last-child td { border-bottom: 0; }
		.cr-arrival-table tbody tr:hover td { background: #f0f9ff; }
		.cr-arrival-journey { color: #0f172a !important; font-weight: 800; white-space: nowrap; }
		.cr-arrival-location {
			max-width: 320px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.cr-arrival-action-col { width: 1%; text-align: right !important; white-space: nowrap; }
		.cr-arrival-open {
			border: 1px solid #38bdf8;
			border-radius: 999px;
			background: #e0f2fe;
			color: #075985;
			padding: 5px 12px;
			font-size: 12px;
			font-weight: 800;
			cursor: pointer;
		}
		.cr-arrival-open:hover { background: #bae6fd; }
		.cr-arrival {
			border: 1px solid #bae6fd;
			border-radius: 0;
			background: #f8fbff;
			overflow: hidden;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-arrival-dialog .modal-body { padding: 0; }
		.cr-arrival-dialog .cr-arrival { border: 0; box-shadow: none; }
		.cr-arrival-dialog .modal-header {
			border-bottom: 1px solid #bae6fd;
			background: #e0f2fe;
		}
		.cr-arrival-dialog .modal-title { color: #075985; font-weight: 800; }
		.cr-arrival-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);
			border-bottom: 1px solid #bae6fd;
		}
		.cr-arrival-status {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #1e293b;
			color: #fff;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-arrival-actions {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			padding: 14px 18px;
			border-top: 1px solid #bae6fd;
			background: #f0f9ff;
		}
		.cr-arrival-unlock-prompt {
			font-size: 13px;
			font-weight: 800;
			color: #075985;
			text-align: center;
		}
		.cr-arrival-unlock-buttons {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}
		.cr-arrival-unlock-btn {
			flex: 1 1 0;
			min-width: 180px;
			padding: 10px 14px;
			border-radius: 8px;
			border: 1px solid transparent;
			font-size: 13px;
			font-weight: 800;
			cursor: pointer;
			transition: background 0.15s, box-shadow 0.15s;
		}
		.cr-arrival-unlock-btn:disabled { opacity: 0.6; cursor: default; }
		.cr-arrival-unlock-btn--physical {
			background: #0284c7;
			color: #fff;
			border-color: #0284c7;
		}
		.cr-arrival-unlock-btn--physical:hover:not(:disabled) { background: #0369a1; }
		.cr-arrival-unlock-btn--remote {
			background: #fff;
			color: #5b21b6;
			border-color: #c4b5fd;
		}
		.cr-arrival-unlock-btn--remote:hover:not(:disabled) { background: #f5f3ff; }
		.cr-arrival-unlock-btn--retained {
			background: #fff;
			color: #9a3412;
			border-color: #fdba74;
		}
		.cr-arrival-unlock-btn--retained:hover:not(:disabled) { background: #fff7ed; }
		.cr-arrival-unlock-btn--end {
			background: #fff;
			color: #991b1b;
			border-color: #fca5a5;
		}
		.cr-arrival-unlock-btn--end:hover:not(:disabled) { background: #fef2f2; }

		/* Cap tall lists at ~30 rows (row height x 30 + sticky header); the body scrolls. */
		.cr-queue-scroll, .cr-alert-table-wrap { max-height: calc(30 * 52px + 44px); overflow-y: auto; }
		.cr-arrival-scroll { max-height: calc(30 * 42px + 44px); overflow-y: auto; }
		.cr-queue-scroll .cr-queue-table thead { position: sticky; top: 0; z-index: 1; }
		.cr-arrival-scroll .cr-arrival-table thead { position: sticky; top: 0; z-index: 1; }
		.cr-queue { display: grid; gap: 18px; }
		.cr-table-wrap {
			border: 1px solid #e2e8f0;
			border-radius: 18px;
			background: #fff;
			overflow-x: auto;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-queue-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 13px;
		}
		.cr-queue-table th {
			padding: 12px 7px;
			background: #f8fafc;
			border-bottom: 1px solid #e2e8f0;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: #64748b;
			text-align: left;
			white-space: nowrap;
		}
		.cr-queue-table td {
			padding: 14px 7px;
			border-bottom: 1px solid #f1f5f9;
			color: #1e293b;
			vertical-align: middle;
		}
		.cr-queue-table th:first-child,
		.cr-queue-table td:first-child {
			padding-left: 14px;
		}
		.cr-queue-table th:last-child,
		.cr-queue-table td:last-child {
			padding-right: 14px;
		}
		.cr-queue-table tbody tr:last-child td { border-bottom: none; }
		.cr-row { cursor: pointer; }
		.cr-row:hover { background: rgba(224, 242, 254, .7); }
		.cr-row-main { font-size: 14px; font-weight: 800; color: #0f172a; }
		.cr-row-sub { font-size: 11px; color: #b45309; margin-top: 3px; }
		.cr-open,
		.cr-act,
		.cr-alert-ack-btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-height: 34px;
			border: 1px solid transparent;
			border-radius: 999px;
			padding: 8px 14px;
			font-size: 12px;
			font-weight: 850;
			line-height: 1;
			white-space: nowrap;
			cursor: pointer;
			transition: background .15s, border-color .15s, box-shadow .15s, transform .15s;
		}
		.cr-open {
			min-width: 84px;
			background: #0284c7;
			border-color: #0284c7;
			color: #fff;
			box-shadow: 0 6px 14px rgba(2, 132, 199, .18);
		}
		.cr-open:hover { background: #0369a1; border-color: #0369a1; transform: translateY(-1px); }

		.cr-req {
			border: 1px solid #e2e8f0;
			border-radius: 18px;
			background: #fff;
			overflow: hidden;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-req-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 16px 20px;
			background: linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%);
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-req-id { font-size: 15px; font-weight: 800; color: #0f172a; margin-right: 10px; }
		.cr-req-status {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #fef9c3;
			color: #854d0e;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-req-client { font-size: 14px; font-weight: 700; color: #334155; text-align: right; }

		.cr-meta {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px 20px;
			padding: 18px 20px;
		}
		.cr-meta-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
		.cr-meta-item--wide { grid-column: span 2; }
		.cr-meta-label {
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .04em;
			text-transform: uppercase;
			color: #94a3b8;
		}
		.cr-meta-value { font-size: 14px; font-weight: 600; color: #1e293b; overflow-wrap: anywhere; }

		.cr-seal-wrap { padding: 0 20px 6px; overflow-x: auto; }
		.cr-seal-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.cr-seal-table th {
			text-align: left;
			padding: 8px 10px;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: #64748b;
			background: #f8fafc;
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-seal-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
		.cr-seal-no { font-weight: 700; }
		.cr-seal-dev { font-size: 11px; color: #94a3b8; }
		.cr-seal-loc { max-width: 260px; }
		.cr-seal-empty { text-align: center; color: #94a3b8; padding: 16px; }

		.cr-pill {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-pill--ok { background: #dcfce7; color: #166534; }
		.cr-pill--warn { background: #ffedd5; color: #9a3412; }
		.cr-pill--muted { background: #f1f5f9; color: #64748b; }
		.cr-pill--sub { background: #ede9fe; color: #5b21b6; }
		.cr-pill--parent { background: #e0f2fe; color: #075985; }

		.cr-seal-row--sub td { background: #fafaff; }
		.cr-seal-row--sub .cr-seal-no { font-weight: 600; }

		.cr-batt { font-weight: 800; font-size: 13px; }
		.cr-batt--ok { color: #16a34a; }
		.cr-batt--mid { color: #ca8a04; }
		.cr-batt--low { color: #dc2626; }
		.cr-batt--muted { color: #94a3b8; }

		.cr-req-actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 20px;
			border-top: 1px solid #f1f5f9;
			background: #fcfdff;
		}
		.cr-req-actions-right { display: flex; gap: 8px; }
		.cr-act--refresh { background: #e0f2fe; border-color: #bae6fd; color: #075985; }
		.cr-act--refresh:hover { background: #bae6fd; border-color: #38bdf8; }
		.cr-act--reject { background: #fff1f2; color: #b91c1c; border-color: #fecaca; }
		.cr-act--reject:hover { background: #fee2e2; border-color: #fca5a5; }
		.cr-act--approve { background: #16a34a; border-color: #16a34a; color: #fff; box-shadow: 0 6px 14px rgba(22, 163, 74, .16); }
		.cr-act--approve:hover { background: #15803d; border-color: #15803d; transform: translateY(-1px); }
		.cr-dialog .modal-dialog { max-width: 1180px; }
		.cr-dialog .modal-body { padding: 18px; background: #f8fbff; }
		.cr-dialog .form-layout { margin: 0; }
		.cr-modal-card .cr-req { box-shadow: none; }
		.cr-modal-card .cr-req-actions { position: sticky; bottom: 0; }

		.cr-empty { text-align: center; padding: 56px 24px; color: #64748b; }
		.cr-empty-icon { font-size: 40px; margin-bottom: 12px; }
		.cr-empty h3 { margin: 0 0 6px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-empty p { margin: 0 auto; max-width: 460px; font-size: 14px; }

		.cr-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 56px; color: #64748b; font-weight: 600; }
		.cr-spinner {
			width: 22px; height: 22px;
			border: 3px solid #e2e8f0; border-top-color: #0284c7;
			border-radius: 50%;
			animation: cr-spin .7s linear infinite;
		}
		@keyframes cr-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .cr-panel,
		[data-theme="dark"] .cr-req,
		[data-theme="dark"] .cr-table-wrap { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .cr-search-inline input,
		[data-theme="dark"] .cr-field input[type="date"],
		[data-theme="dark"] .cr-field select,
		[data-theme="dark"] .cr-clear-btn,
		[data-theme="dark"] .cr-alert-clear-btn,
		[data-theme="dark"] .cr-alert-download-btn,
		[data-theme="dark"] .cr-alert-refresh-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .cr-alert-download-menu {
			background: #1e293b;
			border-color: #334155;
		}
		[data-theme="dark"] .cr-alert-download-item { color: #cbd5e1; }
		[data-theme="dark"] .cr-alert-download-item:hover { background: #0f172a; }
		[data-theme="dark"] .cr-field > span { color: #7dd3fc; }
		[data-theme="dark"] .cr-toolbar { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .cr-tabs { background: #0f172a; border-color: #334155; }
		[data-theme="dark"] .cr-tab { background: #1e293b; border-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .cr-tab.active { background: #0284c7; color: #fff; border-color: #0284c7; }
		[data-theme="dark"] .cr-info-pill { background: #1e293b; border-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .cr-info-pill:hover { border-color: #64748b; }
		[data-theme="dark"] .cr-info-pill-count { background: #0f172a; color: #e2e8f0; }
		[data-theme="dark"] .cr-info-pill--critical { border-color: #7f1d1d; color: #fca5a5; }
		[data-theme="dark"] .cr-info-pill--critical .cr-info-pill-count { background: #450a0a; color: #fca5a5; }
		[data-theme="dark"] .cr-info-pill--warning { border-color: #78350f; color: #fcd34d; }
		[data-theme="dark"] .cr-info-pill--warning .cr-info-pill-count { background: #451a03; color: #fcd34d; }
		[data-theme="dark"] .cr-info-pill--info { border-color: #075985; color: #7dd3fc; }
		[data-theme="dark"] .cr-info-pill--info .cr-info-pill-count { background: #082f49; color: #7dd3fc; }
		[data-theme="dark"] .cr-req-head { background: #0b3a52; border-color: #334155; }
		[data-theme="dark"] .cr-arrival { background: #1e293b; border-color: #075985; }
		[data-theme="dark"] .cr-arrival-head { background: #082f49; border-color: #075985; }
		[data-theme="dark"] .cr-arrival-actions { background: #172033; border-color: #075985; }
		[data-theme="dark"] .cr-arrival-unlock-prompt { color: #7dd3fc; }
		[data-theme="dark"] .cr-arrival-unlock-btn--remote { background: #1e293b; color: #c4b5fd; border-color: #6d28d9; }
		[data-theme="dark"] .cr-arrival-unlock-btn--remote:hover:not(:disabled) { background: #2e1065; }
		[data-theme="dark"] .cr-arrival-unlock-btn--retained { background: #1e293b; color: #fdba74; border-color: #9a3412; }
		[data-theme="dark"] .cr-arrival-unlock-btn--retained:hover:not(:disabled) { background: #431407; }
		[data-theme="dark"] .cr-arrival-dialog .modal-header { background: #082f49; border-color: #075985; }
		[data-theme="dark"] .cr-arrival-dialog .modal-title { color: #bae6fd; }
		[data-theme="dark"] .cr-arrivals { border-color: #334155; }
		[data-theme="dark"] .cr-arrivals .cr-section-title,
		[data-theme="dark"] .cr-arrival-table th { background: #172033; border-color: #334155; }
		[data-theme="dark"] .cr-arrival-table td { background: #1e293b; border-color: #334155; color: #e2e8f0; }
		[data-theme="dark"] .cr-arrival-table tbody tr:hover td { background: #0b3a52; }
		[data-theme="dark"] .cr-arrival-journey { color: #f8fafc !important; }
		[data-theme="dark"] .cr-arrival-open { background: #082f49; border-color: #0284c7; color: #bae6fd; }
		[data-theme="dark"] .cr-arrival-unlock-btn--end { background: #1e293b; color: #fca5a5; border-color: #991b1b; }
		[data-theme="dark"] .cr-arrival-unlock-btn--end:hover:not(:disabled) { background: #450a0a; }
		[data-theme="dark"] .cr-section-title { color: #f8fafc; }
		[data-theme="dark"] .cr-req-id, [data-theme="dark"] .cr-queue-head h3,
		[data-theme="dark"] .cr-empty h3 { color: #f8fafc; }
		[data-theme="dark"] .cr-req-client, [data-theme="dark"] .cr-meta-value,
		[data-theme="dark"] .cr-seal-table td, [data-theme="dark"] .cr-queue-table td { color: #e2e8f0; }
		[data-theme="dark"] .cr-seal-table th, [data-theme="dark"] .cr-queue-table th { background: #0f172a; color: #94a3b8; border-color: #334155; }
		[data-theme="dark"] .cr-seal-table td, [data-theme="dark"] .cr-queue-table td { border-color: #334155; }
		[data-theme="dark"] .cr-row-main { color: #f8fafc; }
		[data-theme="dark"] .cr-row:hover { background: rgba(14, 165, 233, .08); }
		[data-theme="dark"] .cr-open { background: #0284c7; border-color: #0284c7; color: #fff; }
		[data-theme="dark"] .cr-act--refresh { background: #082f49; border-color: #075985; color: #bae6fd; }
		[data-theme="dark"] .cr-act--reject { background: #450a0a; border-color: #7f1d1d; color: #fecaca; }
		[data-theme="dark"] .cr-act--approve { background: #166534; border-color: #166534; color: #dcfce7; }
		[data-theme="dark"] .cr-alert-ack-btn { background: #1e293b; border-color: #475569; color: #e2e8f0; }
		[data-theme="dark"] .cr-alert-page-btn { background: #0c4a6e; border-color: #0369a1; color: #e0f2fe; }
		[data-theme="dark"] .cr-req-actions { background: #172033; border-color: #334155; }
		[data-theme="dark"] .cr-dialog .modal-body { background: #0f172a; }

		@media (max-width: 900px) { .cr-meta { grid-template-columns: repeat(2, minmax(0,1fr)); } }
		@media (max-width: 640px) {
			.cr-page { padding: 14px 8px 32px; }
			.cr-tab-body { padding: 14px; }
			.cr-arrivals { margin: -14px -14px 18px; }
			.cr-table-wrap { overflow-x: auto; }
			.cr-alert-table-wrap { overflow: auto; margin: -14px -14px 0; }
			.cr-alert-pagination { align-items: flex-start; flex-direction: column; }
			.cr-queue-table { min-width: 820px; }
			.cr-search-inline,
			.cr-field,
			.cr-field input[type="date"],
			.cr-field select,
			.cr-clear-btn,
			.cr-alert-clear-btn,
			.cr-alert-download-dropdown,
			.cr-alert-download-btn,
			.cr-alert-refresh-btn { width: 100%; }
			.cr-meta { grid-template-columns: 1fr; }
			.cr-meta-item--wide { grid-column: span 1; }
			.cr-req-head { flex-direction: column; align-items: flex-start; }
			.cr-req-client { text-align: left; }
		}
	`;
	document.head.appendChild(style);
}
