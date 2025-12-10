const express = require("express");
const { listReminders, runNow } = require("../util/reminder-queue");

const router = express.Router();

router.get("/", (req, res) => {
  const squareEnv = (
    process.env.SQUARE_ENVIRONMENT ||
    process.env.NODE_ENV ||
    "sandbox"
  ).toUpperCase();
  const timezone = process.env.APP_TIMEZONE || "UTC";
  const reminderCadence = process.env.REMINDER_INTERVAL_MINUTES || 60;

  const settings = {
    environment: {
      label: squareEnv === "PRODUCTION" ? "Live" : "Testing",
      squareEnv,
      timezone,
      version: process.env.npm_package_version || "1.0.0",
      lastDeployed: process.env.DEPLOYED_AT || "Not recorded",
    },
    integrations: [
      {
        name: "Square API",
        status: "connected",
        detail: `Environment: ${squareEnv}`,
      },
      {
        name: "Email (SendGrid)",
        status: process.env.SENDGRID_API_KEY ? "connected" : "disconnected",
        detail: process.env.SENDGRID_API_KEY
          ? "API key detected"
          : "Set SENDGRID_API_KEY",
      },
      {
        name: "Slack Alerts",
        status: process.env.SLACK_WEBHOOK_URL ? "connected" : "pending",
        detail: process.env.SLACK_WEBHOOK_URL
          ? "Webhook configured"
          : "Add SLACK_WEBHOOK_URL",
      },
    ],
    reminderConfig: {
      cadenceMinutes: reminderCadence,
      timezone,
      upcomingDays: process.env.REMINDER_UPCOMING_DAYS || 2,
      overdueDays: process.env.REMINDER_OVERDUE_DAYS || 1,
    },
    featureFlags: [
      {
        key: "estimates",
        label: "Estimate Builder",
        enabled: true,
        description:
          "Allow draft estimates with deposits, surcharges, and attachments.",
      },
      {
        key: "subscriptions",
        label: "Subscription Plans",
        enabled: true,
        description: "Enable recurring invoices and automatic renewals.",
      },
      {
        key: "autoApprovals",
        label: "Auto Approvals",
        enabled: false,
        description:
          "Automatically approve invoices below internal thresholds.",
      },
    ],
  };

  res.render("admin-settings", { settings });
});

router.get("/reminders", (req, res) => {
  const reminders = listReminders();
  res.render("admin-reminders", { reminders });
});

router.post("/reminders/run", (req, res) => {
  runNow();
  res.redirect("/admin/reminders");
});

module.exports = router;
