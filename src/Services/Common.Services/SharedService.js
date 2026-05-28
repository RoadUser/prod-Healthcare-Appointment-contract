const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

class SharedService {
  static context = null;
  static nplEventEmitter = new EventEmitter();

  static generateUUID() {
    return uuidv4();
  }

  static getUtcISOStringFromUnixTimestamp(milliseconds) {
    const date = new Date(milliseconds);
    return date.toISOString();
  }

  static getCurrentTimestamp() {
    return this.getUtcISOStringFromUnixTimestamp(this.context.timestamp);
  }
}

module.exports = { SharedService };
