const sqlite3 = require("sqlite3").verbose();

class SqliteDatabase {
  constructor(dbFile) {
    this.dbFile = dbFile;
    this.openConnections = 0;
    this.db = null;
  }

  open() {
    if (this.openConnections <= 0) {
      this.db = new sqlite3.Database(this.dbFile);
      this.openConnections = 1;
    } else {
      this.openConnections++;
    }
  }

  close() {
    if (this.openConnections <= 1) {
      if (this.db) this.db.close();
      this.db = null;
      this.openConnections = 0;
    } else {
      this.openConnections--;
    }
  }

  runQuery(query, params) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params || [], function (err) {
        if (err) return reject(err);
        resolve({ lastId: this.lastID, changes: this.changes });
      });
    });
  }

  getAll(query, params) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params || [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  getOne(query, params) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params || [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  async beginImmediate() {
    await this.runQuery("BEGIN IMMEDIATE");
  }

  async commit() {
    await this.runQuery("COMMIT");
  }

  async rollback() {
    await this.runQuery("ROLLBACK");
  }
}

module.exports = { SqliteDatabase };
