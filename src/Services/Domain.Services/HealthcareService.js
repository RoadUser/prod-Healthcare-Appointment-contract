const Tables = require("../../Constants/Tables");
const ErrorCodes = require("../../Constants/ErrorCodes");
const AppointmentStatus = require("../../Constants/AppointmentStatus");
const Events = require("../../Constants/Events");
const Policies = require("../../Constants/Policies");
const { SharedService } = require("../Common.Services/SharedService");
const { AuditLogService } = require("../Common.Services/AuditLogService");
const { requireString, requireBoolean, requireInt, requireUtcIso, requireDateIso, requireTimeHHMM, sanitizeReasonCode, optionalString } = require("../../Utils/Validators");//

//fdfdsfd
function addMinutes(isoUtc, mins) {
  const t = Date.parse(isoUtc);
  return new Date(t + mins * 60000).toISOString();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  return as < be && bs < ae;
}

function dayOfWeekUtc(isoUtcDate) {
  // isoUtcDate should be midnight-ish or any time; used only for date range enumeration
  const d = new Date(isoUtcDate);
  return d.getUTCDay();
}

function dateOnlyUtc(isoUtc) {
  return isoUtc.slice(0, 10);
}

function combineDateAndTimeToUtcIso(dateIso, timeHHMM) {
  // Interpret as UTC at given date/time.
  return `${dateIso}T${timeHHMM}:00.000Z`;
}

class HealthcareService {
  constructor(db) {
    this.db = db;
    this.audit = new AuditLogService(db);
  }

  async getPolicy() {
    const row = await this.db.getOne(`SELECT * FROM ${Tables.POLICY} ORDER BY Id DESC LIMIT 1`);
    if (!row) {
      return {
        cancellationWindowMinutes: Policies.DEFAULT.cancellationWindowMinutes,
        rescheduleWindowMinutes: Policies.DEFAULT.rescheduleWindowMinutes,
        allowPatientNotes: Policies.DEFAULT.allowPatientNotes,
        overbookReasonCodes: []
      };
    }

    return {
      cancellationWindowMinutes: row.CancellationWindowMinutes,
      rescheduleWindowMinutes: row.RescheduleWindowMinutes,
      allowPatientNotes: !!row.AllowPatientNotes,
      overbookReasonCodes: row.OverbookReasonCodesJson ? JSON.parse(row.OverbookReasonCodesJson) : []
    };
  }

  // ---------------- Admin functions ----------------

  async createClinic(actor, data) {
    const name = requireString(data.name, "name", 100);
    const id = SharedService.generateUUID();
    await this.db.runQuery(`INSERT INTO ${Tables.CLINIC} (Id, Name, Active) VALUES (?, ?, 1)`, [id, name]);
    await this.audit.write(actor.role, actor.actorId, "createClinic", id, { name });
    return { clinic: { id, name, active: true } };
  }

  async setClinicActive(actor, data) {
    const clinicId = requireString(data.clinicId, "clinicId", 80);
    const active = requireBoolean(data.active, "active") ? 1 : 0;
    const rc = await this.db.runQuery(`UPDATE ${Tables.CLINIC} SET Active = ? WHERE Id = ?`, [active, clinicId]);
    if (!rc.changes) throw { code: ErrorCodes.NOT_FOUND, message: "Clinic not found" };
    await this.audit.write(actor.role, actor.actorId, "setClinicActive", clinicId, { active: !!active });
    return { clinicId, active: !!active };
  }

  async addDoctor(actor, data) {
    const clinicId = requireString(data.clinicId, "clinicId", 80);
    const displayName = requireString(data.displayName, "displayName", 80);
    const specialty = requireString(data.specialty, "specialty", 60);
    const timeZone = requireString(data.timeZone, "timeZone", 60);

    if (!Array.isArray(data.appointmentDurationsMinutes) || !data.appointmentDurationsMinutes.length) {
      throw { code: ErrorCodes.VALIDATION_FAILED, message: "appointmentDurationsMinutes required" };
    }
    const durations = data.appointmentDurationsMinutes.map(x => requireInt(x, "appointmentDurationsMinutes[]", 5, 480));
    const bufferMinutes = requireInt(data.bufferMinutes, "bufferMinutes", 0, 240);
    const maxDailyAppointments = requireInt(data.maxDailyAppointments, "maxDailyAppointments", 1, 200);
    const overbookingAllowed = requireBoolean(data.overbookingAllowed, "overbookingAllowed") ? 1 : 0;

    const clinic = await this.db.getOne(`SELECT Id FROM ${Tables.CLINIC} WHERE Id = ?`, [clinicId]);
    if (!clinic) throw { code: ErrorCodes.NOT_FOUND, message: "Clinic not found" };

    const id = SharedService.generateUUID();
    await this.db.runQuery(
      `INSERT INTO ${Tables.DOCTOR} (Id, ClinicId, DisplayName, Specialty, TimeZone, Active, AppointmentDurationsMinutesJson, BufferMinutes, MaxDailyAppointments, OverbookingAllowed)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)` ,
      [id, clinicId, displayName, specialty, timeZone, JSON.stringify(durations), bufferMinutes, maxDailyAppointments, overbookingAllowed]
    );

    // NOTE: Doctor ownership binding is set via updateDoctor(fields...) with ownerPubKeyHex, or separate administrative step.
    await this.audit.write(actor.role, actor.actorId, "addDoctor", id, { clinicId, displayName, specialty });

    return {
      doctor: {
        id,
        clinicId,
        displayName,
        specialty,
        timeZone,
        active: true,
        appointmentDurationsMinutes: durations,
        bufferMinutes,
        maxDailyAppointments,
        overbookingAllowed: !!overbookingAllowed
      }
    };
  }

