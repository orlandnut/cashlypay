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
const managementRoute = require("./management");
const invoiceRoute = require("./invoice");
const estimateRoute = require("./estimate");
const subscriptionRoute = require("./subscription");
const customerRoute = require("./customer");
const uploadRoute = require("./uploads");
const adminRoute = require("./admin");
const analyticsRoute = require("./analytics");
const catalogRoute = require("./catalog");
const payoutRoute = require("./payout");
const giftCardRoute = require("./gift-cards");
const {
  customersApi,
  locationsApi,
  invoicesApi,
} = require("../util/square-client");
const reminderQueue = require("../util/reminder-queue");
const payoutStore = require("../util/payout-store");

const router = express.Router();

/**
 * Matches: /management and /invoice respectively.
 *
 * Description:
 *  If the rquest url matches one of the router.use calls, then the routes used are in the
 *  required file.
 */
router.use("/management", managementRoute);
router.use("/invoice", invoiceRoute);
router.use("/estimate", estimateRoute);
router.use("/subscription", subscriptionRoute);
router.use("/customers", customerRoute);
router.use("/uploads", uploadRoute);
router.use("/admin", adminRoute);
router.use("/analytics", analyticsRoute);
router.use("/catalog", catalogRoute);
router.use("/payouts", payoutRoute);
router.use("/gift-cards", giftCardRoute);

/**
 * Matches: GET /
 *
 * Description:
 *  Retrieves list of customers then render the homepage with a list of the customers that has an email.
 */
router.get("/", async (req, res, next) => {
  try {
    // Retrieve the main location which is the very first location merchant has
    const {
      result: { location },
    } = await locationsApi.retrieveLocation("main");

    let overdueInvoiceCount = 0;
    let scheduledInvoiceCount = 0;
    try {
      const {
        result: { invoices: fetchedInvoices = [] },
      } = await invoicesApi.listInvoices(location.id);
      fetchedInvoices.forEach((invoice) => {
        switch (invoice.status) {
          case "OVERDUE":
            overdueInvoiceCount += 1;
            break;
          case "SCHEDULED":
          case "UNPAID":
            scheduledInvoiceCount += 1;
            break;
          default:
            break;
        }
      });
    } catch (invoiceError) {
      // eslint-disable-next-line no-console
      console.warn(
        "[Home] Unable to pull invoice stats for ticker",
        invoiceError.message,
      );
    }
    // Retrieves customers for this current merchant
    let {
      result: { customers },
    } = await customersApi.listCustomers();
    customers = customers || [];
    const customersWithEmail = customers.filter(
      (customer) => customer.emailAddress,
    );
    const displayCustomers =
      customersWithEmail.length > 0 ? customersWithEmail : customers;
    const reminderSnapshots = reminderQueue.listReminders();
    const reminderCount = reminderSnapshots.length;
    const upcomingReminders = reminderSnapshots.filter(
      (item) => item.type === "UPCOMING_DUE",
    ).length;
    const overdueReminders = reminderSnapshots.filter(
      (item) => item.type === "OVERDUE_CHECK",
    ).length;
    const payoutSnapshots = payoutStore.listPayouts();
    const pendingPayouts = payoutSnapshots.filter(
      (payout) => payout.status === "pending" || payout.status === "processing",
    ).length;

    // Render the customer list homepage
    const squareEnv = (
      process.env.SQUARE_ENVIRONMENT ||
      process.env.NODE_ENV ||
      "sandbox"
    ).toLowerCase();
    const envStatus =
      squareEnv === "production"
        ? { label: "Live", tone: "live" }
        : { label: "Testing", tone: "testing" };

    res.render("index", {
      customers: displayCustomers,
      locationId: location.id, // use the main location as the default
      envStatus,
      reminderCount,
      invoiceStats: {
        overdueInvoiceCount,
        scheduledInvoiceCount,
      },
      tickerStats: {
        upcomingReminders,
        overdueReminders,
      },
      payoutStats: {
        total: payoutSnapshots.length,
        pending: pendingPayouts,
        lastRail: payoutSnapshots[0]?.rail || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
