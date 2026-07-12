/**
 * Account provisioning — should not be driven from billing long-term.
 */
export async function provisionAccount(customerId) {
  return {
    customerId,
    provisionedAt: new Date().toISOString(),
    plan: "standard",
  };
}

export function isAccountActive(account) {
  return Boolean(account?.customerId);
}
