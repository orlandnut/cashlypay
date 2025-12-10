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
const crypto = require("crypto");
const {
  customersApi,
  invoicesApi,
  locationsApi,
} = require("../util/square-client");
const serviceStore = require("../util/service-store");
const estimateStore = require("../util/estimate-store");
const subscriptionStore = require("../util/subscription-store");
const milestoneStore = require("../util/milestone-store");

const router = express.Router();

/**
 * Matches: GET /management/:locationId/:customerId
 *
 * Description:
 *  Renders the invoice management page that:
 *  * display a list of items that the customer can purchase and receive an invoice.
 *  * display a list of all invoices for the selected customer.
 *
 * Query Parameters:
 *  customerId: Id of the selected customer
 *  locationId: Id of the location that the invoices belongs to
 */
router.get("/:locationId/:customerId", async (req, res, next) => {
  // Post request body contains id of item that is going to be purchased
  const { customerId, locationId } = req.params;
  try {
    const [
      {
        result: { customer },
      },
      {
        result: { location },
      },
    ] = await Promise.all([
      customersApi.retrieveCustomer(customerId),
      locationsApi.retrieveLocation(locationId),
    ]);

    const { q, category, invoiceStatus, invoiceSearch } = req.query;
    const allServices = serviceStore.list();
    let serviceItems = [...allServices];

    const normalizedCategory =
      category && category.toLowerCase() !== "all" ? category : null;
    const normalizedInvoiceStatus =
      invoiceStatus && invoiceStatus.toLowerCase() !== "all"
        ? invoiceStatus.toUpperCase()
        : "ALL";
    const normalizedInvoiceSearch = invoiceSearch ? invoiceSearch.trim() : "";

    if (normalizedCategory) {
      serviceItems = serviceStore.findByCategory(category);
    }

    if (q) {
      const keywordFiltered = serviceStore.search(q);
      // When both filters exist, intersect the sets
      if (normalizedCategory) {
        const ids = new Set(serviceItems.map((item) => item.id));
        serviceItems = keywordFiltered.filter((item) => ids.has(item.id));
      } else {
        serviceItems = keywordFiltered;
      }
    }

    // Get all the invoices for this customer.
    // The API support pagination, for simplicity, we retrieve all invoices.
    const {
      result: { invoices },
    } = await invoicesApi.searchInvoices({
      query: {
        filter: {
          locationIds: [locationId],
          customerIds: [customerId],
        },
        sort: {
          field: "INVOICE_SORT_DATE",
        },
      },
    });

    // Helper function to format dates
    const formatDate = (dateString) => {
      if (!dateString) return "No due date";
      const date = new Date(dateString);
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
    };

    const rawInvoices = invoices || [];
    const estimates = estimateStore.listByCustomer(customerId);
    const subscriptions = subscriptionStore.listByCustomer(customerId);
    let filteredInvoices = rawInvoices;
    if (normalizedInvoiceStatus !== "ALL") {
      filteredInvoices = filteredInvoices.filter(
        (invoice) => invoice.status === normalizedInvoiceStatus,
      );
    }

    if (normalizedInvoiceSearch) {
      const term = normalizedInvoiceSearch.toLowerCase();
      filteredInvoices = filteredInvoices.filter((invoice) => {
        const title = invoice.title || "";
        const number = invoice.invoiceNumber || "";
        const customerName = `${invoice.primaryRecipient?.givenName || ""} ${
          invoice.primaryRecipient?.familyName || ""
        }`;
        return (
          title.toLowerCase().includes(term) ||
          number.toLowerCase().includes(term) ||
          customerName.toLowerCase().includes(term.trim())
        );
      });
    }

    const milestonePlans = milestoneStore.listByInvoiceIds(
      filteredInvoices.map((invoice) => invoice.id),
    );

    // Render the invoice management page
    res.render("management", {
      locationId,
      serviceItems,
      customer,
      invoices: filteredInvoices,
      milestonePlans,
      estimates,
      subscriptions,
      idempotencyKey: crypto.randomUUID(),
      formatDate, // Pass the helper function to the template
      serviceFilters: {
        q: q || "",
        category: normalizedCategory || "all",
        totalConfigured: allServices.length,
        categories: [
          "all",
          ...new Set(
            allServices.map((service) => service.category).filter(Boolean),
          ),
        ],
      },
      invoiceFilters: {
        status: normalizedInvoiceStatus,
        search: normalizedInvoiceSearch,
        total: rawInvoices.length,
        statusOptions: [
          "ALL",
          "DRAFT",
          "SCHEDULED",
          "UNPAID",
          "PARTIALLY_PAID",
          "PAID",
          "OVERDUE",
          "CANCELED",
        ],
      },
      recurringFilters: {
        total: subscriptions.length,
      },
      defaultCurrency: location.currency || "USD",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
