const Tables = require("../../Constants/Tables");
const Env = require("../../Utils/Env");
const ErrorCodes = require("../../Constants/ErrorCodes");
const { SharedService } = require("./SharedService");

class RateLimitService {
  constructor(db) {
    this.db = db;
    this.windowMs = parseInt(Env.RATE_LIMIT_WINDOW_MS || "60000", 10);
    this.max = parseInt(Env.RATE_LIMIT_MAX || "120", 10);
  }

  async checkOrThrow(identityKey) {
    const nowMs = Date.parse(SharedService.getCurrentTimestamp());
    const windowStartMs = nowMs - this.windowMs;
    const windowStartIso = new Date(windowStartMs).toISOString();

    // cleanup old
    await this.db.runQuery(
      `DELETE FROM ${Tables.RATE_LIMIT} WHERE IdentityKey = ? AND TimestampUtc < ?`,
      [identityKey, windowStartIso]
    );

    const row = await this.db.getOne(
      `SELECT COUNT(1) AS Cnt FROM ${Tables.RATE_LIMIT} WHERE IdentityKey = ? AND TimestampUtc >= ?`,
      [identityKey, windowStartIso]
    );

    const cnt = row ? row.Cnt : 0;
    if (cnt >= this.max) {
      throw { code: ErrorCodes.RATE_LIMITED, message: "Too many requests", details: { windowMs: this.windowMs, max: this.max } };
    }

    await this.db.runQuery(
      `INSERT INTO ${Tables.RATE_LIMIT} (IdentityKey, TimestampUtc) VALUES (?, ?)` ,
      [identityKey, new Date(nowMs).toISOString()]
    );
  }
}

module.exports = { RateLimitService };
