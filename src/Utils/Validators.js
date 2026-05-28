const ErrorCodes = require("../Constants/ErrorCodes");

function err(code, message, details) {
  return { code, message, details: details || null };
}

function requireString(v, field, maxLen) {
  if (typeof v !== "string" || !v.trim()) throw err(ErrorCodes.VALIDATION_FAILED, `${field} is required`, { field });
  const s = v.trim();
  if (maxLen && s.length > maxLen) throw err(ErrorCodes.VALIDATION_FAILED, `${field} too long`, { field, maxLen });
  return s;
}

function optionalString(v, field, maxLen) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be string`, { field });
  const s = v.trim();
  if (maxLen && s.length > maxLen) throw err(ErrorCodes.VALIDATION_FAILED, `${field} too long`, { field, maxLen });
  return s;
}

function requireBoolean(v, field) {
  if (typeof v !== "boolean") throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be boolean`, { field });
  return v;
}

function requireInt(v, field, min, max) {
  if (!Number.isInteger(v)) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be integer`, { field });
  if (min !== undefined && v < min) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be >= ${min}`, { field });
  if (max !== undefined && v > max) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be <= ${max}`, { field });
  return v;
}

function requireUtcIso(v, field) {
  const s = requireString(v, field, 40);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be ISO timestamp`, { field });
  if (!s.endsWith("Z")) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be UTC (end with Z)`, { field });
  return s;
}

function requireDateIso(v, field) {
  const s = requireString(v, field, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be YYYY-MM-DD`, { field });
  return s;
}

function requireTimeHHMM(v, field) {
  const s = requireString(v, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw err(ErrorCodes.VALIDATION_FAILED, `${field} must be HH:MM`, { field });
  return s;
}

function sanitizeReasonCode(v) {
  const s = requireString(v, "reasonCode", 32);
  if (!/^[A-Za-z0-9_\-\.]{1,32}$/.test(s)) throw err(ErrorCodes.VALIDATION_FAILED, "reasonCode contains invalid characters", { reasonCode: s });
  return s;
}

module.exports = {
  err,
  requireString,
  optionalString,
  requireBoolean,
  requireInt,
  requireUtcIso,
  requireDateIso,
  requireTimeHHMM,
  sanitizeReasonCode
};
