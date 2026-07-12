import { createInvoice, sendInvoice } from "../billing/invoice.js";
import { provisionAccount } from "../accounts/provision.js";

export function registerRoutes(app) {
  app.post("/invoices", async (req, res) => {
    const invoice = createInvoice(req.body.customerId, req.body.amount);
    await sendInvoice(invoice);
    res.json(invoice);
  });

  app.post("/accounts", async (req, res) => {
    const account = await provisionAccount(req.body.customerId);
    res.json(account);
  });
}
