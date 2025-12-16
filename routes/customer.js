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
const Joi = require("joi");
const { customersApi, locationsApi } = require("../util/square-client");
const giftCardCache = require("../util/gift-card-cache");

const router = express.Router();

const customerSchema = Joi.object({
  givenName: Joi.string().trim().max(100).required(),
  familyName: Joi.string().trim().max(100).allow(""),
  emailAddress: Joi.string().trim().email().allow(""),
  phoneNumber: Joi.string().trim().max(20).allow(""),
  companyName: Joi.string().trim().max(120).allow(""),
  note: Joi.string().trim().max(500).allow(""),
  addressLine1: Joi.string().trim().max(200).allow(""),
  addressLine2: Joi.string().trim().max(200).allow(""),
  locality: Joi.string().trim().max(120).allow(""),
  administrativeDistrictLevel1: Joi.string().trim().max(100).allow(""),
  postalCode: Joi.string().trim().max(30).allow(""),
  country: Joi.string().trim().uppercase().length(2).default("US"),
});

router.get("/", async (req, res, next) => {
  try {
    const {
      result: { location },
    } = await locationsApi.retrieveLocation("main");
    const {
      result: { customers = [] },
    } = await customersApi.listCustomers();
    const customersWithEmail = customers.filter(
      (customer) => customer.emailAddress,
    );
    const displayCustomers =
      customersWithEmail.length > 0 ? customersWithEmail : customers;
    const customersWithCards = displayCustomers.filter(
      (customer) => customer.cards && customer.cards.length,
    );
    const env =
      (
        process.env.SQUARE_ENVIRONMENT ||
        process.env.NODE_ENV ||
        "sandbox"
      ).toLowerCase() === "production"
        ? { label: "Live", tone: "live" }
        : { label: "Testing", tone: "testing" };
    const cardSnapshots = giftCardCache.listCards();
    const customerGiftCards = {};
    cardSnapshots.forEach((card) => {
      const customerIds = card.customerIds || [];
      customerIds.forEach((id) => {
        if (!id) return;
        if (!customerGiftCards[id]) {
          customerGiftCards[id] = [];
        }
        customerGiftCards[id].push({
          id: card.id,
          gan: card.gan,
          state: card.state,
          balance: card.balance,
          updatedAt: card.cachedAt,
        });
      });
    });
    Object.values(customerGiftCards).forEach((cards) =>
      cards.sort((a, b) => {
        const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bTime - aTime;
      }),
    );

    res.render("customer-hub", {
      customers: displayCustomers,
      totalCustomers: displayCustomers.length,
      cardCustomers: customersWithCards.length,
      manualCustomers: displayCustomers.length - customersWithCards.length,
      envStatus: env,
      locationId: location.id,
      customerGiftCards,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/new", (req, res) => {
  res.render("customer-new");
});

router.post("/", async (req, res, next) => {
  let payload;
  try {
    payload = await customerSchema.validateAsync(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
  } catch (error) {
    error.status = 400;
    return next(error);
  }

  try {
    const requestBody = {
      givenName: payload.givenName,
      familyName: payload.familyName || undefined,
      emailAddress: payload.emailAddress || undefined,
      phoneNumber: payload.phoneNumber || undefined,
      companyName: payload.companyName || undefined,
      note: payload.note || undefined,
      address:
        payload.addressLine1 ||
        payload.addressLine2 ||
        payload.locality ||
        payload.administrativeDistrictLevel1 ||
        payload.postalCode
          ? {
              addressLine1: payload.addressLine1 || undefined,
              addressLine2: payload.addressLine2 || undefined,
              locality: payload.locality || undefined,
              administrativeDistrictLevel1:
                payload.administrativeDistrictLevel1 || undefined,
              postalCode: payload.postalCode || undefined,
              country: payload.country,
            }
          : undefined,
    };

    const {
      result: { customer },
    } = await customersApi.createCustomer(requestBody);

    res.redirect(`/?newCustomer=${customer?.id}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
