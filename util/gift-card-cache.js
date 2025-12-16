const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DATA_PATH = path.join(__dirname, "../data/gift-cards.json");

const state = {
  cards: new Map(),
  discrepancies: [],
  lastReconciledAt: null,
};

const loadState = () => {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return;
    }
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    (parsed.cards || []).forEach((card) => {
      if (card && card.id) {
        state.cards.set(card.id, card);
      }
    });
    state.discrepancies = parsed.discrepancies || [];
    state.lastReconciledAt = parsed.lastReconciledAt || null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[GiftCardCache] Failed to load state", error.message);
  }
};

const persist = () => {
  try {
    const payload = {
      cards: Array.from(state.cards.values()),
      discrepancies: state.discrepancies,
      lastReconciledAt: state.lastReconciledAt,
    };
    fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[GiftCardCache] Failed to persist state", error.message);
  }
};

loadState();

const upsertCard = (card) => {
  if (!card || !card.id) return null;
  const enriched = {
    ...card,
    cachedAt: new Date().toISOString(),
  };
  state.cards.set(card.id, enriched);
  persist();
  return enriched;
};

const getCard = (id) => state.cards.get(id) || null;

const listCards = () => Array.from(state.cards.values());

const recordDiscrepancy = (details) => {
  const entry = {
    id: randomUUID ? randomUUID() : `${Date.now()}`,
    detectedAt: new Date().toISOString(),
    ...details,
  };
  state.discrepancies.unshift(entry);
  state.discrepancies = state.discrepancies.slice(0, 50);
  persist();
  return entry;
};

const listDiscrepancies = (limit = 10) => state.discrepancies.slice(0, limit);

const markReconciled = () => {
  state.lastReconciledAt = new Date().toISOString();
  persist();
};

const getLastReconciledAt = () => state.lastReconciledAt;

module.exports = {
  upsertCard,
  getCard,
  listCards,
  recordDiscrepancy,
  listDiscrepancies,
  markReconciled,
  getLastReconciledAt,
};
