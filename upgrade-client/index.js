const fs = require("fs");
const path = require("path");
const HotPocket = require("hotpocket-js-client");
const nacl = require("tweetnacl");
const ContractService = require("./contract-service");

// Run:
// node index.js <contractUrl> <zipFilePath> <maintainerPrivateKeyHex> <version> <description>

function hexToU8(hex) {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(Buffer.from(hex, "hex"));
}

async function main() {
  const contractUrl = process.argv[2];
  const filepath = process.argv[3];
  const privHex = process.argv[4];
  const version = process.argv[5];
  const description = process.argv[6] || "";

  if (!contractUrl || !filepath || !privHex || !version) {
    console.log("Usage: node index.js <contractUrl> <zipFilePath> <maintainerPrivateKeyHex> <version> <description>");
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filepath);
  const sizeKB = Math.round(fileContent.length / 1024);
  const fileName = path.basename(filepath);

  // Build HotPocket keypair from provided maintainer private key (Ed25519 seed/private key bytes).
  // hotpocket-js-client expects keypair bytes for auth; for signing we use nacl detached signature.
  const priv = hexToU8(privHex);
  if (!priv) {
    console.log("Invalid maintainerPrivateKeyHex");
    process.exit(1);
  }

  // If user provides 64-byte secretKey, derive public.
  // If user provides 32-byte seed, nacl will expand.
  let keyPair;
  if (priv.length === 64) {
    keyPair = { publicKey: priv.slice(32), privateKey: priv };
  } else if (priv.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(priv);
    keyPair = { publicKey: kp.publicKey, privateKey: kp.secretKey };
  } else {
    console.log("Private key must be 32-byte seed hex or 64-byte secretKey hex");
    process.exit(1);
  }

  const cs = new ContractService([contractUrl], keyPair);
  const ok = await cs.init();
  if (!ok) {
    console.log("Connection failed");
    process.exit(1);
  }

  const signature = nacl.sign.detached(new Uint8Array(fileContent), keyPair.privateKey);

  const submitData = {
    service: "Upgrade",
    Service: "Upgrade",
    Action: "UpgradeContract",
    data: {
      version: parseFloat(version),
      description,
      zipBase64: fileContent.toString("base64"),
      zipSignatureHex: Buffer.from(signature).toString("hex")
    }
  };

  console.log(`Uploading ${fileName} ${sizeKB}KB as version ${version}`);

  cs.submitInputToContract(submitData)
    .then(r => {
      console.log("Upgrade submitted:", r);
    })
    .catch(e => {
      console.log("Upgrade failed:", e);
    })
    .finally(() => process.exit(0));
}

main();
