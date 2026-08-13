/**
 * Staging test access — KYB bypass + master-account fallback.
 *
 * Whitelisted login emails (env `KYB_TEST_EMAILS`, comma-separated) are
 * treated as `kyb_verified` and, when their store has no SingaPay sub-account,
 * read balances / settlements against the platform master account
 * (`SINGAPAY_ACCOUNT_ID`). This lets a test operator exercise the full
 * payout/clearing flow on staging without waiting for real SingaPay KYB.
 *
 * Deliberately scoped: the fallback NEVER applies to non-whitelisted stores,
 * so a real merchant without a sub-account can never see or move the
 * platform's master-account money.
 */

export interface TestAccess {
  /** Login emails that bypass KYB and may use the master account. */
  emails: string[];
  /** Platform master account ULID (SINGAPAY_ACCOUNT_ID) — null = no fallback. */
  masterAccountId: string | null;
}

export function resolveTestAccess(env: {
  KYB_TEST_EMAILS?: string;
  SINGAPAY_ACCOUNT_ID?: string;
}): TestAccess {
  return {
    emails: (env.KYB_TEST_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    masterAccountId: env.SINGAPAY_ACCOUNT_ID ?? null,
  };
}

export const EMPTY_TEST_ACCESS: TestAccess = { emails: [], masterAccountId: null };

export function isTestEmail(email: string | undefined, access: TestAccess): boolean {
  return !!email && access.emails.includes(email.toLowerCase());
}
