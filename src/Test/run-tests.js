const { runDoctorOnboardingAndAvailabilityTests } = require("./TestCases/DoctorOnboardingTest");
const { runBookingConflictAndPolicyTests } = require("./TestCases/BookingAndPolicyTest");
const { runDoctorActionsAndAccessControlTests } = require("./TestCases/DoctorActionsAccessTest");

async function run() {
  const results = [];

  const suites = [
    { name: "Doctor onboarding & availability", fn: runDoctorOnboardingAndAvailabilityTests },
    { name: "Booking, conflicts & policies", fn: runBookingConflictAndPolicyTests },
    { name: "Doctor actions & access control", fn: runDoctorActionsAndAccessControlTests }
  ];

  for (const s of suites) {
    try {
      await s.fn();
      results.push({ suite: s.name, ok: true });
      console.log(`[PASS] ${s.name}`);
    } catch (e) {
      results.push({ suite: s.name, ok: false, error: e.message });
      console.error(`[FAIL] ${s.name}:`, e);
      process.exitCode = 1;
    }
  }

  console.log("\
Test summary:");
  for (const r of results) console.log(r);

  if (process.exitCode) process.exit(process.exitCode);
}

run();
