const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const settings = require("../settings.json").settings;
const Tables = require("../Constants/Tables");
const { SharedService } = require("../Services/Common.Services/SharedService");

class DBInitializer {
  static db = null;

  static async init() {
    if (!fs.existsSync(settings.dbPath)) {
      this.db = new sqlite3.Database(settings.dbPath);
      await this.#runQuery("PRAGMA foreign_keys = ON");

      // ContractVersion (EXACT schema requirement)
      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.CONTRACTVERSION} (
        Id INTEGER,
        Version FLOAT NOT NULL,
        Description TEXT,
        CreatedOn DATETIME DEFAULT CURRENT_TIMESTAMP,
        LastUpdatedOn DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY("Id" AUTOINCREMENT)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.SQLSCRIPTMIGRATIONS} (
        Id INTEGER,
        Sprint TEXT NOT NULL,
        ScriptName TEXT NOT NULL,
        ExecutedTimestamp TEXT,
        PRIMARY KEY("Id" AUTOINCREMENT)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.POLICY} (
        Id INTEGER,
        CancellationWindowMinutes INTEGER NOT NULL,
        RescheduleWindowMinutes INTEGER NOT NULL,
        AllowPatientNotes INTEGER NOT NULL,
        OverbookReasonCodesJson TEXT,
        CreatedAtUtc TEXT NOT NULL,
        UpdatedAtUtc TEXT NOT NULL,
        PRIMARY KEY("Id" AUTOINCREMENT)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.CLINIC} (
        Id TEXT PRIMARY KEY,
        Name TEXT NOT NULL,
        Active INTEGER NOT NULL
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.DOCTOR} (
        Id TEXT PRIMARY KEY,
        ClinicId TEXT NOT NULL,
        DisplayName TEXT NOT NULL,
        Specialty TEXT NOT NULL,
        TimeZone TEXT NOT NULL,
        Active INTEGER NOT NULL,
        AppointmentDurationsMinutesJson TEXT NOT NULL,
        BufferMinutes INTEGER NOT NULL,
        MaxDailyAppointments INTEGER NOT NULL,
        OverbookingAllowed INTEGER NOT NULL,
        FOREIGN KEY (ClinicId) REFERENCES ${Tables.CLINIC}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.DOCTOR_AVAILABILITY_RULE} (
        Id INTEGER,
        DoctorId TEXT NOT NULL,
        DayOfWeek INTEGER NOT NULL,
        StartTime TEXT NOT NULL,
        EndTime TEXT NOT NULL,
        PRIMARY KEY("Id" AUTOINCREMENT),
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.DOCTOR_EXCEPTION_DAY} (
        Id INTEGER,
        DoctorId TEXT NOT NULL,
        Date TEXT NOT NULL,
        Available INTEGER NOT NULL,
        PRIMARY KEY("Id" AUTOINCREMENT),
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.DOCTOR_BLACKOUT_RANGE} (
        Id INTEGER,
        DoctorId TEXT NOT NULL,
        StartUtc TEXT NOT NULL,
        EndUtc TEXT NOT NULL,
        PRIMARY KEY("Id" AUTOINCREMENT),
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.PATIENT} (
        Id TEXT PRIMARY KEY,
        DisplayName TEXT NOT NULL,
        TimeZone TEXT NOT NULL,
        ContactHash TEXT NOT NULL,
        PreferencesJson TEXT,
        CreatedAtUtc TEXT NOT NULL
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.ADMIN} (
        Id TEXT PRIMARY KEY,
        CreatedAtUtc TEXT NOT NULL
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.DOCTOR_ROLE} (
        DoctorId TEXT PRIMARY KEY,
        OwnerPubKeyHex TEXT NOT NULL,
        CreatedAtUtc TEXT NOT NULL,
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.APPOINTMENT} (
        Id TEXT PRIMARY KEY,
        ClinicId TEXT NOT NULL,
        DoctorId TEXT NOT NULL,
        PatientId TEXT NOT NULL,
        StartTimeUtc TEXT NOT NULL,
        EndTimeUtc TEXT NOT NULL,
        Status TEXT NOT NULL,
        ReasonCode TEXT NOT NULL,
        NotesBlobRef TEXT,
        CreatedAtUtc TEXT NOT NULL,
        UpdatedAtUtc TEXT NOT NULL,
        FOREIGN KEY (ClinicId) REFERENCES ${Tables.CLINIC}(Id),
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id),
        FOREIGN KEY (PatientId) REFERENCES ${Tables.PATIENT}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.APPOINTMENT_BLOCK} (
        Id TEXT PRIMARY KEY,
        DoctorId TEXT NOT NULL,
        StartUtc TEXT NOT NULL,
        EndUtc TEXT NOT NULL,
        ReasonCode TEXT NOT NULL,
        CreatedAtUtc TEXT NOT NULL,
        FOREIGN KEY (DoctorId) REFERENCES ${Tables.DOCTOR}(Id)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.AUDITLOG} (
        Id INTEGER,
        ActorRole TEXT NOT NULL,
        ActorId TEXT NOT NULL,
        Action TEXT NOT NULL,
        TargetId TEXT,
        TimestampUtc TEXT NOT NULL,
        MetadataJson TEXT,
        PRIMARY KEY("Id" AUTOINCREMENT)
      )`);

      await this.#runQuery(`CREATE TABLE IF NOT EXISTS ${Tables.RATE_LIMIT} (
        Id INTEGER,
        IdentityKey TEXT NOT NULL,
        TimestampUtc TEXT NOT NULL,
        PRIMARY KEY("Id" AUTOINCREMENT)
      )`);

      this.db.close();
    }

    // Script runner (kept compatible with the template approach)
    if (fs.existsSync(settings.dbPath)) {
      this.db = new sqlite3.Database(settings.dbPath);

      const lastRow = await this.#getRecord(
        `SELECT Sprint FROM ${Tables.SQLSCRIPTMIGRATIONS} ORDER BY Sprint DESC LIMIT 1`
      );
      const lastSprint = lastRow ? lastRow.Sprint : "Sprint_00";

      if (fs.existsSync(settings.dbScriptsFolderPath)) {
        const scriptFolders = fs
          .readdirSync(settings.dbScriptsFolderPath)
          .filter(folder => folder.startsWith("Sprint_") && folder >= lastSprint)
          .sort();

        for (const sprintFolder of scriptFolders) {
          const sprintFolderPath = path.join(settings.dbScriptsFolderPath, sprintFolder);
          const sqlFiles = fs
            .readdirSync(sprintFolderPath)
            .filter(file => file.match(/^\d+_.+\.sql$/))
            .sort();

          for (const sqlFile of sqlFiles) {
            const exists = await this.#getRecord(
              `SELECT * FROM ${Tables.SQLSCRIPTMIGRATIONS} WHERE Sprint = ? AND ScriptName = ?`,
              [sprintFolder, sqlFile]
            );
            if (exists) continue;

            const scriptPath = path.join(sprintFolderPath, sqlFile);
            const sqlScript = fs.readFileSync(scriptPath, "utf8");
            const sqlStatements = sqlScript
              .split(";")
              .map(stmt => stmt
                .split(/\?\
/)
                .map(line => (line.trim().startsWith("--") ? "" : line))
                .join("\
")
              )
              .filter(stmt => stmt.trim() !== "");

            for (const statement of sqlStatements) {
              await this.#runQuery(statement);
            }

            await this.#runQuery(
              `INSERT INTO ${Tables.SQLSCRIPTMIGRATIONS} (Sprint, ScriptName, ExecutedTimestamp) VALUES (?, ?, ?)`,
              [sprintFolder, sqlFile, SharedService.getCurrentTimestamp()]
            );
          }
        }
      }

      this.db.close();
    }
  }

  static #runQuery(query, params) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params || [], function (err) {
        if (err) return reject(err);
        resolve({ lastId: this.lastID, changes: this.changes });
      });
    });
  }

  static #getRecord(query, params) {
    return new Promise((resolve, reject) => {
      if (params && params.length) {
        this.db.get(query, params, (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      } else {
        this.db.get(query, (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      }
    });
  }
}

module.exports = { DBInitializer };
