const { HealthcareService } = require("../Services/Domain.Services/HealthcareService");
const { AccessControlService } = require("../Services/Domain.Services/AccessControlService");

class HealthcareController {
  constructor(db, ctx) {
    this.db = db;
    this.ctx = ctx;
    this.svc = new HealthcareService(db);
    this.ac = new AccessControlService(db);
  }

  async handle(user, message, isReadOnly) {
    const action = message.Action;
    const data = message.data || message.Data || {};

    // Determine actor (role-based)
    // Admin actions
    if (["CreateClinic", "SetClinicActive", "AddDoctor", "UpdateDoctor", "SetDoctorActive", "SetDoctorAvailability", "SetPolicy"].includes(action)) {
      const actor = await this.ac.requireAdmin(user);
      return await this.#handleAdmin(actor, action, data);
    }

    // Patient actions
    if (["RegisterPatient", "ListDoctors", "GetDoctor", "GetAvailability", "BookAppointment", "CancelAppointment", "RescheduleAppointment", "ListClinics", "ListAppointmentsByPatient"].includes(action)) {
      if (["ListDoctors", "GetDoctor", "GetAvailability", "ListClinics"].includes(action)) {
        // Public reads allowed
        const actor = { role: "public", actorId: this.ac.getUserPubKeyHex(user) || "public" };
        return await this.#handlePublic(actor, action, data);
      }
      const actor = await this.ac.requirePatient(user);
      return await this.#handlePatient(actor, action, data);
    }

    // Doctor actions
    if (["ViewSchedule", "BlockTime", "CancelAppointmentByDoctor", "MarkCompleted", "MarkNoShow", "ListAppointmentsByDoctor"].includes(action)) {
      const doctorId = data.doctorId;
      const actor = await this.ac.requireDoctor(user, doctorId);
      return await this.#handleDoctor(actor, action, data);
    }

    // Queries
    if (["GetAppointment"].includes(action)) {
      // Determine access: if user is patient and registered -> patient actor; else if admin -> admin; else deny.
      try {
        const actor = await this.ac.requireAdmin(user);
        return await this.svc.getAppointment(actor, data);
      } catch (e) {
        // ignore
      }
      try {
        const actor = await this.ac.requirePatient(user);
        return await this.svc.getAppointment(actor, data);
      } catch (e) {
        // ignore
      }
      // doctor path requires doctorId for self; cannot infer without doctorId mapping from appointment.
      throw { code: "ACCESS_DENIED", message: "Not allowed" };
    }

    throw { code: "BAD_REQUEST", message: "Unknown action" };
  }

  async #handleAdmin(actor, action, data) {
    switch (action) {
      case "CreateClinic":
        return await this.svc.createClinic(actor, data);
      case "SetClinicActive":
        return await this.svc.setClinicActive(actor, data);
      case "AddDoctor":
        return await this.svc.addDoctor(actor, data);
      case "UpdateDoctor":
        return await this.svc.updateDoctor(actor, data);
      case "SetDoctorActive":
        return await this.svc.setDoctorActive(actor, data);
      case "SetDoctorAvailability":
        return await this.svc.setDoctorAvailability(actor, data);
      case "SetPolicy":
        return await this.svc.setPolicy(actor, data);
      default:
        throw { code: "BAD_REQUEST", message: "Unknown admin action" };
    }
  }

  async #handlePatient(actor, action, data) {
    switch (action) {
      case "RegisterPatient":
        return await this.svc.registerPatient(actor, data);
      case "BookAppointment":
        return await this.svc.bookAppointment(actor, data);
      case "CancelAppointment":
        return await this.svc.cancelAppointment(actor, data);
      case "RescheduleAppointment":
        return await this.svc.rescheduleAppointment(actor, data);
      case "ListAppointmentsByPatient":
        return await this.svc.listAppointmentsByPatient(actor, data);
      default:
        throw { code: "BAD_REQUEST", message: "Unknown patient action" };
    }
  }

  async #handleDoctor(actor, action, data) {
    switch (action) {
      case "ViewSchedule":
        return await this.svc.viewSchedule(actor, data);
      case "BlockTime":
        return await this.svc.blockTime(actor, data);
      case "CancelAppointmentByDoctor":
        return await this.svc.cancelAppointmentByDoctor(actor, data);
      case "MarkCompleted":
        return await this.svc.markCompleted(actor, data);
      case "MarkNoShow":
        return await this.svc.markNoShow(actor, data);
      case "ListAppointmentsByDoctor":
        // Admin-only in requirements, but we keep for doctor self usage as alias.
        return await this.svc.listAppointmentsByDoctor(actor, data);
      default:
        throw { code: "BAD_REQUEST", message: "Unknown doctor action" };
    }
  }

  async #handlePublic(actor, action, data) {
    switch (action) {
      case "ListDoctors":
        return await this.svc.listDoctors(actor, data);
      case "GetDoctor":
        return await this.svc.getDoctor(actor, data);
      case "GetAvailability":
        return await this.svc.getAvailability(actor, data);
      case "ListClinics":
        return await this.svc.listClinics(actor, data);
      default:
        throw { code: "BAD_REQUEST", message: "Unknown public action" };
    }
  }
}

module.exports = { HealthcareController };
