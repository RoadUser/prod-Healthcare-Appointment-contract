# healthcare-appointments

Decentralized healthcare appointment scheduling smart contract for **Evernode** using the **HotPocket** Node.js contract runtime.

## Architecture overview
- **HotPocket contract** (Node.js) processes JSON messages via `submitContractInput` / `submitContractReadRequest`.
- **SQLite** database provides state persistence.
- **Role model**:
  - **Admin**: maintainer pubkey (`MAINTAINER_PUBKEY`) and/or entries in `Admin` table.
  - **Doctor**: a `DoctorRole` mapping binds `doctorId -> ownerPubKeyHex`.
  - **Patient**: patient identity is the HotPocket user pubkey hex (pseudonymous) stored in `Patient` table.

## Data model
Entities stored:
- Clinic `{id, name, active}`
- Doctor `{id, clinicId, displayName, specialty, timeZone, active, appointmentDurationsMinutes[], bufferMinutes, maxDailyAppointments, availabilityRules, exceptionDays, blackoutRanges, overbookingAllowed}`
- Patient `{id, displayName, timeZone, contactHash, preferences}`
- Appointment `{id, clinicId, doctorId, patientId, startTimeUtc, endTimeUtc, status, reasonCode, notesBlobRef?, createdAtUtc, updatedAtUtc}`

### Privacy & PII
- Patient `id` is **pseudonymous** (HotPocket pubkey hex).
- `contactHash` is stored instead of raw contact info.
- `notesBlobRef` is an opaque reference to **encrypted off-chain** content; contract never interprets note data.

## API / Message schema
All messages:
```json
{
  "Service": "Healthcare",
  "Action": "<ActionName>",
  "data": { }
}
```

### Admin actions
- `CreateClinic` `{ name }`
- `SetClinicActive` `{ clinicId, active }`
- `AddDoctor` `{ clinicId, displayName, specialty, timeZone, appointmentDurationsMinutes[], bufferMinutes, maxDailyAppointments, overbookingAllowed }`
- `UpdateDoctor` `{ doctorId, fields: { displayName?, specialty?, timeZone?, appointmentDurationsMinutes?, bufferMinutes?, maxDailyAppointments?, overbookingAllowed?, ownerPubKeyHex? } }`
- `SetDoctorActive` `{ doctorId, active }`
- `SetDoctorAvailability` `{ doctorId, availabilityRules[], exceptionDays[], blackoutRanges[] }`
- `SetPolicy` `{ cancellationWindowMinutes, rescheduleWindowMinutes, allowPatientNotes, overbookReasonCodes[] }`

### Patient actions
- `RegisterPatient` `{ displayName, timeZone, contactHash, preferences? }`
- `ListDoctors` `{ clinicId?, specialty?, active? }` (public)
- `GetDoctor` `{ doctorId }` (public)
- `GetAvailability` `{ doctorId, startDateUtc, endDateUtc }` (public)
- `BookAppointment` `{ doctorId, slotStartUtc, durationMinutes, reasonCode, notesBlobRef? }`
- `CancelAppointment` `{ appointmentId, reasonCode }`
- `RescheduleAppointment` `{ appointmentId, newSlotStartUtc }`
- `ListAppointmentsByPatient` `{ startDateUtc, endDateUtc, status? }`

### Doctor actions
- `ViewSchedule` `{ doctorId, startDateUtc, endDateUtc, status? }` (doctor self)
- `BlockTime` `{ doctorId, startUtc, endUtc, reasonCode }` (doctor self)
- `CancelAppointmentByDoctor` `{ doctorId, appointmentId, reasonCode }` (doctor self)
- `MarkCompleted` `{ doctorId, appointmentId }`
- `MarkNoShow` `{ doctorId, appointmentId }`

### Queries
- `GetAppointment` `{ appointmentId }` (admin or appointment owner)
- `ListClinics` `{ active? }` (public)

## Error codes
- `VALIDATION_FAILED`
- `ACCESS_DENIED`
- `NOT_FOUND`
- `CONFLICT`
- `POLICY_VIOLATION`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Booking and concurrency
- Booking uses `BEGIN IMMEDIATE` transaction.
- Overlap checks include **buffers** before/after appointments.
- Blackouts and doctor blocks are treated as busy ranges.
- `maxDailyAppointments` enforced for `BOOKED` appointments.

## Overbooking
- Doctor must have `overbookingAllowed=true`.
- Admin policy must include `reasonCode` in `overbookReasonCodes`.
- If both true, overlapping bookings are allowed only for those reason codes.

## Deployment
1. Install dependencies:
```bash
npm install
```
2. Set environment:
- `src/.env` must have `MAINTAINER_PUBKEY=<admin pubkey hex>`
3. Build:
```bash
npm run build
```
4. Deploy `dist/` using hpdevkit as per your Evernode workflow.

## Unit tests
- Configure `MAINTAINER_PUBKEY` to match the generated admin test key printed in test output.
- Run:
```bash
npm test
```
