# Sea Journey Workflow — TNT Seal Management

End-to-end process from customer booking to billed completion, as implemented in
`tnt_seal_management`. Five core doctypes drive the process; `Seal Journey` is the
central record that every other doctype mirrors its status onto.

## Step-by-Step Flow

### 1. Booking
- **Account Manager (Desk):** creates a **Tagging Booking** → `booking_status = Draft`,
  `booking_source = Account Manager`. One **Seal Journey** per booked vehicle is created
  immediately (`journey_status = Draft`) and listed in the booking's `seal_journeys` table.
- **Customer (portal, `create_customer_tagging_booking`):** booking lands as
  `Pending Account Manager Review`, `booking_source = Customer Portal`. No Seal Journey
  yet — it is created when the Account Manager submits to Finance.
  - If exactly one Account Manager exists, the booking is auto-assigned to them;
    otherwise it sits in a shared queue and an Account Manager claims it with
    `assign_to_me`.
  - **Notification:** the assigned Account Manager (or, for the shared queue, every
    enabled Account Manager) gets a desk notification + email.
  - The customer can cancel (`cancel_customer_tagging_booking` → `Cancelled`) only while
    it is still `Pending Account Manager Review`.
- Validation on save: booking date/time cannot be in the past, and every booked
  vehicle must be registered to the booking's client.

### 2. Finance Approval
- Account Manager runs `submit_to_finance` (from `Draft`, or `Pending Account Manager
  Review` for portal bookings — the portal booking must be assigned to them) →
  Booking `Pending Finance PCB Approval`; Seal Journey(s) created if missing and mirror
  the same status.
  - **Notification:** every enabled **Finance PCB** user gets a desk notification +
    email (booking number, client, location, date/time, contact, vehicles) linking to
    the booking.
- Finance runs `approve_booking` → Booking `Finance PCB Approved`;
  Seal Journey(s) → `Finance PCB Approved`.
  - A **PCB Job Order** is created/reused, `job_order_status = Unassigned`.
- Other Finance actions:
  - `reject_booking` → `Finance PCB Rejected` (Seal Journeys mirror it).
  - `amend_booking` (while pending Finance) → back to `Draft` /
    `Pending Account Manager Review` for correction and resubmission.
  - `reopen_booking` (after approval) → same revert, and the PCB Job Order is parked as
    `Cancelled` (reused on re-approval). Blocked once a tag operator is assigned or the
    journey has moved past `Team Lead Assigned`.
- Only **Finance PCB** (or System Manager) can change approval status/fields.

### 3. Team Lead & Technician Assignment
- PCB Job Order auto-assigns the sole **PCB Team Leader** on save →
  `job_order_status = Team Leader Assigned`; Seal Journey → `Team Lead Assigned`.
- Team Leader runs `assign_to_field_technician` →
  - Creates/updates a **PCB Assignment** (`assignment_status = Assigned`).
  - Creates **one Journey Request for the whole booking** (`journey_request_status =
    Draft`). Its **Vehicles** table (`Journey Request Vehicle`) gets one row per booked
    vehicle, each linked to that vehicle's own Seal Journey and carrying its own
    `status`.
  - Every vehicle's Seal Journey → `Technician Assigned`.

