const HotPocket = require("hotpocket-js-client");
const { connectClient, assertSuccess, assertError, assertTrue } = require("../test-utils");

const URL = "wss://localhost:8081";

async function runDoctorActionsAndAccessControlTests() {
  const adminKeys = await HotPocket.generateKeys();
  const doctorKeys = await HotPocket.generateKeys();
  const patientKeys = await HotPocket.generateKeys();
  const otherPatientKeys = await HotPocket.generateKeys();

  console.log("Admin pubkey hex (set as MAINTAINER_PUBKEY):", Buffer.from(adminKeys.publicKey).toString("hex"));

  const admin = await connectClient(URL, adminKeys);
  const doctor = await connectClient(URL, doctorKeys);
  const patient = await connectClient(URL, patientKeys);
  const otherPatient = await connectClient(URL, otherPatientKeys);

  // Setup
  const cc = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "CreateClinic", data: { name: "Clinic C" }
  })))).toString());
  assertSuccess(cc);
  const clinicId = cc.success.clinic.id;

  const ad = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "AddDoctor",
    data: { clinicId, displayName: "Dr. Self", specialty: "General", timeZone: "UTC", appointmentDurationsMinutes: [30], bufferMinutes: 5, maxDailyAppointments: 5, overbookingAllowed: false }
  })))).toString());
  assertSuccess(ad);
  const doctorId = ad.success.doctor.id;

  // Bind doctor ownership
  const bind = JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "UpdateDoctor",
    data: { doctorId, fields: { ownerPubKeyHex: Buffer.from(doctorKeys.publicKey).toString("hex") } }
  })))).toString());
  assertSuccess(bind);

  // Set policy allowing cancellation
  assertSuccess(JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "SetPolicy",
    data: { cancellationWindowMinutes: 0, rescheduleWindowMinutes: 0, allowPatientNotes: true, overbookReasonCodes: [] }
  })))).toString()));

  // Availability today
  const now = new Date();
  const dow = now.getUTCDay();
  assertSuccess(JSON.parse((await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "SetDoctorAvailability",
    data: { doctorId, availabilityRules: [{ dayOfWeek: dow, startTime: "00:00", endTime: "23:55" }], exceptionDays: [], blackoutRanges: [] }
  })))).toString()));

  // Patients register
  assertSuccess(JSON.parse((await patient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "RegisterPatient", data: { displayName: "P", timeZone: "UTC", contactHash: "hashP" }
  })))).toString()));
  assertSuccess(JSON.parse((await otherPatient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "RegisterPatient", data: { displayName: "OP", timeZone: "UTC", contactHash: "hashOP" }
  })))).toString()));

  const startIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
  const endIso = new Date(Date.parse(startIso) + 86400000).toISOString();

  const av = JSON.parse((await patient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "GetAvailability", data: { doctorId, startDateUtc: startIso, endDateUtc: endIso }
  })))).toString());
  assertSuccess(av);
  assertTrue(av.success.slots.length > 0);
  const slot = av.success.slots[0];

  const book = JSON.parse((await patient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "BookAppointment", data: { doctorId, slotStartUtc: slot.slotStartUtc, durationMinutes: slot.durationMinutes, reasonCode: "VISIT" }
  })))).toString());
  assertSuccess(book);
  const apptId = book.success.appointment.id;

  // Other patient cannot cancel
  const cancelOther = JSON.parse((await otherPatient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "CancelAppointment", data: { appointmentId: apptId, reasonCode: "BAD" }
  })))).toString());
  assertError(cancelOther, "ACCESS_DENIED");

  // Doctor views schedule
  const sched = JSON.parse((await doctor.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "ViewSchedule", data: { doctorId, startDateUtc: startIso, endDateUtc: endIso }
  })))).toString());
  assertSuccess(sched);

  // Doctor cancels appointment
  const cancelDoc = JSON.parse((await doctor.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare", Action: "CancelAppointmentByDoctor", data: { doctorId, appointmentId: apptId, reasonCode: "CLINIC_CANCEL" }
  })))).toString());
  assertSuccess(cancelDoc);

  await admin.close();
  await doctor.close();
  await patient.close();
  await otherPatient.close();
}

module.exports = { runDoctorActionsAndAccessControlTests };
