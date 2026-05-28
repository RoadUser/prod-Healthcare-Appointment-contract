const HotPocket = require("hotpocket-js-client");
const { connectClient, assertSuccess, assertError, assertTrue } = require("../test-utils");

const URL = "wss://localhost:8081";

async function runBookingConflictAndPolicyTests() {
  const adminKeys = await HotPocket.generateKeys();
  const patientKeysA = await HotPocket.generateKeys();
  const patientKeysB = await HotPocket.generateKeys();

  console.log("Admin pubkey hex (set as MAINTAINER_PUBKEY):", Buffer.from(adminKeys.publicKey).toString("hex"));

  const admin = await connectClient(URL, adminKeys);
  const pA = await connectClient(URL, patientKeysA);
  const pB = await connectClient(URL, patientKeysB);

  // Create clinic and doctor
  const cc = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "CreateClinic", data: { name: "Clinic B" }
  })))).toString());
  assertSuccess(cc);

  const clinicId = cc.success.clinic.id;

  const ad = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "AddDoctor",
    data: { clinicId, displayName: "Dr. Bob", specialty: "Dermatology", timeZone: "UTC", appointmentDurationsMinutes: [30], bufferMinutes: 10, maxDailyAppointments: 2, overbookingAllowed: false }
  })))).toString());
  assertSuccess(ad);
  const doctorId = ad.success.doctor.id;

  // bind doctor ownership to some pubkey (not used in this suite)
  await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "UpdateDoctor",
    data: { doctorId, fields: { ownerPubKeyHex: Buffer.from((await HotPocket.generateKeys()).publicKey).toString("hex") } }
  })));

  // Set policy: cancellation/reschedule must be >= 10000 minutes for easy policy violation testing
  const pol = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "SetPolicy",
    data: { cancellationWindowMinutes: 10000, rescheduleWindowMinutes: 10000, allowPatientNotes: true, overbookReasonCodes: [] }
  })))).toString());
  assertSuccess(pol);

  // Set availability for today only (dayOfWeek)
  const now = new Date();
  const dow = now.getUTCDay();
  await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "SetDoctorAvailability",
    data: {
      doctorId,
      availabilityRules: [{ dayOfWeek: dow, startTime: "00:00", endTime: "23:55" }],
      exceptionDays: [],
      blackoutRanges: []
    }
  })));

  // Register patients
  assertSuccess(JSON.parse((await pA.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "RegisterPatient", data: { displayName: "A", timeZone: "UTC", contactHash: "hashA" }
  })))).toString()));
  assertSuccess(JSON.parse((await pB.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "RegisterPatient", data: { displayName: "B", timeZone: "UTC", contactHash: "hashB" }
  })))).toString()));

  // Get availability and pick first slot
  const startIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
  const endIso = new Date(Date.parse(startIso) + 86400000).toISOString();

  const av = JSON.parse((await pA.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "GetAvailability", data: { doctorId, startDateUtc: startIso, endDateUtc: endIso }
  })))).toString());
  assertSuccess(av);
  assertTrue(av.success.slots.length > 0, "Expected at least one slot");
  const slot = av.success.slots[0];

  // Book appointment (patient A)
  const bookA = JSON.parse((await pA.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "BookAppointment",
    data: { doctorId, slotStartUtc: slot.slotStartUtc, durationMinutes: slot.durationMinutes, reasonCode: "CHECKUP", notesBlobRef: "blob://opaque" }
  })))).toString());
  assertSuccess(bookA);
  const apptId = bookA.success.appointment.id;

  // Attempt double-booking same slot (patient B) -> CONFLICT
  const bookB = JSON.parse((await pB.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "BookAppointment",
    data: { doctorId, slotStartUtc: slot.slotStartUtc, durationMinutes: slot.durationMinutes, reasonCode: "CHECKUP" }
  })))).toString());
  assertError(bookB, "CONFLICT");

  // Cancellation policy violation: cancellationWindowMinutes huge so should fail
  const cancelA = JSON.parse((await pA.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "CancelAppointment",
    data: { appointmentId: apptId, reasonCode: "CHANGE_OF_PLANS" }
  })))).toString());
  assertError(cancelA, "POLICY_VIOLATION");

  // Reschedule policy violation
  const resched = JSON.parse((await pA.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "RescheduleAppointment",
    data: { appointmentId: apptId, newSlotStartUtc: new Date(Date.parse(slot.slotStartUtc) + 3600000).toISOString() }
  })))).toString());
  assertError(resched, "POLICY_VIOLATION");

  await admin.close();
  await pA.close();
  await pB.close();
}

module.exports = { runBookingConflictAndPolicyTests };