  async updateDoctor(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const fields = data.fields || {};

    const row = await this.db.getOne(`SELECT * FROM ${Tables.DOCTOR} WHERE Id = ?`, [doctorId]);
    if (!row) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };

    const updates = [];
    const params = [];

    if (fields.displayName !== undefined) {
      updates.push("DisplayName = ?");
      params.push(requireString(fields.displayName, "displayName", 80));
    }
    if (fields.specialty !== undefined) {
      updates.push("Specialty = ?");
      params.push(requireString(fields.specialty, "specialty", 60));
    }
    if (fields.timeZone !== undefined) {
      updates.push("TimeZone = ?");
      params.push(requireString(fields.timeZone, "timeZone", 60));
    }
    if (fields.appointmentDurationsMinutes !== undefined) {
      if (!Array.isArray(fields.appointmentDurationsMinutes) || !fields.appointmentDurationsMinutes.length) {
        throw { code: ErrorCodes.VALIDATION_FAILED, message: "appointmentDurationsMinutes must be non-empty array" };
      }
      const durations = fields.appointmentDurationsMinutes.map(x => requireInt(x, "appointmentDurationsMinutes[]", 5, 480));
      updates.push("AppointmentDurationsMinutesJson = ?");
      params.push(JSON.stringify(durations));
    }
    if (fields.bufferMinutes !== undefined) {
      updates.push("BufferMinutes = ?");
      params.push(requireInt(fields.bufferMinutes, "bufferMinutes", 0, 240));
    }
    if (fields.maxDailyAppointments !== undefined) {
      updates.push("MaxDailyAppointments = ?");
      params.push(requireInt(fields.maxDailyAppointments, "maxDailyAppointments", 1, 200));
    }
    if (fields.overbookingAllowed !== undefined) {
      updates.push("OverbookingAllowed = ?");
      params.push(requireBoolean(fields.overbookingAllowed, "overbookingAllowed") ? 1 : 0);
    }

    if (updates.length) {
      params.push(doctorId);
      await this.db.runQuery(`UPDATE ${Tables.DOCTOR} SET ${updates.join(", ")} WHERE Id = ?`, params);
    }

    // Optional: bind doctor ownership to a pubkey.
    if (fields.ownerPubKeyHex !== undefined) {
      const ownerPubKeyHex = requireString(fields.ownerPubKeyHex, "ownerPubKeyHex", 200).toLowerCase();
      if (!/^[0-9a-f]+$/.test(ownerPubKeyHex)) throw { code: ErrorCodes.VALIDATION_FAILED, message: "ownerPubKeyHex must be hex" };

      await this.db.runQuery(
        `INSERT INTO ${Tables.DOCTOR_ROLE} (DoctorId, OwnerPubKeyHex, CreatedAtUtc) VALUES (?, ?, ?)
         ON CONFLICT(DoctorId) DO UPDATE SET OwnerPubKeyHex=excluded.OwnerPubKeyHex`,
        [doctorId, ownerPubKeyHex, SharedService.getCurrentTimestamp()]
      );
    }

