const fs = require("fs");
const path = require("path");

const localConfigPath = path.join(__dirname, "serverless.env.local.js");

if (fs.existsSync(localConfigPath)) {
  // eslint-disable-next-line global-require
  module.exports = require(localConfigPath);
} else {
  // eslint-disable-next-line global-require
  module.exports = require("./serverless.env.defaults");
}
