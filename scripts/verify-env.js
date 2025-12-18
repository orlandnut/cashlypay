#!/usr/bin/env node

const path = require("path");

const REQUIRED_KEYS = [
  "SQUARE_ENVIRONMENT",
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_APP_ID",
  "SQUARE_LOCATION_ID",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
];

const PLACEHOLDER_PATTERN = /^YOUR_/i;

const loadConfig = () => {
  const localPath = path.join(__dirname, "../config/serverless.env.local.js");
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(
    require("fs").existsSync(localPath)
      ? localPath
      : "../config/serverless.env.defaults",
  );
};

const main = () => {
  const config = loadConfig();
  const errors = [];

  REQUIRED_KEYS.forEach((key) => {
    const value = config[key];
    if (!value || PLACEHOLDER_PATTERN.test(String(value).trim())) {
      errors.push(
        `${key} is missing or still set to a placeholder. Update config/serverless.env.local.js.`,
      );
    }
  });

  if (errors.length) {
    console.error("❌ Environment validation failed:\n");
    errors.forEach((msg) => console.error(`- ${msg}`));
    console.error(
      "\nCreate config/serverless.env.local.js (copy the defaults file) and provide real values before deploying.",
    );
    process.exit(1);
  }

  console.info("✅ Environment configuration looks good.");
};

main();
