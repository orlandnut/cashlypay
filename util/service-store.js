const db = require("./db");
require("./catalog-store");

const toRow = (row) =>
  row && {
    id: row.id,
    name: row.name,
    priceAmount: row.price_amount,
    currency: row.currency,
    description: row.description,
    category: row.category,
    paymentMethods: {
      card: !!row.allow_card,
      bankAccount: !!row.allow_bank,
      squareGiftCard: !!row.allow_gift_card,
      cashAppPay: !!row.allow_cash_app,
    },
    breakdown: row.breakdown ? JSON.parse(row.breakdown) : [],
  };

const list = () => {
  const rows = db.prepare("SELECT * FROM services ORDER BY name ASC").all();
  return rows.map(toRow);
};

const findById = (id) => {
  const row = db.prepare("SELECT * FROM services WHERE id = ?").get(id);
  return toRow(row);
};

const findByCategory = (category) => {
  if (!category) return list();
  const rows = db
    .prepare("SELECT * FROM services WHERE category = ?")
    .all(category);
  return rows.map(toRow);
};

const search = (term) => {
  if (!term) return list();
  const rows = db
    .prepare(
      "SELECT * FROM services WHERE name LIKE ? OR description LIKE ? ORDER BY name ASC",
    )
    .all(`%${term}%`, `%${term}%`);
  return rows.map(toRow);
};

module.exports = {
  list,
  findById,
  findByCategory,
  search,
};
