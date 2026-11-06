const path = require("node:path");
module.exports = function composedLock(source) {
  this.addDependency(path.join(path.dirname(this.resourcePath), "composed.lock.json"));
  return source;
};
