const HotPocket = require("hotpocket-js-client");

async function connectClient(url, keyPair) {
  const client = await HotPocket.createClient([url], keyPair);
  const ok = await client.connect();
  if (!ok) throw new Error("Connection failed");
  return client;
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `AssertEqual failed: ${a} !== ${b}`);
}

function assertTrue(v, msg) {
  if (!v) throw new Error(msg || "AssertTrue failed");
}

function assertSuccess(res, msg) {
  if (!res || res.error) throw new Error(msg || `Expected success, got error: ${JSON.stringify(res && res.error)}`);
}

function assertError(res, code, msg) {
  if (!res || !res.error) throw new Error(msg || `Expected error, got: ${JSON.stringify(res)}`);
  if (code && res.error.code !== code) throw new Error(`Expected error code ${code} but got ${res.error.code}`);
}

function nowPlusMinutes(mins) {
  return new Date(Date.now() + mins * 60000).toISOString();
}

module.exports = {
  connectClient,
  assertEqual,
  assertTrue,
  assertSuccess,
  assertError,
  nowPlusMinutes
};
