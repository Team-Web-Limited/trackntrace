"""Central gate for every code path that fabricates records.

Seed / demo / dev-fixture data must never be created on a production site.
Patches and install hooks are the only things in this app that write records
without a human asking for them, and on a live site that means inventing
masters (Transport Locations, billing rate cards, demo Customers) alongside
real data — or mutating real rows to match a dev database's document ids.

Seeding is therefore **opt-in**: it runs only where ``site_config.json``
explicitly enables it. A production site that never sets the flag can never be
seeded, no matter which patch or hook is added later.

Enable it on a local/dev site with::

    bench --site <site> set-config tnt_allow_seed_data 1

Schema changes (Custom Fields, column renames, status normalisation) are NOT
seeding and must stay ungated — they have to run everywhere.
"""

import frappe

SEED_FLAG = "tnt_allow_seed_data"


def seeding_allowed() -> bool:
	"""True only on a site that has explicitly opted in to seed data."""
	return bool(frappe.conf.get(SEED_FLAG))
