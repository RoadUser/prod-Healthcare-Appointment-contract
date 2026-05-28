const fs = require("fs");

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  const res = fs.readFileSync(filePath, "utf8");
  res.split(/\?\
/).forEach(line => {
    const trimmed = (line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    const rawVal = trimmed.slice(idx + 1);
    const val = rawVal.replace(new RegExp(`^${key}=`), "");

    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      env[key] = val.slice(1, -1);
      return;
    }

    const asInt = parseInt(val, 10);
    if (!isNaN(asInt) && String(asInt) === val.trim()) {
      env[key] = asInt;
      return;
    }

    env[key] = val;
  });

  return env;
}

const envFromFile = loadEnvFile(".env");

module.exports = {
  ...process.env,
  ...envFromFile
};
