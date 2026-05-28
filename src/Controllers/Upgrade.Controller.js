const nacl = require("tweetnacl");
const Env = require("../Utils/Env");
const ErrorCodes = require("../Constants/ErrorCodes");
const { UpgradeService } = require("../Services/Common.Services/UpgradeService");

function isMaintainer(userPubKeyHex) {
  const expected = (Env.MAINTAINER_PUBKEY || "").toLowerCase();
  if (!expected) return false;
  return (userPubKeyHex || "").toLowerCase() === expected;
}

function hexToUint8(hex) {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(Buffer.from(hex, "hex"));
}

class UpgradeController {
  constructor(db, ctx, user, message) {
    this.db = db;
    this.ctx = ctx;
    this.user = user;
    this.message = message;
  }

  async handle() {
    const userPubKeyHex = Buffer.from(this.user.pubKey).toString("hex").toLowerCase();
    if (!isMaintainer(userPubKeyHex)) {
      throw { code: ErrorCodes.ACCESS_DENIED, message: "Unauthorized maintainer" };
    }

    const data = this.message.data || {};
    const zipBase64 = data.zipBase64;
    const zipSignatureHex = data.zipSignatureHex;
    const version = data.version;

    if (!zipBase64 || !zipSignatureHex || version === undefined) {
      throw { code: ErrorCodes.VALIDATION_FAILED, message: "Missing upgrade fields" };
    }

    const zipBuf = Buffer.from(zipBase64, "base64");
    const sig = hexToUint8(zipSignatureHex);
    if (!sig) throw { code: ErrorCodes.VALIDATION_FAILED, message: "Invalid zipSignatureHex" };

    const pub = hexToUint8(Env.MAINTAINER_PUBKEY);
    if (!pub) throw { code: ErrorCodes.INTERNAL_ERROR, message: "MAINTAINER_PUBKEY invalid in env" };

    const ok = nacl.sign.detached.verify(new Uint8Array(zipBuf), sig, pub);
    if (!ok) throw { code: ErrorCodes.UNAUTHORIZED, message: "Signature verification failed" };

    const svc = new UpgradeService(this.db, {
      data: {
        version: parseFloat(version),
        description: data.description || "",
        content: zipBuf
      }
    });

    return await svc.upgradeContract();
  }
}

module.exports = { UpgradeController };
