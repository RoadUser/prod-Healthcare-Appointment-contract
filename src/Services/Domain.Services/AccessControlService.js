const Env = require("../../Utils/Env");
const ErrorCodes = require("../../Constants/ErrorCodes");
const Tables = require("../../Constants/Tables");

function normalizeHex(h) {
  return (h || "").toString("hex") ? h : h;
}

class AccessControlService {
  constructor(db) {
    this.db = db;
  }

  getUserPubKeyHex(user) {
    const hex = (user && user.pubKey) ? Buffer.from(user.pubKey).toString("hex") : "";
    return hex.toLowerCase();
  }

  isMaintainer(userPubKeyHex) {
    const expected = (Env.MAINTAINER_PUBKEY || "").toLowerCase();
    if (!expected) return false;
    return (userPubKeyHex || "").toLowerCase() === expected;
  }

  async requireAdmin(user) {
    const pk = this.getUserPubKeyHex(user);
    if (this.isMaintainer(pk)) return { role: "admin", actorId: pk };

    // Also allow admins table
    const row = await this.db.getOne(`SELECT Id FROM ${Tables.ADMIN} WHERE Id = ?`, [pk]);
    if (row) return { role: "admin", actorId: pk };

    throw { code: ErrorCodes.ACCESS_DENIED, message: "Admin access required" };
  }

  async requirePatient(user) {
    const pk = this.getUserPubKeyHex(user);
    const row = await this.db.getOne(`SELECT Id FROM ${Tables.PATIENT} WHERE Id = ?`, [pk]);
    if (!row) throw { code: ErrorCodes.ACCESS_DENIED, message: "Patient registration required" };
    return { role: "patient", actorId: pk, patientId: pk };
  }

  async requireDoctor(user, doctorId) {
    const pk = this.getUserPubKeyHex(user);
    const row = await this.db.getOne(
      `SELECT DoctorId FROM ${Tables.DOCTOR_ROLE} WHERE DoctorId = ? AND OwnerPubKeyHex = ?`,
      [doctorId, pk]
    );
    if (!row) throw { code: ErrorCodes.ACCESS_DENIED, message: "Doctor access required" };
    return { role: "doctor", actorId: pk, doctorId };
  }
}

module.exports = { AccessControlService };
