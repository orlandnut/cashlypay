const fs = require("fs");
const path = require("path");
const activityStore = require("./activity-store");

const DATA_FILE = path.join(__dirname, "../data/reminders.json");
const PROCESS_INTERVAL_MS = 60 * 1000;

const ensureFile = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf-8");
  }
};

const readReminders = () => {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to parse reminders file: ${error.message}`);
  }
  return [];
};

const writeReminders = (reminders) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(reminders, null, 2));
};

const log = (message) => {
  // eslint-disable-next-line no-console
  console.log(`[ReminderQueue] ${message}`);
};

const scheduleReminder = (reminder) => {
  const reminders = readReminders();
  const newReminder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    ...reminder,
  };

  const existingIndex = reminders.findIndex(
    (item) =>
      item.invoiceId === newReminder.invoiceId &&
      item.type === newReminder.type,
  );

  if (existingIndex >= 0) {
    reminders[existingIndex] = newReminder;
    log(
      `Updated reminder ${newReminder.type} for invoice ${newReminder.invoiceId}`,
    );
  } else {
    reminders.push(newReminder);
    log(
      `Scheduled reminder ${newReminder.type} for invoice ${newReminder.invoiceId}`,
    );
  }

  writeReminders(reminders);
};

const scheduleFromInvoice = (invoice) => {
  if (
    !Array.isArray(invoice.paymentRequests) ||
    !invoice.paymentRequests.length
  )
    return;
  const paymentRequest =
    invoice.paymentRequests.find(
      (request) => request.requestType === "BALANCE",
    ) || invoice.paymentRequests[0];

  if (!paymentRequest || !paymentRequest.dueDate) return;

  const dueDate = new Date(paymentRequest.dueDate);
  const reminderDate = new Date(dueDate);
  reminderDate.setDate(dueDate.getDate() - 1);

  scheduleReminder({
    invoiceId: invoice.id,
    customerId: invoice.primaryRecipient?.customerId,
    locationId: invoice.locationId,
    type: "UPCOMING_DUE",
    runAt: reminderDate.toISOString(),
    message: `Invoice ${invoice.invoiceNumber || invoice.id} is due soon.`,
  });

  const overdueDate = new Date(dueDate);
  overdueDate.setDate(dueDate.getDate() + 1);
  scheduleReminder({
    invoiceId: invoice.id,
    customerId: invoice.primaryRecipient?.customerId,
    locationId: invoice.locationId,
    type: "OVERDUE_CHECK",
    runAt: overdueDate.toISOString(),
    message: `Invoice ${invoice.invoiceNumber || invoice.id} is overdue.`,
  });
};

const scheduleMilestoneReminders = (invoice, milestones = []) => {
  if (!invoice || !Array.isArray(milestones)) return;
  milestones.forEach((milestone) => {
    if (!milestone.dueDate) return;
    const dueDate = new Date(milestone.dueDate);
    if (Number.isNaN(dueDate.getTime())) return;
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(dueDate.getDate() - 1);
    scheduleReminder({
      invoiceId: invoice.id,
      customerId: invoice.primaryRecipient?.customerId,
      locationId: invoice.locationId,
      type: "MILESTONE_UPCOMING",
      runAt: reminderDate.toISOString(),
      message: `${milestone.label} milestone is due soon.`,
      milestone: {
        label: milestone.label,
        amount: milestone.amount,
      },
    });

    const overdueDate = new Date(dueDate);
    overdueDate.setDate(dueDate.getDate() + 1);
    scheduleReminder({
      invoiceId: invoice.id,
      customerId: invoice.primaryRecipient?.customerId,
      locationId: invoice.locationId,
      type: "MILESTONE_OVERDUE",
      runAt: overdueDate.toISOString(),
      message: `${milestone.label} milestone is overdue.`,
      milestone: {
        label: milestone.label,
        amount: milestone.amount,
      },
    });
  });
};

const processReminders = () => {
  try {
    const reminders = readReminders();
    const now = Date.now();
    const remaining = [];

    reminders.forEach((reminder) => {
      if (new Date(reminder.runAt).getTime() <= now) {
        log(
          `Sending ${reminder.type} reminder for invoice ${reminder.invoiceId}`,
        );
        activityStore.addEvent({
          invoiceId: reminder.invoiceId,
          type: "REMINDER_SENT",
          payload: reminder,
        });
      } else {
        remaining.push(reminder);
      }
    });

    if (remaining.length !== reminders.length) {
      writeReminders(remaining);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ReminderQueue] Failed to process reminders", error);
  }
};

setInterval(processReminders, PROCESS_INTERVAL_MS);

module.exports = {
  scheduleReminder,
  scheduleFromInvoice,
  scheduleMilestones: scheduleMilestoneReminders,
  listReminders: readReminders,
  runNow: processReminders,
};
