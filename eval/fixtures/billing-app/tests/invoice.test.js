import { createInvoice, sendInvoice } from "../src/billing/invoice.js";
import { clearDuplicateCache } from "../src/billing/duplicate.js";

export async function testCreateInvoice() {
  clearDuplicateCache();
  const inv = createInvoice("c1", 10);
  if (!inv.id) throw new Error("missing id");
  await sendInvoice(inv);
}
