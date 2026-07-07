frappe.ready(() => {
	const sections = Array.from(document.querySelectorAll('.docs-section'));
	const navLinks = Array.from(document.querySelectorAll('.docs-nav .nav-link, .docs-nav .nav-sublink'));
	
	const prevLink = document.querySelector('.prev-link');
	const nextLink = document.querySelector('.next-link');
	const prevLabel = document.querySelector('.prev-label');
	const nextLabel = document.querySelector('.next-label');

	// Map of section IDs to their display titles
	const sectionTitles = {
		'welcome': 'Welcome',
		'intro-setup': 'Introduction & Setup',
		'customer-bookings': 'Customer Bookings',
		'inventory-devices': 'Inventory & Devices',
		'field-operations': 'Field Operations',
		'control-room': 'Control Room & Tracking',
		'billing-finance': 'Billing & Finance',
		'role-customer': 'Customer Portal User',
		'role-agent': 'Field Tagging Agent',
		'role-operator': 'Control Room Operator',
		'role-finance': 'Finance Manager',
		'role-admin': 'System Administrator'
	};

	// Sidebar toggle logic
	const toggleLinks = document.querySelectorAll('.nav-link-toggle');
	toggleLinks.forEach(link => {
		link.addEventListener('click', (e) => {
			if (e.target.tagName !== 'I' && link.getAttribute('href').startsWith('#')) {
				// Allow default anchor navigation if clicking the text itself
			} else {
				e.preventDefault();
			}
			
			const parentLi = link.closest('.nav-item');
			const sublist = parentLi.querySelector('.nav-sublist');
			const icon = link.querySelector('.toggle-icon');
			
			if (sublist) {
				sublist.classList.toggle('d-none');
				
				if (sublist.classList.contains('d-none')) {
					icon.classList.remove('fa-chevron-down');
					icon.classList.add('fa-chevron-right');
					parentLi.classList.remove('expanded');
				} else {
					icon.classList.remove('fa-chevron-right');
					icon.classList.add('fa-chevron-down');
					parentLi.classList.add('expanded');
				}
			}
		});
	});

	// Intersection Observer for scroll tracking
	const observerOptions = {
		root: null,
		rootMargin: '-20% 0px -60% 0px',
		threshold: 0
	};

	let currentSectionIndex = 0;

	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const id = entry.target.getAttribute('id');
				updateActiveSection(id);
			}
		});
	}, observerOptions);

	sections.forEach(sec => observer.observe(sec));

	function updateActiveSection(id) {
		// Update Sidebar Active state
		document.querySelectorAll('.docs-nav .nav-item.active').forEach(el => el.classList.remove('active'));
		
		const activeLink = document.querySelector(`.docs-nav a[href="#${id}"]`);
		if (activeLink) {
			const parentItem = activeLink.closest('.nav-item');
			if (parentItem) parentItem.classList.add('active');
			
			// Expand parent if it's a sublink
			const parentSublist = activeLink.closest('.nav-sublist');
			if (parentSublist && parentSublist.classList.contains('d-none')) {
				parentSublist.classList.remove('d-none');
				const toggleIcon = parentSublist.previousElementSibling.querySelector('.toggle-icon');
				if (toggleIcon) {
					toggleIcon.classList.remove('fa-chevron-right');
					toggleIcon.classList.add('fa-chevron-down');
				}
			}
		}

		// Update Pagination (Next / Prev)
		currentSectionIndex = sections.findIndex(sec => sec.id === id);
		
		if (currentSectionIndex > 0) {
			const prevId = sections[currentSectionIndex - 1].id;
			prevLink.href = `#${prevId}`;
			prevLabel.textContent = sectionTitles[prevId] || prevId;
			prevLink.classList.remove('invisible');
		} else {
			prevLink.classList.add('invisible');
		}

		if (currentSectionIndex < sections.length - 1) {
			const nextId = sections[currentSectionIndex + 1].id;
			nextLink.href = `#${nextId}`;
			nextLabel.textContent = sectionTitles[nextId] || nextId;
			nextLink.classList.remove('invisible');
		} else {
			nextLink.classList.add('invisible');
		}
	}
});
