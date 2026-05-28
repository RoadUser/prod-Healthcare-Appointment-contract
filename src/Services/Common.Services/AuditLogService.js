const Tables = require("../../Constants/Tables");
const { SharedService } = require("./SharedService");

class AuditLogService {
  constructor(db) {
    this.db = db;
  }

  async write(actorRole, actorId, action, targetId, metadata) {
    const ts = SharedService.getCurrentTimestamp();
    const meta = metadata ? JSON.stringify(metadata) : null;
    await this.db.runQuery(
      `INSERT INTO ${Tables.AUDITLOG} (ActorRole, ActorId, Action, TargetId, TimestampUtc, MetadataJson) VALUES (?, ?, ?, ?, ?, ?)` ,
      [actorRole, actorId, action, targetId || null, ts, meta]
    );
  }
}

module.exports = { AuditLogService };