> **Multi-vehicle requests.** From here on each vehicle row moves through the stages
> on its own: submit, approve, return for amendment, complete tagging, untag and seal
> return all act on one vehicle (`vehicle_row`) or, if none is named, on every vehicle
> currently at that stage. Each action updates only the matching vehicle's Seal Journey.
> The Journey Request's own `journey_request_status` is a roll-up: `Pending Control
> Room Approval` while any vehicle is waiting for the Control Room, otherwise the stage
> of the vehicle furthest behind. It is used for display and field locks only. Each
> per-vehicle action is logged in the Approval Log with that vehicle's plate. A request
> with a single vehicle (or a legacy request with no vehicle rows) behaves as one unit.

### 4. Pre-Tagging & Submission to Control Room
- Field Technician fills the Journey Request: file number, departure card number,
  seals, pre-tagging checklist, tagging photos. These are shared across the request.
- **Seals per vehicle:** on a multi-vehicle request every seal row must name the
  vehicle it is fitted to (`Journey Request Seal.vehicle`). Every vehicle being
  submitted needs at least one seal, and a seal can't name a vehicle that isn't on
  the request. A seal can appear only once across the whole request. With two or more
  vehicles the Seals grid shows a **Vehicle** column, and each new seal row without one
  is filled with the next vehicle that has no seal yet. The technician can change it.
- **Technician — "Submit to Control Room"** (button on the Seals grid toolbar, shown
  while any vehicle is in `Draft`; calls `submit_to_control_room`):
  - The form is saved first if it has unsaved changes, and the Pre-Tagging Checklist
    must be complete.
  - One `Draft` vehicle: submits straight away.
  - Two or more `Draft` vehicles: a **"Vehicles to submit"** dialog lists them with every
    box ticked. Untick any vehicle to keep it in `Draft` and submit it later. Vehicles
    already approved are not affected.
  - Submitted vehicle rows → `Pending Control Room Approval`; their Seal Journeys →
    `Pre-Tagging`. Custody of each submitted vehicle's seals moves **Warehouse →
    Technician**, recorded against that vehicle's Seal Journey.
  - The Control Room is notified (desk + email).

#### Control Room — reviewing a multi-vehicle request

A request appears in the queue while **any** of its vehicles is `Pending Control Room
Approval` (the roll-up status). The Control Room can act from two places.

**Control Room page → Approve tab** (`page/control_room`). Each request is a card:
- Header and details: request, client, Tag Operator, job order, vehicles, driver, route,
  entry/container.
- **Vehicles table** (only when the request has vehicle rows): one line per vehicle with
  a status pill, either **Pending** (awaiting review), **Returned** (in `Draft`: sent back,
  or not yet submitted) or **Approved** (moved past review). Pending vehicles get their
  own buttons:
  - **Approve**: optional-remarks dialog titled "Approve `<request> · <plate>`"; approves
    only that vehicle (`approve_by_control_room` with `vehicle_row`).
  - **Return**: required "What needs to be amended" dialog; sends only that vehicle back
    to `Draft` (`return_for_amendment_by_control_room` with `vehicle_row`).
- **Seal table**: every seal on the request (parent/sub-seal, lock, device status, battery,
  location, last update). On a multi-vehicle request a leading **Vehicle** column shows
  the plate each seal is fitted to, so seals can be checked against the vehicle being
  approved.
- Footer buttons:
  - **Refresh Seal Status**: pulls live lock/battery/location for the seals.
  - **Approve All Pending** (shown as **Approve** for a single vehicle): approves every
    vehicle still pending.
  - **Return All Pending** (shown as **Return for Amendment** for a single vehicle):
    returns every vehicle still pending; remarks required.
- After each action the queue reloads. The card leaves the queue once no vehicle is
  pending, while vehicles approved earlier stay approved.

**Journey Request form** (Control Room users, while any vehicle is pending):
- **Approve** (primary) and **Return for Amendment**: with one pending vehicle they act
  straight away. With two or more, a **"Which vehicle?"** dialog offers **All (N
  vehicles)** (the default) or a single plate. Approve uses the form's Control Room
  Remarks; Return asks for remarks.
- **Seals ▸ Refresh Seal Status** and **Seals ▸ Swap Seal**. Swap Seal picks a seal on
  the request and replaces it with an `Available` Seal Device; it is allowed only while
  the request is pending Control Room approval.

**Effects:**
- Approve: that vehicle row → `Tagging` (approver, time and remarks stored on the row)
  and its Seal Journey → `Tagging In Progress`.
- Return: that vehicle row → `Draft`. Its Seal Journey status is unchanged, and the
  technician is notified and can correct and resubmit just that vehicle.
- Both are logged in the Approval Log against the vehicle's plate.

### 5. Control Room Approval
- Covered in detail under step 4 (*Control Room — reviewing a multi-vehicle
  request*). `approve_by_control_room` moves a vehicle to `Tagging` (Seal Journey
  `Tagging In Progress`); `return_for_amendment_by_control_room` sends it back to
  `Draft`. Either can target one vehicle or all pending vehicles.

### 6. Tagging → Journey Starts
- Field Technician runs `complete_tagging` for one vehicle or for every vehicle in
  `Tagging` (captures live GPS location from that vehicle's seals) → vehicle row
  `Journey Ready`. On a multi-vehicle request the confirmation tick, tagging time and
  remarks are given per call and stored on the vehicle row.
- That vehicle's Seal Journey is finalized (plate, container, route, **only that
  vehicle's seals**, photos) and set directly to `In Transit`; its seals' custody →
  **Customer**. Other vehicles on the request are unaffected and can still be tagged
  later.
- There is no separate approval gate after tagging — the technician's own
  confirmation both closes tagging and starts the journey.

### 7. In Transit
- Live GPS/API telemetry (Uffizio integration) streams into the Seal Journey
  Transit tab via **Seal API Sync Log**.
- Anomalies raise **Seal Alert Log** entries (Critical/Warning/Info).

### 8. Arrival
Arrival is confirmed only from the **Control Room page → Approve tab** (Operations
Control Room role); the Seal Journey form has no arrival buttons. It is confirmed per
Seal Journey, so each vehicle of a multi-vehicle booking arrives, is untagged and has
its seal returned on its own.

**Arrivals — Confirm Seal Unlocked** section (below the Journey Request queue):
- Lists every Seal Journey that is `In Transit`, oldest journey start first, with
  pagination. The page search box also filters it (journey, customer, plate,
  container, seal, origin, destination, last location).
- Columns: **Journey**, **Vehicle**, **Seal Device**, **Last Location**, and a **View**
  button.
- **View** opens an **"Arrival — `<journey>`"** dialog showing customer, vehicle,
  container, seal device, route, last known location, journey start and last API
  update. It is headed *"Confirm arrival — how is the seal unlocked?"* and has four
  buttons:

| Button | `unlock_method` | Confirmation prompt | Result |
|---|---|---|---|
| **Physical Unlock — Send for Untagging** | `physical` | Confirms a physical unlock; warns that an untagging assignment is raised and it can't be undone | Seal Journey → `Arrived`; an **Untagging PCB Assignment** is raised for the PCB Team Leader (step 9) |
| **Remote Unlock — Skip to Seal Return** | `remote` | Confirms a remote unlock; warns that untagging is skipped and a seal return assignment is raised | Seal Journey → `Awaiting Seal Return`; a **Seal Return PCB Assignment** is raised (step 10) |
| **Remote Unlock — Seal Stays on Vehicle** | `remote_retained` | "…REMOTE unlock and the seal LEFT ON THE VEHICLE?" | For destinations too far to collect from. Seal Journey → `Completed` right away; vehicle row → `Closed - Seal Retained`; seal → `Available`, with custody staying with the customer until its next booking |
| **End Journey** | `end_journey` | "End `<journey>` now?" | Nobody at the destination to unlock or collect. Same outcome as the row above; only the recorded reason differs |

- Every option is confirmed with a Yes/No prompt and then calls
  `seal_journey.confirm_arrival`. Arrival time and location (pulled live from the seal's
  GPS) are recorded and the seal is marked unlocked. The dialog closes, a green alert
  confirms the outcome, and the arrivals list reloads. The action can only be run
  while the journey is `In Transit`.

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
  Journey Request `Pending Seal Return Approval`. The PCB Team Leader (the journey's
  assigned team lead, else every PCB Team Leader) gets a desk notification + email.
- PCB Team Leader runs `approve_seal_return` on the Journey Request →
  Journey Request `Seal Returned`; Seal Journey → `Completed`;
  Seal Device → back to `Available` automatically (or `Damaged` / `Lost` if that
  was the return condition), custody → **Warehouse**.
- `reject_seal_return` (remarks required) sends it back to `Awaiting Seal Return`
  with the technician's confirmation tick cleared, and notifies the technician.

### 11. Billing
- Billing is recomputed on every Seal Journey save via **Seal Billing Rate**
  (through **Customer Billing Assignment**):
  `billing_status = Not Billed → Pending Billing` (or `No Per-Journey Charge`).
- Billing rules (**Seal Billing Rate**) need **Managing Director** approval: a new rule,
  or an approved rule whose terms change, is `Pending Approval` (MD notified) and its
  customers stay disabled until `approve_seal_billing_rate` (creator notified of the
  approve/reject decision).
- Finance generates an ERPNext Sales Order per customer for completed, unbilled journeys
  from the **Completed Journeys** page (**Generate Sales Order**, `generate_sales_order`)
  → `billing_status = Processing Payment`. The customer's portal users are emailed.
- The customer **Accepts** or **Rejects** (reason required, one-shot) on the Customer
  Portal's Sales Orders tab (`set_sales_order_response`); Finance PCB is notified.
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

**Journey Request (`journey_request_status`, and each vehicle row's `status`)**:
```
Draft → Pending Control Room Approval → Tagging
→ Journey Ready → Untagging → Awaiting Seal Return
→ Pending Seal Return Approval → Seal Returned
(Closed - Seal Retained for remote-retained / end-journey arrivals;
 Control Room / seal-return kickbacks send a vehicle back a stage;
 Cancelled when the PCB Assignment is cancelled)