    await this.audit.write(actor.role, actor.actorId, "updateDoctor", doctorId, { fields: Object.keys(fields) });
    return { doctorId, updated: true };
  }

  async setDoctorActive(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const active = requireBoolean(data.active, "active") ? 1 : 0;
    const rc = await this.db.runQuery(`UPDATE ${Tables.DOCTOR} SET Active = ? WHERE Id = ?`, [active, doctorId]);
    if (!rc.changes) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };
    await this.audit.write(actor.role, actor.actorId, "setDoctorActive", doctorId, { active: !!active });
    return { doctorId, active: !!active };
  }

  async setDoctorAvailability(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const rules = Array.isArray(data.availabilityRules) ? data.availabilityRules : [];
    const exceptionDays = Array.isArray(data.exceptionDays) ? data.exceptionDays : [];
    const blackoutRanges = Array.isArray(data.blackoutRanges) ? data.blackoutRanges : [];

    const doctor = await this.db.getOne(`SELECT Id FROM ${Tables.DOCTOR} WHERE Id = ?`, [doctorId]);
    if (!doctor) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };

    await this.db.runQuery(`DELETE FROM ${Tables.DOCTOR_AVAILABILITY_RULE} WHERE DoctorId = ?`, [doctorId]);
    await this.db.runQuery(`DELETE FROM ${Tables.DOCTOR_EXCEPTION_DAY} WHERE DoctorId = ?`, [doctorId]);
    await this.db.runQuery(`DELETE FROM ${Tables.DOCTOR_BLACKOUT_RANGE} WHERE DoctorId = ?`, [doctorId]);

    for (const r of rules) {
      const dayOfWeek = requireInt(r.dayOfWeek, "dayOfWeek", 0, 6);
      const startTime = requireTimeHHMM(r.startTime, "startTime");
      const endTime = requireTimeHHMM(r.endTime, "endTime");
      if (startTime >= endTime) throw { code: ErrorCodes.VALIDATION_FAILED, message: "availability startTime must be < endTime" };
      await this.db.runQuery(
        `INSERT INTO ${Tables.DOCTOR_AVAILABILITY_RULE} (DoctorId, DayOfWeek, StartTime, EndTime) VALUES (?, ?, ?, ?)` ,
        [doctorId, dayOfWeek, startTime, endTime]
      );
    }

    for (const ex of exceptionDays) {
      const date = requireDateIso(ex.date, "date");
      const available = requireBoolean(ex.available, "available") ? 1 : 0;
      await this.db.runQuery(
        `INSERT INTO ${Tables.DOCTOR_EXCEPTION_DAY} (DoctorId, Date, Available) VALUES (?, ?, ?)` ,
        [doctorId, date, available]
      );
    }

    for (const b of blackoutRanges) {
      const startUtc = requireUtcIso(b.startUtc, "startUtc");
      const endUtc = requireUtcIso(b.endUtc, "endUtc");
      if (Date.parse(startUtc) >= Date.parse(endUtc)) throw { code: ErrorCodes.VALIDATION_FAILED, message: "blackout startUtc must be < endUtc" };
      await this.db.runQuery(
        `INSERT INTO ${Tables.DOCTOR_BLACKOUT_RANGE} (DoctorId, StartUtc, EndUtc) VALUES (?, ?, ?)` ,
        [doctorId, startUtc, endUtc]
      );
    }

    await this.audit.write(actor.role, actor.actorId, "setDoctorAvailability", doctorId, { rules: rules.length, exceptionDays: exceptionDays.length, blackoutRanges: blackoutRanges.length });

    return {
      doctorId,
      events: [{ type: Events.DoctorAvailabilityUpdated, data: { doctorId } }]
    };
  }

  async setPolicy(actor, data) {
    const cancellationWindowMinutes = requireInt(data.cancellationWindowMinutes, "cancellationWindowMinutes", 0, 10080);
    const rescheduleWindowMinutes = requireInt(data.rescheduleWindowMinutes, "rescheduleWindowMinutes", 0, 10080);
    const allowPatientNotes = requireBoolean(data.allowPatientNotes, "allowPatientNotes") ? 1 : 0;

    const overbookReasonCodes = Array.isArray(data.overbookReasonCodes) ? data.overbookReasonCodes : [];
    const sanitized = overbookReasonCodes.map(rc => {
      const s = requireString(rc, "overbookReasonCodes[]", 32);
      if (!/^[A-Za-z0-9_\-\.]{1,32}$/.test(s)) throw { code: ErrorCodes.VALIDATION_FAILED, message: "Invalid overbook reason code" };
      return s;
    });

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(
      `INSERT INTO ${Tables.POLICY} (CancellationWindowMinutes, RescheduleWindowMinutes, AllowPatientNotes, OverbookReasonCodesJson, CreatedAtUtc, UpdatedAtUtc)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [cancellationWindowMinutes, rescheduleWindowMinutes, allowPatientNotes, JSON.stringify(sanitized), ts, ts]
    );

    await this.audit.write(actor.role, actor.actorId, "setPolicy", null, { cancellationWindowMinutes, rescheduleWindowMinutes, allowPatientNotes: !!allowPatientNotes, overbookReasonCodes: sanitized });

    return {
      policy: { cancellationWindowMinutes, rescheduleWindowMinutes, allowPatientNotes: !!allowPatientNotes, overbookReasonCodes: sanitized },
      events: [{ type: Events.PolicyUpdated, data: {} }]
    };
  }

  // ---------------- Patient functions ----------------

  async registerPatient(actor, data) {
    const displayName = requireString(data.displayName, "displayName", 80);
    const timeZone = requireString(data.timeZone, "timeZone", 60);
    const contactHash = requireString(data.contactHash, "contactHash", 200);
    const preferences = data.preferences !== undefined ? JSON.stringify(data.preferences) : null;

    const patientId = actor.actorId;
    const exists = await this.db.getOne(`SELECT Id FROM ${Tables.PATIENT} WHERE Id = ?`, [patientId]);
    if (exists) {
      await this.db.runQuery(
        `UPDATE ${Tables.PATIENT} SET DisplayName=?, TimeZone=?, ContactHash=?, PreferencesJson=? WHERE Id=?`,
        [displayName, timeZone, contactHash, preferences, patientId]
      );
      await this.audit.write(actor.role, actor.actorId, "updatePatient", patientId, {});
      return { patient: { id: patientId, displayName, timeZone, contactHash } };
    }

    await this.db.runQuery(
      `INSERT INTO ${Tables.PATIENT} (Id, DisplayName, TimeZone, ContactHash, PreferencesJson, CreatedAtUtc) VALUES (?, ?, ?, ?, ?, ?)` ,
      [patientId, displayName, timeZone, contactHash, preferences, SharedService.getCurrentTimestamp()]
    );

    await this.audit.write(actor.role, actor.actorId, "registerPatient", patientId, {});

    return { patient: { id: patientId, displayName, timeZone, contactHash } };
  }

  async listClinics(actor, data) {
    const active = data && data.active !== undefined ? (requireBoolean(data.active, "active") ? 1 : 0) : null;
    const rows = active === null
      ? await this.db.getAll(`SELECT * FROM ${Tables.CLINIC} ORDER BY Name ASC`)
      : await this.db.getAll(`SELECT * FROM ${Tables.CLINIC} WHERE Active = ? ORDER BY Name ASC`, [active]);

    return {
      clinics: rows.map(r => ({ id: r.Id, name: r.Name, active: !!r.Active }))
    };
  }

  async listDoctors(actor, data) {
    const filter = data || {};
    const where = [];
    const params = [];

    if (filter.clinicId !== undefined) {
      where.push("ClinicId = ?");
      params.push(requireString(filter.clinicId, "clinicId", 80));
    }
    if (filter.specialty !== undefined) {
      where.push("Specialty = ?");
      params.push(requireString(filter.specialty, "specialty", 60));
    }
    if (filter.active !== undefined) {
      where.push("Active = ?");
      params.push(requireBoolean(filter.active, "active") ? 1 : 0);
    }

    const sql = `SELECT * FROM ${Tables.DOCTOR}` + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + " ORDER BY DisplayName ASC";
    const rows = await this.db.getAll(sql, params);

    return {
      doctors: rows.map(d => ({
        id: d.Id,
        clinicId: d.ClinicId,
        displayName: d.DisplayName,
        specialty: d.Specialty,
        timeZone: d.TimeZone,
        active: !!d.Active,
        appointmentDurationsMinutes: JSON.parse(d.AppointmentDurationsMinutesJson),
        bufferMinutes: d.BufferMinutes,
        maxDailyAppointments: d.MaxDailyAppointments,
        overbookingAllowed: !!d.OverbookingAllowed
      }))
    };
  }

  async getDoctor(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const d = await this.db.getOne(`SELECT * FROM ${Tables.DOCTOR} WHERE Id = ?`, [doctorId]);
    if (!d) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };

    const rules = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_AVAILABILITY_RULE} WHERE DoctorId = ?`, [doctorId]);
    const ex = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_EXCEPTION_DAY} WHERE DoctorId = ?`, [doctorId]);
    const bo = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_BLACKOUT_RANGE} WHERE DoctorId = ?`, [doctorId]);

    return {
      doctor: {
        id: d.Id,
        clinicId: d.ClinicId,
        displayName: d.DisplayName,
        specialty: d.Specialty,
        timeZone: d.TimeZone,
        active: !!d.Active,
        appointmentDurationsMinutes: JSON.parse(d.AppointmentDurationsMinutesJson),
        bufferMinutes: d.BufferMinutes,
        maxDailyAppointments: d.MaxDailyAppointments,
        availabilityRules: rules.map(r => ({ dayOfWeek: r.DayOfWeek, startTime: r.StartTime, endTime: r.EndTime })),
        exceptionDays: ex.map(r => ({ date: r.Date, available: !!r.Available })),
        blackoutRanges: bo.map(r => ({ startUtc: r.StartUtc, endUtc: r.EndUtc })),
        overbookingAllowed: !!d.OverbookingAllowed
      }
    };
  }

  async getAvailability(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const startDateUtc = requireUtcIso(data.startDateUtc, "startDateUtc");
    const endDateUtc = requireUtcIso(data.endDateUtc, "endDateUtc");
    if (Date.parse(startDateUtc) >= Date.parse(endDateUtc)) throw { code: ErrorCodes.VALIDATION_FAILED, message: "startDateUtc must be < endDateUtc" };

    const d = await this.db.getOne(`SELECT * FROM ${Tables.DOCTOR} WHERE Id = ?`, [doctorId]);
    if (!d) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };
    if (!d.Active) return { slots: [] };

    const durations = JSON.parse(d.AppointmentDurationsMinutesJson);
    const buffer = d.BufferMinutes;

    const rules = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_AVAILABILITY_RULE} WHERE DoctorId = ?`, [doctorId]);
    const ex = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_EXCEPTION_DAY} WHERE DoctorId = ?`, [doctorId]);
    const bo = await this.db.getAll(`SELECT * FROM ${Tables.DOCTOR_BLACKOUT_RANGE} WHERE DoctorId = ?`, [doctorId]);

    const exMap = new Map(ex.map(x => [x.Date, !!x.Available]));

    const appts = await this.db.getAll(
      `SELECT * FROM ${Tables.APPOINTMENT} WHERE DoctorId = ? AND StartTimeUtc < ? AND EndTimeUtc > ? AND Status IN (?, ?, ?)`,
      [doctorId, endDateUtc, startDateUtc, AppointmentStatus.BOOKED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW]
    );

    const blocks = await this.db.getAll(
      `SELECT * FROM ${Tables.APPOINTMENT_BLOCK} WHERE DoctorId = ? AND StartUtc < ? AND EndUtc > ?`,
      [doctorId, endDateUtc, startDateUtc]
    );

    const busy = [];
    for (const a of appts) {
      busy.push({ start: addMinutes(a.StartTimeUtc, -buffer), end: addMinutes(a.EndTimeUtc, buffer) });
    }
    for (const b of blocks) {
      busy.push({ start: b.StartUtc, end: b.EndUtc });
    }
    for (const b of bo) {
      busy.push({ start: b.StartUtc, end: b.EndUtc });
    }

    // enumerate days
    const slots = [];
    let cursor = new Date(Date.parse(startDateUtc));
    const end = Date.parse(endDateUtc);

    // normalize cursor to start date at 00:00 UTC
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), 0, 0, 0));

    while (cursor.getTime() < end) {
      const dateIso = cursor.toISOString().slice(0, 10);

      // exception day override
      if (exMap.has(dateIso) && exMap.get(dateIso) === false) {
        cursor = new Date(cursor.getTime() + 86400000);
        continue;
      }

      const dow = cursor.getUTCDay();
      const dayRules = rules.filter(r => r.DayOfWeek === dow);
      if (!dayRules.length) {
        cursor = new Date(cursor.getTime() + 86400000);
        continue;
      }

      for (const r of dayRules) {
        const windowStart = combineDateAndTimeToUtcIso(dateIso, r.StartTime);
        const windowEnd = combineDateAndTimeToUtcIso(dateIso, r.EndTime);

        for (const dur of durations) {
          let t = Date.parse(windowStart);
          const wEnd = Date.parse(windowEnd);
          while (t + dur * 60000 <= wEnd) {
            const s = new Date(t).toISOString();
            const e = new Date(t + dur * 60000).toISOString();

            // only include slots inside requested range
            if (Date.parse(s) >= Date.parse(startDateUtc) && Date.parse(e) <= Date.parse(endDateUtc)) {
              const sWithBuf = addMinutes(s, -buffer);
              const eWithBuf = addMinutes(e, buffer);
              const conflict = busy.some(x => overlaps(sWithBuf, eWithBuf, x.start, x.end));
              if (!conflict) {
                slots.push({ doctorId, slotStartUtc: s, durationMinutes: dur, slotEndUtc: e });
              }
            }

            // step 5 minutes granularity
            t += 5 * 60000;
          }
        }
      }

      cursor = new Date(cursor.getTime() + 86400000);
    }

    return { slots };
  }

  async bookAppointment(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const slotStartUtc = requireUtcIso(data.slotStartUtc, "slotStartUtc");
    const durationMinutes = requireInt(data.durationMinutes, "durationMinutes", 5, 480);
    const reasonCode = sanitizeReasonCode(data.reasonCode);
    const notesBlobRef = optionalString(data.notesBlobRef, "notesBlobRef", 200);

    const policy = await this.getPolicy();
    if (!policy.allowPatientNotes && notesBlobRef) {
      throw { code: ErrorCodes.POLICY_VIOLATION, message: "Patient notes not allowed by policy" };
    }

    const d = await this.db.getOne(`SELECT * FROM ${Tables.DOCTOR} WHERE Id = ?`, [doctorId]);
    if (!d) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };
    if (!d.Active) throw { code: ErrorCodes.CONFLICT, message: "Doctor inactive" };

    const allowedDurations = JSON.parse(d.AppointmentDurationsMinutesJson);
    if (!allowedDurations.includes(durationMinutes)) {
      throw { code: ErrorCodes.VALIDATION_FAILED, message: "Duration not allowed" };
    }

    const start = slotStartUtc;
    const end = addMinutes(slotStartUtc, durationMinutes);
    const buffer = d.BufferMinutes;

    const patientId = actor.patientId;

    // atomic booking
    await this.db.beginImmediate();
    try {
      const day = dateOnlyUtc(start);
      const dayStart = `${day}T00:00:00.000Z`;
      const dayEnd = `${day}T23:59:59.999Z`;

      const countRow = await this.db.getOne(
        `SELECT COUNT(1) AS Cnt FROM ${Tables.APPOINTMENT} WHERE DoctorId = ? AND StartTimeUtc >= ? AND StartTimeUtc <= ? AND Status = ?`,
        [doctorId, dayStart, dayEnd, AppointmentStatus.BOOKED]
      );
      const dailyCount = countRow ? countRow.Cnt : 0;
      if (dailyCount >= d.MaxDailyAppointments) {
        throw { code: ErrorCodes.POLICY_VIOLATION, message: "Max daily appointments exceeded" };
      }

      // blackout + blocks
      const blackout = await this.db.getAll(
        `SELECT * FROM ${Tables.DOCTOR_BLACKOUT_RANGE} WHERE DoctorId = ? AND StartUtc < ? AND EndUtc > ?`,
        [doctorId, end, start]
      );
      if (blackout.length) throw { code: ErrorCodes.CONFLICT, message: "Slot overlaps blackout" };

      const blocks = await this.db.getAll(
        `SELECT * FROM ${Tables.APPOINTMENT_BLOCK} WHERE DoctorId = ? AND StartUtc < ? AND EndUtc > ?`,
        [doctorId, end, start]
      );
      if (blocks.length) throw { code: ErrorCodes.CONFLICT, message: "Slot overlaps blocked time" };

      // existing appointments with buffer constraints
      const startWithBuf = addMinutes(start, -buffer);
      const endWithBuf = addMinutes(end, buffer);

      const appts = await this.db.getAll(
        `SELECT * FROM ${Tables.APPOINTMENT} WHERE DoctorId = ? AND Status = ? AND StartTimeUtc < ? AND EndTimeUtc > ?`,
        [doctorId, AppointmentStatus.BOOKED, endWithBuf, startWithBuf]
      );

      const overbookingAllowed = !!d.OverbookingAllowed;
      const canOverbook = overbookingAllowed && policy.overbookReasonCodes.includes(reasonCode);

      if (appts.length && !canOverbook) {
        throw { code: ErrorCodes.CONFLICT, message: "Slot already booked" };
      }

      // (Optional) verify slot fits within availability windows
      const avail = await this.getAvailability(actor, { doctorId, startDateUtc: start, endDateUtc: end });
      const match = (avail.slots || []).some(s => s.slotStartUtc === start && s.durationMinutes === durationMinutes);
      if (!match && !canOverbook) {
        throw { code: ErrorCodes.CONFLICT, message: "Slot not available" };
      }

      const id = SharedService.generateUUID();
      const ts = SharedService.getCurrentTimestamp();
      await this.db.runQuery(
        `INSERT INTO ${Tables.APPOINTMENT} (Id, ClinicId, DoctorId, PatientId, StartTimeUtc, EndTimeUtc, Status, ReasonCode, NotesBlobRef, CreatedAtUtc, UpdatedAtUtc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [id, d.ClinicId, doctorId, patientId, start, end, AppointmentStatus.BOOKED, reasonCode, notesBlobRef || null, ts, ts]
      );

      await this.audit.write(actor.role, actor.actorId, "bookAppointment", id, { doctorId, startTimeUtc: start, durationMinutes, reasonCode });

      await this.db.commit();

      return {
        appointment: { id, clinicId: d.ClinicId, doctorId, patientId, startTimeUtc: start, endTimeUtc: end, status: AppointmentStatus.BOOKED, reasonCode, notesBlobRef: notesBlobRef || null, createdAtUtc: ts, updatedAtUtc: ts },
        events: [{ type: Events.AppointmentBooked, data: { appointmentId: id, doctorId, patientId } }]
      };
    } catch (e) {
      await this.db.rollback();
      throw e;
    }
  }

  async cancelAppointment(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const reasonCode = sanitizeReasonCode(data.reasonCode);

    const policy = await this.getPolicy();

    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id = ?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };
    if (a.PatientId !== actor.patientId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Cannot cancel others' appointments" };
    if (a.Status !== AppointmentStatus.BOOKED) throw { code: ErrorCodes.CONFLICT, message: "Only BOOKED appointments can be cancelled" };

    const now = Date.parse(SharedService.getCurrentTimestamp());
    const start = Date.parse(a.StartTimeUtc);
    const minsToStart = Math.floor((start - now) / 60000);
    if (minsToStart < policy.cancellationWindowMinutes) {
      throw { code: ErrorCodes.POLICY_VIOLATION, message: "Cancellation window exceeded" };
    }

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(
      `UPDATE ${Tables.APPOINTMENT} SET Status=?, ReasonCode=?, UpdatedAtUtc=? WHERE Id=?`,
      [AppointmentStatus.CANCELLED_PATIENT, reasonCode, ts, appointmentId]
    );

    await this.audit.write(actor.role, actor.actorId, "cancelAppointment", appointmentId, { reasonCode });

    return {
      appointmentId,
      status: AppointmentStatus.CANCELLED_PATIENT,
      events: [{ type: Events.AppointmentCancelled, data: { appointmentId, byRole: "patient" } }]
    };
  }

  async rescheduleAppointment(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const newSlotStartUtc = requireUtcIso(data.newSlotStartUtc, "newSlotStartUtc");

    const policy = await this.getPolicy();

    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id = ?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };
    if (a.PatientId !== actor.patientId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Cannot reschedule others' appointments" };
    if (a.Status !== AppointmentStatus.BOOKED) throw { code: ErrorCodes.CONFLICT, message: "Only BOOKED appointments can be rescheduled" };

    const now = Date.parse(SharedService.getCurrentTimestamp());
    const start = Date.parse(a.StartTimeUtc);
    const minsToStart = Math.floor((start - now) / 60000);
    if (minsToStart < policy.rescheduleWindowMinutes) {
      throw { code: ErrorCodes.POLICY_VIOLATION, message: "Reschedule window exceeded" };
    }

    const duration = Math.floor((Date.parse(a.EndTimeUtc) - Date.parse(a.StartTimeUtc)) / 60000);

    // Do a booking-like overlap check atomically by temporarily excluding this appointment
    await this.db.beginImmediate();
    try {
      const d = await this.db.getOne(`SELECT * FROM ${Tables.DOCTOR} WHERE Id = ?`, [a.DoctorId]);
      if (!d) throw { code: ErrorCodes.NOT_FOUND, message: "Doctor not found" };
      const buffer = d.BufferMinutes;

      const newEnd = addMinutes(newSlotStartUtc, duration);

      // check conflicts excluding current appointment
      const startWithBuf = addMinutes(newSlotStartUtc, -buffer);
      const endWithBuf = addMinutes(newEnd, buffer);

      const conflicts = await this.db.getAll(
        `SELECT * FROM ${Tables.APPOINTMENT} WHERE DoctorId=? AND Status=? AND Id<>? AND StartTimeUtc < ? AND EndTimeUtc > ?`,
        [a.DoctorId, AppointmentStatus.BOOKED, appointmentId, endWithBuf, startWithBuf]
      );

      const policyNow = await this.getPolicy();
      const canOverbook = !!d.OverbookingAllowed && policyNow.overbookReasonCodes.includes(a.ReasonCode);
      if (conflicts.length && !canOverbook) throw { code: ErrorCodes.CONFLICT, message: "New slot conflicts" };

      const blackout = await this.db.getAll(
        `SELECT * FROM ${Tables.DOCTOR_BLACKOUT_RANGE} WHERE DoctorId = ? AND StartUtc < ? AND EndUtc > ?`,
        [a.DoctorId, newEnd, newSlotStartUtc]
      );
      if (blackout.length) throw { code: ErrorCodes.CONFLICT, message: "New slot overlaps blackout" };

      const blocks = await this.db.getAll(
        `SELECT * FROM ${Tables.APPOINTMENT_BLOCK} WHERE DoctorId = ? AND StartUtc < ? AND EndUtc > ?`,
        [a.DoctorId, newEnd, newSlotStartUtc]
      );
      if (blocks.length) throw { code: ErrorCodes.CONFLICT, message: "New slot overlaps blocked time" };

      const ts = SharedService.getCurrentTimestamp();
      await this.db.runQuery(
        `UPDATE ${Tables.APPOINTMENT} SET StartTimeUtc=?, EndTimeUtc=?, UpdatedAtUtc=? WHERE Id=?`,
        [newSlotStartUtc, newEnd, ts, appointmentId]
      );

      await this.audit.write(actor.role, actor.actorId, "rescheduleAppointment", appointmentId, { oldStartUtc: a.StartTimeUtc, newSlotStartUtc });

      await this.db.commit();

      return {
        appointmentId,
        oldStartUtc: a.StartTimeUtc,
        newStartUtc: newSlotStartUtc,
        events: [{ type: Events.AppointmentRescheduled, data: { appointmentId, oldStartUtc: a.StartTimeUtc, newStartUtc: newSlotStartUtc } }]
      };
    } catch (e) {
      await this.db.rollback();
      throw e;
    }
  }

  // ---------------- Doctor functions ----------------

  async viewSchedule(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const startDateUtc = requireUtcIso(data.startDateUtc, "startDateUtc");
    const endDateUtc = requireUtcIso(data.endDateUtc, "endDateUtc");
    const status = data.status ? requireString(data.status, "status", 30) : null;

    const params = [doctorId, endDateUtc, startDateUtc];
    let sql = `SELECT * FROM ${Tables.APPOINTMENT} WHERE DoctorId = ? AND StartTimeUtc < ? AND EndTimeUtc > ?`;
    if (status) {
      sql += ` AND Status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY StartTimeUtc ASC`;

    const rows = await this.db.getAll(sql, params);
    return {
      appointments: rows.map(a => ({
        id: a.Id,
        clinicId: a.ClinicId,
        doctorId: a.DoctorId,
        patientId: a.PatientId,
        startTimeUtc: a.StartTimeUtc,
        endTimeUtc: a.EndTimeUtc,
        status: a.Status,
        reasonCode: a.ReasonCode,
        notesBlobRef: a.NotesBlobRef || null,
        createdAtUtc: a.CreatedAtUtc,
        updatedAtUtc: a.UpdatedAtUtc
      }))
    };
  }

  async blockTime(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const startUtc = requireUtcIso(data.startUtc, "startUtc");
    const endUtc = requireUtcIso(data.endUtc, "endUtc");
    const reasonCode = sanitizeReasonCode(data.reasonCode);

    if (Date.parse(startUtc) >= Date.parse(endUtc)) throw { code: ErrorCodes.VALIDATION_FAILED, message: "startUtc must be < endUtc" };

    const id = SharedService.generateUUID();
    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(
      `INSERT INTO ${Tables.APPOINTMENT_BLOCK} (Id, DoctorId, StartUtc, EndUtc, ReasonCode, CreatedAtUtc) VALUES (?, ?, ?, ?, ?, ?)` ,
      [id, doctorId, startUtc, endUtc, reasonCode, ts]
    );

    await this.audit.write(actor.role, actor.actorId, "blockTime", id, { doctorId, startUtc, endUtc, reasonCode });

    return { block: { id, doctorId, startUtc, endUtc, reasonCode } };
  }

  async cancelAppointmentByDoctor(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const reasonCode = sanitizeReasonCode(data.reasonCode);

    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id = ?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };
    if (a.DoctorId !== actor.doctorId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Cannot cancel appointments for other doctors" };
    if (a.Status !== AppointmentStatus.BOOKED) throw { code: ErrorCodes.CONFLICT, message: "Only BOOKED appointments can be cancelled" };

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(
      `UPDATE ${Tables.APPOINTMENT} SET Status=?, ReasonCode=?, UpdatedAtUtc=? WHERE Id=?`,
      [AppointmentStatus.CANCELLED_DOCTOR, reasonCode, ts, appointmentId]
    );

    await this.audit.write(actor.role, actor.actorId, "cancelAppointmentByDoctor", appointmentId, { reasonCode });

    return {
      appointmentId,
      status: AppointmentStatus.CANCELLED_DOCTOR,
      events: [{ type: Events.AppointmentCancelled, data: { appointmentId, byRole: "doctor" } }]
    };
  }

  async markCompleted(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id=?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };
    if (a.DoctorId !== actor.doctorId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Not your appointment" };
    if (a.Status !== AppointmentStatus.BOOKED) throw { code: ErrorCodes.CONFLICT, message: "Only BOOKED can be completed" };

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(`UPDATE ${Tables.APPOINTMENT} SET Status=?, UpdatedAtUtc=? WHERE Id=?`, [AppointmentStatus.COMPLETED, ts, appointmentId]);
    await this.audit.write(actor.role, actor.actorId, "markCompleted", appointmentId, {});

    return { appointmentId, status: AppointmentStatus.COMPLETED, events: [{ type: Events.AppointmentCompleted, data: { appointmentId } }] };
  }

  async markNoShow(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id=?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };
    if (a.DoctorId !== actor.doctorId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Not your appointment" };
    if (a.Status !== AppointmentStatus.BOOKED) throw { code: ErrorCodes.CONFLICT, message: "Only BOOKED can be marked no-show" };

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(`UPDATE ${Tables.APPOINTMENT} SET Status=?, UpdatedAtUtc=? WHERE Id=?`, [AppointmentStatus.NO_SHOW, ts, appointmentId]);
    await this.audit.write(actor.role, actor.actorId, "markNoShow", appointmentId, {});

    return { appointmentId, status: AppointmentStatus.NO_SHOW, events: [{ type: Events.AppointmentNoShow, data: { appointmentId } }] };
  }

  // ---------------- Queries with access restrictions ----------------

  async getAppointment(actor, data) {
    const appointmentId = requireString(data.appointmentId, "appointmentId", 80);
    const a = await this.db.getOne(`SELECT * FROM ${Tables.APPOINTMENT} WHERE Id = ?`, [appointmentId]);
    if (!a) throw { code: ErrorCodes.NOT_FOUND, message: "Appointment not found" };

    // Access rules: admin all, doctor own, patient own
    if (actor.role === "doctor" && a.DoctorId !== actor.doctorId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Not allowed" };
    if (actor.role === "patient" && a.PatientId !== actor.patientId) throw { code: ErrorCodes.ACCESS_DENIED, message: "Not allowed" };

    return {
      appointment: {
        id: a.Id,
        clinicId: a.ClinicId,
        doctorId: a.DoctorId,
        patientId: a.PatientId,
        startTimeUtc: a.StartTimeUtc,
        endTimeUtc: a.EndTimeUtc,
        status: a.Status,
        reasonCode: a.ReasonCode,
        notesBlobRef: a.NotesBlobRef || null,
        createdAtUtc: a.CreatedAtUtc,
        updatedAtUtc: a.UpdatedAtUtc
      }
    };
  }

  async listAppointmentsByDoctor(actor, data) {
    const doctorId = requireString(data.doctorId, "doctorId", 80);
    const startDateUtc = requireUtcIso(data.startDateUtc, "startDateUtc");
    const endDateUtc = requireUtcIso(data.endDateUtc, "endDateUtc");
    const status = data.status ? requireString(data.status, "status", 30) : null;

    const params = [doctorId, endDateUtc, startDateUtc];
    let sql = `SELECT * FROM ${Tables.APPOINTMENT} WHERE DoctorId=? AND StartTimeUtc < ? AND EndTimeUtc > ?`;
    if (status) {
      sql += ` AND Status=?`;
      params.push(status);
    }
    sql += " ORDER BY StartTimeUtc ASC";

    const rows = await this.db.getAll(sql, params);
    return { appointments: rows.map(a => ({ id: a.Id, clinicId: a.ClinicId, doctorId: a.DoctorId, patientId: a.PatientId, startTimeUtc: a.StartTimeUtc, endTimeUtc: a.EndTimeUtc, status: a.Status, reasonCode: a.ReasonCode, notesBlobRef: a.NotesBlobRef || null, createdAtUtc: a.CreatedAtUtc, updatedAtUtc: a.UpdatedAtUtc })) };
  }

  async listAppointmentsByPatient(actor, data) {
    const startDateUtc = requireUtcIso(data.startDateUtc, "startDateUtc");
    const endDateUtc = requireUtcIso(data.endDateUtc, "endDateUtc");
    const status = data.status ? requireString(data.status, "status", 30) : null;

    const params = [actor.patientId, endDateUtc, startDateUtc];
    let sql = `SELECT * FROM ${Tables.APPOINTMENT} WHERE PatientId=? AND StartTimeUtc < ? AND EndTimeUtc > ?`;
    if (status) {
      sql += ` AND Status=?`;
      params.push(status);
    }
    sql += " ORDER BY StartTimeUtc ASC";

    const rows = await this.db.getAll(sql, params);
    return { appointments: rows.map(a => ({ id: a.Id, clinicId: a.ClinicId, doctorId: a.DoctorId, patientId: a.PatientId, startTimeUtc: a.StartTimeUtc, endTimeUtc: a.EndTimeUtc, status: a.Status, reasonCode: a.ReasonCode, notesBlobRef: a.NotesBlobRef || null, createdAtUtc: a.CreatedAtUtc, updatedAtUtc: a.UpdatedAtUtc })) };
  }
}

module.exports = { HealthcareService };
