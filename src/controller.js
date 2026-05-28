const ServiceTypes = require("./Constants/ServiceTypes");
const { SqliteDatabase } = require("./Services/Common.Services/dbHandler");
const settings = require("./settings.json").settings;
const { ok, fail } = require("./Utils/ResponseHelper");
const { HealthcareController } = require("./Controllers/Healthcare.Controller");
const { UpgradeController } = require("./Controllers/Upgrade.Controller");

class Controller {
  constructor() {
    this.db = new SqliteDatabase(settings.dbPath);
  }

  async handleRequest(ctx, user, message, isReadOnly) {
    const svc = message.Service || message.service;

    this.db.open();
    try {
      let result;

      if (svc === ServiceTypes.UPGRADE) {
        const uc = new UpgradeController(this.db, ctx, user, message);
        const out = await uc.handle();
        result = ok(out);
      } else if (svc === ServiceTypes.HEALTHCARE) {
        const hc = new HealthcareController(this.db, ctx);
        const out = await hc.handle(user, message, isReadOnly);

        // merge events into standard response
        if (out && out.events) {
          const events = out.events;
          const clone = { ...out };
          delete clone.events;
          result = ok(clone, events);
        } else {
          result = ok(out);
        }
      } else {
        result = fail({ code: "BAD_REQUEST", message: "Unknown Service" });
      }

      // Emit events as outputs as well (best-effort)
      if (result && result.events && Array.isArray(result.events)) {
        for (const ev of result.events) {
          try {
            await user.send({ event: ev.type, data: ev.data });
          } catch (e) {
            // ignore
          }
        }
      }

      await user.send(message.promiseId ? { promiseId: message.promiseId, ...result } : result);
    } catch (e) {
      const errObj = e && e.code ? e : { code: "INTERNAL_ERROR", message: (e && e.message) ? e.message : "Internal error" };
      await user.send(message.promiseId ? { promiseId: message.promiseId, error: errObj } : { error: errObj });
    } finally {
      this.db.close();
    }
  }
}

module.exports = { Controller };
