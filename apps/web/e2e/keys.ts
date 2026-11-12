/**
 * Fixed keys for the end-to-end tests only, shared by the web server (playwright.config.ts)
 * and the specs. Not secrets: they only ever meet the local database.
 */
export const E2E_SHORT_LINK_KEY = "e2e-only-short-link-key-long-enough-1234";
/** 32 bytes, base64. */
export const E2E_LOCAL_KMS_MASTER_KEY = "ZTJlLW9ubHkta21zLW1hc3Rlci1rZXktMzItYnl0ZXM=";
