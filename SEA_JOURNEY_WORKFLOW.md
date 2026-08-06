# Sea Journey Workflow — TNT Seal Management

End-to-end process from customer booking to billed completion, as implemented in
`tnt_seal_management`. Five core doctypes drive the process; `Seal Journey` is the
central record that every other doctype mirrors its status onto.

## Step-by-Step Flow

### 1. Booking
- Customer (portal) or Account Manager creates a **Tagging Booking**.
  `booking_status = Draft` (or `Pending Account Manager Review` for portal bookings).
- A **Seal Journey** is created immediately and linked (`journey_status = Draft`).

### 2. Finance Approval
- Account Manager runs `submit_to_finance` → Booking `Pending Finance PCB Approval`;
  Seal Journey mirrors the same status.
- Finance runs `approve_booking` → Booking `Finance PCB Approved`;
  Seal Journey → `Finance PCB Approved`.
  - A **PCB Job Order** is created/reused, `job_order_status = Unassigned`.
  - (`reject_booking` → `Finance PCB Rejected`; `reopen_booking` reverts to Draft.)

### 3. Team Lead & Technician Assignment
- PCB Job Order auto-assigns the sole **PCB Team Leader** on save →
  `job_order_status = Team Leader Assigned`; Seal Journey → `Team Lead Assigned`.
- Team Leader runs `assign_to_field_technician` →
  - Creates/updates a **PCB Assignment** (`assignment_status = Assigned`).
  - Creates a **Journey Request** (`journey_request_status = Draft`).
  - Seal Journey → `Technician Assigned`.

### 4. Pre-Tagging & Submission to Control Room
- Field Technician fills the Journey Request: entry/departure card numbers, seals,
  pre-tagging checklist, tagging photos.
- Runs `submit_to_control_room` → Journey Request `Pending Control Room Approval`;
  Seal Journey → `Pre-Tagging`; seal custody moves **Warehouse → Technician**.
- `swap_seal` is available only at this stage if a seal needs replacing.

### 5. Control Room Approval
- Operations Control Room runs `approve_by_control_room` →
  Journey Request `Tagging`; Seal Journey → `Tagging In Progress`.
- (`reject_by_control_room` → `Rejected`.)

### 6. Tagging → Journey Starts
- Field Technician runs `complete_tagging` (captures live GPS location) →
  Journey Request `Journey Ready`; Seal Journey is finalized (vehicle, container,
  seals table, photos) and set directly to `In Transit`; seal custody → **Customer**.
- There is no separate approval gate after tagging — the technician's own
  confirmation both closes tagging and starts the journey.

### 7. In Transit
- Live GPS/API telemetry (Uffizio integration) streams into the Seal Journey
  Transit tab via **Seal API Sync Log**.
- Anomalies raise **Seal Alert Log** entries (Critical/Warning/Info).

### 8. Arrival
- Operations Control Room runs `confirm_arrival` on the Seal Journey, choosing an
  unlock method:
  - **Physical unlock** → Seal Journey `Arrived`; raises an **Untagging PCB Assignment**.
  - **Remote unlock** → Seal Journey skips straight to `Awaiting Seal Return`; raises a
    **Seal Return PCB Assignment**.

### 9. Untagging (physical-unlock path only)
- Team Leader assigns a technician on the Untagging PCB Assignment →
  Journey Request `Untagging`; Seal Journey → `Untagging In Progress`.
- Control Room runs `start_untagging` / `complete_untagging` on the Seal Journey →
  `Untagged`.
- Field Technician runs `confirm_untagging` on the Journey Request (evidence photos +
  confirmation) → Journey Request `Awaiting Seal Return`; Seal Journey →
  `Awaiting Seal Return`.

### 10. Seal Return
- Field Technician runs `confirm_seal_return` on the Journey Request (seal condition,
  retrieval card number, return warehouse, evidence photos) →
  Journey Request `Seal Returned`; Seal Journey → `Completed`;
  Seal Device → back to `Available` automatically (or `Damaged` / `Lost` if that
  was the return condition), custody → **Warehouse**.