```
On a multi-vehicle request the document status is the roll-up described under step 3.

**Tagging Booking (`booking_status`)**:
```
Draft (Account Manager)  |  Pending Account Manager Review (Customer Portal)
→ Pending Finance PCB Approval
→ Finance PCB Approved / Finance PCB Rejected
(amend/reopen return it to Draft / Pending Account Manager Review;
 Cancelled = customer cancelled while Pending Account Manager Review)
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

- `cancel_customer_tagging_booking` — customer, while `Pending Account Manager Review`.
- `reject_booking` / `amend_booking` — while pending Finance approval.
- `reopen_booking` — after Finance approval, until a tag operator is assigned.
- `return_for_amendment_by_control_room` — before tagging begins (per vehicle or all).
- `_cancel_assignment` on PCB Assignment — unwinds the whole chain: Journey Request
  → `Cancelled`, Tagging Booking → back to `Pending Finance PCB Approval`,
  Seal Journey → back to `Pending Finance PCB Approval`. Only allowed before tagging
  has actually started (`_TAGGING_STARTED_JOURNEY_STATUSES` guard).

## Notifications

Sent via `api/notifications.py:notify_users` — a desk Notification Log (bell) plus an
email through the site's default outgoing Email Account. Failures are logged
(`TNT Notify`), never raised, so they cannot block the workflow action.

