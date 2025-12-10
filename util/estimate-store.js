const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../data/estimates.json");

const ensureDataFile = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf-8");
  }
};

const loadEstimates = () => {
  ensureDataFile();
  const fileContents = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(fileContents);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to parse estimates file: ${error.message}`);
  }

  return [];
};

const saveEstimates = (estimates) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(estimates, null, 2));
};

const createEstimate = (estimate) => {
  const estimates = loadEstimates();
  const newEstimate = {
    ...estimate,
    id: crypto.randomUUID(),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  estimates.push(newEstimate);
  saveEstimates(estimates);
  return newEstimate;
};

const listByCustomer = (customerId) => {
  const estimates = loadEstimates();
  return estimates.filter((estimate) => estimate.customerId === customerId);
};

const getEstimate = (estimateId) => {
  const estimates = loadEstimates();
  return estimates.find((estimate) => estimate.id === estimateId);
};

const updateEstimate = (estimateId, updates) => {
  const estimates = loadEstimates();
  const index = estimates.findIndex((estimate) => estimate.id === estimateId);
  if (index === -1) {
    return null;
  }
  estimates[index] = {
    ...estimates[index],
    ...updates,
  };
  saveEstimates(estimates);
  return estimates[index];
};

module.exports = {
  createEstimate,
  listByCustomer,
  getEstimate,
  updateEstimate,
};