### 11. Billing
- Billing is recomputed on every Seal Journey save via **Seal Billing Rate**
  (through **Customer Billing Assignment**):
  `billing_status = Not Billed → Pending Billing` (or `No Per-Journey Charge`).
- Finance generates an ERPNext Sales Order for completed, unbilled journeys
  (`generate_sales_order`) → `billing_status = Processing Payment`.
- On Sales Invoice payment (`sync_billing_from_sales_invoice` hook) →
  `billing_status = Billed` — the journey is fully closed out.

## Status Reference

**Seal Journey (`journey_status`)** — the authoritative end-to-end status:
```
Draft
→ Pending Finance PCB Approval
→ Finance PCB Approved / Finance PCB Rejected
→ Team Lead Assigned
→ Technician Assigned
→ Pre-Tagging
→ Tagging In Progress
→ Tagged
→ In Transit  (technician's complete_tagging confirmation moves it here directly)
→ Arrived  (physical unlock)  |  Awaiting Seal Return  (remote unlock)
→ Untagging In Progress → Untagged → Awaiting Seal Return   (physical path only)
→ Completed
→ Cancelled
```

**Journey Request (`journey_request_status`)**:
```
Draft → Pending Control Room Approval → Tagging
→ Journey Ready → Untagging → Awaiting Seal Return → Seal Returned
(Rejected / Cancelled at approval gates)
```

**Tagging Booking (`booking_status`)**:
```
Draft → Pending Account Manager Review → Pending Finance PCB Approval
→ Finance PCB Approved / Finance PCB Rejected → Cancelled
```

**PCB Job Order (`job_order_status`)**:
```
Unassigned → Team Leader Assigned → Completed / Cancelled
```

**PCB Assignment (`assignment_status`)**:
```
Pending → Assigned
→ Pending Untagging Assignment → Untagging Assigned
→ Pending Seal Return Assignment → Seal Return Assigned
→ Cancelled
```

**Seal Device (`current_status`)**:
```
Quality Check → Available → Assigned → In Journey → Arrived → Untagged → Available
(on seal return the device goes straight back to Available — there is no
"Returned" status; Damaged / Lost / Inactive can apply at any point)
```

## Cancellation / Rework Paths

Cancellation and rejection are possible at nearly every stage, guarded by checks that
block reversal once real field work has started:

- `reject_booking` / `reopen_booking` — before Finance approval.
- `reject_by_control_room` — before tagging begins.
- `_cancel_assignment` on PCB Assignment — unwinds the whole chain: Journey Request
  → `Cancelled`, Tagging Booking → back to `Pending Finance PCB Approval`,
  Seal Journey → back to `Pending Finance PCB Approval`. Only allowed before tagging
  has actually started (`_TAGGING_STARTED_JOURNEY_STATUSES` guard).

## Audit Trail

Every action on a Journey Request (submitted, approved/rejected, tagging completed,
untagging confirmed, seal return confirmed, etc.) is logged with actor, timestamp, and
remarks in the **Journey Request Approval** child table — this is the human-readable
history of the journey.

## Doctype Relationships

```
Tagging Booking ──► Seal Journey ◄── PCB Job Order ◄── PCB Assignment
                          ▲                                   │
                          └──────────── Journey Request ◄─────┘
```

- `Tagging Booking.seal_journey_reference` → Seal Journey
- `Tagging Booking.pcb_job_order_reference` → PCB Job Order
- `PCB Job Order.tagging_booking` → Tagging Booking
- `PCB Job Order.assignment_reference` → PCB Assignment
- `PCB Assignment.pcb_job_order / seal_journey / tagging_booking` → respective docs
- `Journey Request.job_order` → PCB Job Order; `journey_reference` → Seal Journey
- `Seal Journey.tagging_booking / pcb_job_order / pcb_assignment / journey_request`
  → all four upstream docs (mirror source of truth)
