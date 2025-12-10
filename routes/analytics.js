const express = require("express");
const activityStore = require("../util/activity-store");
const reminderQueue = require("../util/reminder-queue");
const milestoneStore = require("../util/milestone-store");

const router = express.Router();

const RANGE_CONFIG = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
};

router.get("/", (req, res) => {
  const activities = activityStore.listAll();
  const type = (req.query.type || "ALL").toUpperCase();
  const rangeKey = req.query.range || "7d";
  const cutoffMs = RANGE_CONFIG[rangeKey] ?? null;
  const now = Date.now();

  const filtered = activities.filter((item) => {
    const matchesType = type === "ALL" || item.type === type;
    const matchesRange =
      !cutoffMs ||
      (item.timestamp && new Date(item.timestamp).getTime() >= now - cutoffMs);
    return matchesType && matchesRange;
  });

  const totalReminders = filtered.filter(
    (item) => item.type === "REMINDER_SENT",
  ).length;
  const reminderBacklog = reminderQueue.listReminders().length;
  const recentActivities = filtered.slice(-10).reverse();
  const milestoneMetrics = milestoneStore.metrics();
  const upcomingMilestones = milestoneStore.listUpcoming(5);

  res.render("analytics", {
    metrics: {
      totalEvents: filtered.length,
      totalReminders,
      reminderBacklog,
      milestoneTotal: milestoneMetrics.totalAmount,
      milestoneBuckets: milestoneMetrics.totals,
    },
    recentActivities,
    upcomingMilestones,
    filters: {
      type,
      range: rangeKey,
    },
  });
});

module.exports = router;
