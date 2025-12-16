const serverless = require("serverless-http");
const app = require("./app");

module.exports.handler = serverless(app, {
  request: (req, event) => {
    // surface API Gateway context data if needed downstream
    req.awsEvent = event;
  },
});
