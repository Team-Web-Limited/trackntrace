const CUSTOMER_BOOKING_API =
	"tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings";

frappe.ready(() => {
	const root = document.querySelector("[data-customer-portal]");
	if (!root) return;

	bindTabs(root);
	root.querySelector("[data-booking-form]").addEventListener("submit", (event) => {
		event.preventDefault();
		createBooking(root, event.currentTarget);
	});
	root.querySelector("[data-booking-rows]").addEventListener("click", (event) => {
		const button = event.target.closest("[data-cancel-booking]");
		if (button) cancelBooking(root, button.dataset.cancelBooking);
	});

	loadBookings(root);
});

function bindTabs(root) {
	root.querySelectorAll("[data-tab-trigger]").forEach((button) => {
		button.addEventListener("click", () => setActiveTab(root, button.dataset.tabTrigger));
	});
}

function setActiveTab(root, tabName) {
	root.querySelectorAll("[data-tab-trigger]").forEach((button) => {
		button.classList.toggle("is-active", button.dataset.tabTrigger === tabName);
	});

	root.querySelectorAll("[data-tab-panel]").forEach((panel) => {
		panel.classList.toggle("d-none", panel.dataset.tabPanel !== tabName);
	});
}

async function loadBookings(root) {
	setError(root, "");
	root.querySelector("[data-booking-loading]").classList.remove("d-none");
	root.querySelector("[data-booking-empty]").classList.add("d-none");
	root.querySelector("[data-booking-table-wrap]").classList.add("d-none");

	try {
		const response = await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.get_customer_tagging_bookings`,
		});
		const result = response.message || {};
		renderBookings(root, result.bookings || []);
	} catch (error) {
		setError(root, getErrorMessage(error));
	} finally {
		root.querySelector("[data-booking-loading]").classList.add("d-none");
	}
}

async function createBooking(root, form) {
	const countryCode = form.querySelector("[data-phone-country]")?.value || "";
	const phoneNumber = (form.querySelector("[data-phone-number]")?.value || "").trim();

	if (!phoneNumber) {
		setError(root, __("Phone Number is required."));
		return;
	}

	const button = form.querySelector("[data-submit-booking]");
	button.disabled = true;
	setError(root, "");

	const data = Object.fromEntries(new FormData(form).entries());
	data.contact_person_phone = countryCode + "-" + phoneNumber;

	try {
		await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.create_customer_tagging_booking`,
			args: { data: JSON.stringify(data) },
		});
		form.reset();
		setActiveTab(root, "list");
		frappe.show_alert({ message: __("Tagging booking submitted"), indicator: "green" }, 5);
		await loadBookings(root);
	} catch (error) {
		setError(root, getErrorMessage(error));
	} finally {
		button.disabled = false;
	}
}

async function cancelBooking(root, name) {
	if (!window.confirm(__("Cancel booking {0}?", [name]))) return;
	setError(root, "");
	try {
		await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.cancel_customer_tagging_booking`,
			args: { name },
		});
		frappe.show_alert({ message: __("Booking cancelled"), indicator: "orange" }, 5);
		await loadBookings(root);
	} catch (error) {
		setError(root, getErrorMessage(error));
	}
}

function renderBookings(root, bookings) {
	const empty = root.querySelector("[data-booking-empty]");
	const table = root.querySelector("[data-booking-table-wrap]");
	const rows = root.querySelector("[data-booking-rows]");
	rows.innerHTML = "";

	if (!bookings.length) {
		empty.classList.remove("d-none");
		return;
	}

	rows.innerHTML = bookings.map(bookingRow).join("");
	table.classList.remove("d-none");
}

function bookingRow(booking) {
	const statusClass = String(booking.status || "")
		.toLowerCase()
		.replaceAll(" ", "-");
	const requestedDate = booking.booking_date_time
		? frappe.datetime.str_to_user(booking.booking_date_time)
		: "—";
	const action = booking.can_cancel
		? `<button class="btn btn-sm btn-outline-danger" data-cancel-booking="${escapeHtml(
				booking.name
		  )}">${__("Cancel")}</button>`
		: "—";

	return `<tr>
		<td><strong>${escapeHtml(booking.name)}</strong></td>
		<td>${escapeHtml(booking.location || "—")}</td>
		<td>${escapeHtml(requestedDate)}</td>
		<td>${escapeHtml(booking.contact_person_phone || "—")}</td>
		<td><span class="tb-status tb-status--${statusClass}">${escapeHtml(booking.status || "—")}</span></td>
		<td class="text-right">${action}</td>
	</tr>`;
}

function setError(root, message) {
	const box = root.querySelector("[data-portal-error]");
	box.textContent = message || "";
	box.classList.toggle("d-none", !message);
}

function getErrorMessage(error) {
	return error?._server_messages
		? JSON.parse(error._server_messages).map((item) => JSON.parse(item).message).join(" ")
		: error?.message || __("Something went wrong. Please try again.");
}

function escapeHtml(value) {
	return frappe.utils.escape_html(String(value ?? ""));
}
