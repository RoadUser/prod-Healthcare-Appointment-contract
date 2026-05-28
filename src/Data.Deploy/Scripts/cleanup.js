const fs = require("fs");

// Placeholder cleanup script for dbScripts folder requirements.
// In production you might remove temp files or old artifacts.

function run() {
  const files = ["newContractData.zip", "post_exec.sh"];
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) {
      // ignore
    }
  }
}

run();
