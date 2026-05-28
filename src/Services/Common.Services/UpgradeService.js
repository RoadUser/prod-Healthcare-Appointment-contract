const { FileService } = require("./FileService");
const { SharedService } = require("./SharedService");
const Tables = require("../../Constants/Tables");
const settings = require("../../settings.json").settings;

class UpgradeService {
  constructor(db, message) {
    this.db = db;
    this.message = message;
  }

  async upgradeContract() {
    const zipData = this.message.data;

    const current = await this.db.getOne(
      `SELECT Version FROM ${Tables.CONTRACTVERSION} ORDER BY Id DESC LIMIT 1`,
      []
    );
    const currentVersion = current && current.Version ? parseFloat(current.Version) : 1.0;

    const incomingVersion = parseFloat(zipData.version);
    if (!incomingVersion || Number.isNaN(incomingVersion)) {
      throw { code: "VALIDATION_FAILED", message: "Invalid version" };
    }

    if (incomingVersion <= currentVersion) {
      throw { code: "FORBIDDEN", message: `Incoming version (${incomingVersion}) must be greater than current version (${currentVersion}).` };
    }

    FileService.writeFile(settings.newContractZipFileName, Buffer.from(zipData.content));

    const shellScriptContent = `#!/bin/bash

echo "post_exec.sh running"

! command -v unzip &>/dev/null && apt-get update && apt-get install --no-install-recommends -y unzip

zip_file=\"${settings.newContractZipFileName}\"

unzip -o -d ./ \"$zip_file\" >>/dev/null
rm \"$zip_file\" >>/dev/null
`;

    FileService.writeFile(settings.postExecutionScriptName, shellScriptContent);
    FileService.changeMode(settings.postExecutionScriptName, 0o777);

    const ts = SharedService.getCurrentTimestamp();
    await this.db.runQuery(
      `INSERT INTO ${Tables.CONTRACTVERSION} (Version, Description, CreatedOn, LastUpdatedOn) VALUES (?, ?, ?, ?)`,
      [incomingVersion, zipData.description || "", ts, ts]
    );

    return { message: "Contract upgraded", version: incomingVersion };
  }
}

module.exports = { UpgradeService };
