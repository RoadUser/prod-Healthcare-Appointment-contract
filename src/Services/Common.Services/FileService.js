const fs = require("fs");

class FileService {
  static writeFile(filePath, content) {
    fs.writeFileSync(filePath, content);
  }

  static readFile(filePath) {
    return fs.readFileSync(filePath, "utf-8");
  }

  static changeMode(filePath, mode) {
    fs.chmodSync(filePath, mode);
  }
}

module.exports = { FileService };
