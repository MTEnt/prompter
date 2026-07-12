import { detectDuplicateInvoice } from "./duplicate.js";
import { provisionAccount } from "../accounts/provision.js";

/**
 * Create an invoice for a customer.
 */
export function createInvoice(customerId, amount) {
  const invoice = {
    id: `inv_${customerId}_${Date.now()}`,
    customerId,
    amount,
    status: "open",
  };
  return invoice;
}

/**
 * Send invoice email and ensure account exists (coupled intentionally for multi-site task).
 */
export async function sendInvoice(invoice) {
  if (detectDuplicateInvoice(invoice)) {
    throw new Error("duplicate invoice");
  }
  // Architectural coupling: billing calls account provisioning
  await provisionAccount(invoice.customerId);
  invoice.status = "sent";
  return invoice;
}

export function formatInvoiceTotal(invoice) {
  return `$${Number(invoice.amount).toFixed(2)}`;
}
