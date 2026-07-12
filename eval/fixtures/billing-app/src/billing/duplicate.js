const seen = new Map();

/**
 * Detect if this invoice was already created for the same customer+amount window.
 * Related to "users receive duplicate invoices".
 */
export function detectDuplicateInvoice(invoice) {
  const key = `${invoice.customerId}:${invoice.amount}`;
  if (seen.has(key)) return true;
  seen.set(key, Date.now());
  return false;
}

export function clearDuplicateCache() {
  seen.clear();
}
