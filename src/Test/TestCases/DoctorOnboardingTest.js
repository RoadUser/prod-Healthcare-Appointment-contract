const HotPocket = require("hotpocket-js-client");
const { connectClient, assertSuccess, assertTrue, assertEqual } = require("../test-utils");

const URL = "wss://localhost:8081";

async function send(client, payload, readOnly) {
  const buf = Buffer.from(JSON.stringify(payload));
  if (readOnly) {
    const out = await client.submitContractReadRequest(buf);
    return JSON.parse(out.toString());
  }
  await client.submitContractInput(buf);
  // small delay then read using read request to verify state
  await new Promise(r => setTimeout(r, 200));
  return { success: true };
}

async function runDoctorOnboardingAndAvailabilityTests() {
  const adminKeys = await HotPocket.generateKeys();
  const patientKeys = await HotPocket.generateKeys();

  // admin key must match MAINTAINER_PUBKEY in contract .env for admin actions in a real run.
  // For local tests, set MAINTAINER_PUBKEY to adminKeys.publicKey hex.
  console.log("Admin pubkey hex:", Buffer.from(adminKeys.publicKey).toString("hex"));

  const admin = await connectClient(URL, adminKeys);
  const patient = await connectClient(URL, patientKeys);

  // Create clinic
  const createClinic = await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "CreateClinic",
    data: { name: "Test Clinic" }
  })));
  const cc = JSON.parse(createClinic.toString());
  assertSuccess(cc);
  const clinicId = cc.success.clinic.id;
  assertTrue(!!clinicId);

  // Add doctor
  const addDoctorOut = await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "AddDoctor",
    data: {
      clinicId,
      displayName: "Dr. Ada",
      specialty: "Cardiology",
      timeZone: "UTC",
      appointmentDurationsMinutes: [30],
      bufferMinutes: 10,
      maxDailyAppointments: 3,
      overbookingAllowed: false
    }
  })));
  const ad = JSON.parse(addDoctorOut.toString());
  assertSuccess(ad);
  const doctorId = ad.success.doctor.id;

  // Set doctor availability (Mon-Fri 09:00-10:00)
  const setAvailOut = await admin.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "SetDoctorAvailability",
    data: {
      doctorId,
      availabilityRules: [
        { dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "10:00" },
        { dayOfWeek: 3, startTime: "09:00", endTime: "10:00" },
        { dayOfWeek: 4, startTime: "09:00", endTime: "10:00" },
        { dayOfWeek: 5, startTime: "09:00", endTime: "10:00" }
      ],
      exceptionDays: [],
      blackoutRanges: []
    }
  })));
  const sa = JSON.parse(setAvailOut.toString());
  assertSuccess(sa);

  // Patient register
  const regOut = await patient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "RegisterPatient",
    data: {
      displayName: "Patient One",
      timeZone: "UTC",
      contactHash: "hash://example",
      preferences: { reminder: true }
    }
  })));
  const reg = JSON.parse(regOut.toString());
  assertSuccess(reg);
  assertEqual(reg.success.patient.id, Buffer.from(patientKeys.publicKey).toString("hex"));

  // Availability generation window for next 7 days
  const start = new Date();
  const startIso = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0)).toISOString();
  const endIso = new Date(Date.parse(startIso) + 7 * 86400000).toISOString();

  const availOut = await patient.submitContractReadRequest(Buffer.from(JSON.stringify({
    Service: "Healthcare",
    Action: "GetAvailability",
    data: { doctorId, startDateUtc: startIso, endDateUtc: endIso }
  })));
  const av = JSON.parse(availOut.toString());
  assertSuccess(av);
  assertTrue(Array.isArray(av.success.slots));

  await admin.close();
  await patient.close();
}

module.exports = { runDoctorOnboardingAndAvailabilityTests };
