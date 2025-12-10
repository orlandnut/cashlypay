/* eslint-env jest */

require("dotenv").config({ path: ".env.test" });

// Mock Square client
jest.mock("square", () => ({
  Client: jest.fn(() => ({
    customersApi: {
      createCustomer: jest.fn(),
      listCustomers: jest.fn(),
      deleteCustomer: jest.fn(),
    },
    invoicesApi: {
      createInvoice: jest.fn(),
      getInvoice: jest.fn(),
      listInvoices: jest.fn(),
    },
  })),
}));
