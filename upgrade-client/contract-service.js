const HotPocket = require("hotpocket-js-client");
const bson = require("bson");
const crypto = require("crypto");

class ContractService {
  constructor(servers, userKeyPair) {
    this.servers = servers;
    this.userKeyPair = userKeyPair;
    this.client = null;
    this.isConnectionSucceeded = false;
    this.promiseMap = new Map();
  }

  async init() {
    if (!this.userKeyPair) {
      this.userKeyPair = await HotPocket.generateKeys();
    }

    this.client = await HotPocket.createClient(this.servers, this.userKeyPair, {
      protocol: HotPocket.protocols.bson
    });

    this.client.on(HotPocket.events.disconnect, () => {
      this.isConnectionSucceeded = false;
    });

    this.client.on(HotPocket.events.contractOutput, r => {
      r.outputs.forEach(o => {
        let out;
        try {
          out = bson.deserialize(o);
        } catch (e) {
          try {
            out = JSON.parse(o.toString());
          } catch (e2) {
            return;
          }
        }

        const pId = out.promiseId;
        if (!pId) return;

        if (out.error) this.promiseMap.get(pId)?.rejecter(out.error);
        else this.promiseMap.get(pId)?.resolver(out.success || out);

        this.promiseMap.delete(pId);
      });
    });

    if (!this.isConnectionSucceeded) {
      if (!(await this.client.connect())) return false;
      this.isConnectionSucceeded = true;
    }

    return true;
  }

  submitInputToContract(inp) {
    const promiseId = crypto.randomBytes(10).toString("hex");
    const payload = { promiseId, ...inp };
    const buf = bson.serialize(payload);

    this.client.submitContractInput(buf).then(input => {
      input?.submissionStatus?.then(s => {
        if (s.status !== "accepted") {
          this.promiseMap.get(promiseId)?.rejecter({ code: "LEDGER_REJECTION", message: s.reason });
          this.promiseMap.delete(promiseId);
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.promiseMap.set(promiseId, { resolver: resolve, rejecter: reject });
    });
  }
}

module.exports = ContractService;