| Trigger | Recipients | Action needed |
|---|---|---|
| Customer portal booking created | Assigned Account Manager, else all Account Managers | Claim/review, submit to Finance |
| `submit_to_finance` | All Finance PCB users | Approve or amend |
| `amend_booking` / `reopen_booking` / `reject_booking` | The booking's Account Manager (else the staff user who raised it) | Correct and resubmit / follow up with client |
| PCB Job Order assigned to a Team Leader (on Finance approval, incl. re-approval) | That PCB Team Leader | Assign a Tag Operator |
| Tag Operator assigned (Tagging / Untagging / Seal Return) | The Field Technician | Do the job |
| `submit_to_control_room` | Control Room roles | Approve / return each vehicle |
| `approve_by_control_room` | The Field Technician (lists the approved vehicles) | Complete tagging |
| `return_for_amendment_by_control_room` | The Field Technician | Correct and resubmit |
| Critical seal alert (sync) | Control Room alert recipients | Resolve the alert |
| `confirm_arrival` physical / remote (new Untagging / Seal Return PCB Assignment) | The journey's PCB Team Leader | Assign a Tag Operator |
| `confirm_seal_return` | Journey's team lead, else every PCB Team Leader | Approve / return |
| `approve_seal_return` / `reject_seal_return` | The Field Technician | None / correct and reconfirm |
| PCB Assignment cancelled | Released technician + Finance PCB | Re-approve / reassign |
| Seal Billing Rate enters `Pending Approval` (new, or approved terms changed) | Managing Director | Approve / reject |
| `approve_seal_billing_rate` / `reject_seal_billing_rate` | The rule's creator | Revise if rejected |
| `generate_sales_order` (Completed Journeys) | Customer's portal users, **email only** | Accept / reject on the portal |
| `set_sales_order_response` (portal) | All Finance PCB users | Follow up on rejections |

Not notified (no one has to act): `complete_tagging` (journey just goes In Transit),
remote-retained / end-journey arrivals (journey completes), and journeys reaching
`Pending Billing` (Finance invoices them in periodic batches from Completed Journeys).

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

- `Tagging Booking.seal_journeys` (child table) → one Seal Journey per vehicle;
  `seal_journey_reference` → the first one (kept for older code)
- `Tagging Booking.pcb_job_order_reference` → PCB Job Order
- `PCB Job Order.tagging_booking` → Tagging Booking
- `PCB Job Order.assignment_reference` → PCB Assignment
- `PCB Assignment.pcb_job_order / seal_journey / tagging_booking` → respective docs
- `Journey Request.job_order` → PCB Job Order; `journey_reference` → Seal Journey
- `Seal Journey.tagging_booking / pcb_job_order / pcb_assignment / journey_request`
  → all four upstream docs (mirror source of truth)
