const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../data/subscriptions.json");

const ensureFile = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf-8");
  }
};

const load = () => {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to parse subscriptions file: ${error.message}`);
  }
  return [];
};

const save = (subscriptions) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(subscriptions, null, 2));
};

const create = (subscription) => {
  const subscriptions = load();
  const newSub = {
    ...subscription,
    id: crypto.randomUUID(),
    status: "scheduled",
    createdAt: new Date().toISOString(),
  };
  subscriptions.push(newSub);
  save(subscriptions);
  return newSub;
};

const listByCustomer = (customerId) => {
  const subscriptions = load();
  return subscriptions.filter(
    (subscription) => subscription.customerId === customerId,
  );
};

const update = (id, updates) => {
  const subscriptions = load();
  const index = subscriptions.findIndex(
    (subscription) => subscription.id === id,
  );
  if (index === -1) return null;
  subscriptions[index] = {
    ...subscriptions[index],
    ...updates,
  };
  save(subscriptions);
  return subscriptions[index];
};

module.exports = {
  create,
  listByCustomer,
  update,
};
