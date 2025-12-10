const fs = require("fs");
const path = require("path");

const DEFAULT_SERVICES = [
  {
    id: "roof-inspection",
    name: "Roof Inspection",
    priceAmount: 7500,
    currency: "USD",
    description:
      "Comprehensive roof inspection with thermal imaging and moisture detection.",
    category: "Inspection",
    paymentMethods: {
      card: true,
      bankAccount: false,
      squareGiftCard: true,
      cashAppPay: true,
    },
  },
  {
    id: "roof-cleaning-premium",
    name: "Roof Cleaning (2000–2500 sqft)",
    priceAmount: 37500,
    currency: "USD",
    description:
      "Soft wash cleaning for medium-size roofs, includes moss treatment.",
    category: "Cleaning",
    paymentMethods: {
      card: true,
      bankAccount: false,
      squareGiftCard: false,
      cashAppPay: false,
    },
  },
  {
    id: "gutter-cleaning",
    name: "Gutter Cleaning & Flush",
    priceAmount: 12000,
    currency: "USD",
    description: "Full debris removal, downspout flush, and seal inspection.",
    category: "Cleaning",
    paymentMethods: {
      card: true,
      bankAccount: true,
      squareGiftCard: false,
      cashAppPay: true,
    },
  },
];

const servicesFile =
  process.env.SERVICES_CONFIG_PATH || path.join(__dirname, "services.json");

const loadServicesFromFile = () => {
  try {
    if (fs.existsSync(servicesFile)) {
      const fileData = fs.readFileSync(servicesFile, "utf-8");
      const parsed = JSON.parse(fileData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `Unable to read services config at ${servicesFile}: ${error.message}`,
    );
  }

  return DEFAULT_SERVICES;
};

const SERVICES = loadServicesFromFile();

module.exports = {
  services: SERVICES,
  findByCategory: (category) => {
    if (!category) return SERVICES;
    const normalized = category.toLowerCase();
    return SERVICES.filter(
      (service) => (service.category || "").toLowerCase() === normalized,
    );
  },
  search: (term) => {
    if (!term) return SERVICES;
    const normalized = term.toLowerCase();
    return SERVICES.filter(
      (service) =>
        service.name.toLowerCase().includes(normalized) ||
        (service.description &&
          service.description.toLowerCase().includes(normalized)),
    );
  },
};
