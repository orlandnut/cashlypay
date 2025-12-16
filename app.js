/*
Copyright 2020 Square Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const express = require("express");
const path = require("path");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const routes = require("./routes/index");
const webhookRoutes = require("./routes/webhooks");
const { startGiftCardReconciler } = require("./util/gift-card-sync");
const app = express();
app.set("trust proxy", 1);

// Node creates cashed instance of square-client, on initial load
require("./util/square-client");
startGiftCardReconciler();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.set("view options", {
  basedir: path.join(__dirname),
});

// Application level middleware
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(compression());

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(requestLimiter);

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')))
app.use(logger("dev"));
app.use(bodyParser.json({ limit: "1mb" }));
app.use(
  bodyParser.urlencoded({
    extended: false,
    limit: "1mb",
  }),
);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, ".well-known")));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use("/", routes);
app.use("/webhooks", webhookRoutes);
app.get("/settings", (req, res) => {
  res.redirect("/admin");
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handlers
// For simplicity, we print all error information
app.use(function (err, req, res) {
  res.status(err.status || 500);
  res.render("error", {
    status: err.status,
    message: err.message,
    // If it is a response error then format the JSON string, if not output the error
    error: err.errors ? JSON.stringify(err.errors, null, 4) : err.stack,
  });
});

module.exports = app;
