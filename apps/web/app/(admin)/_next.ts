/** Only paths on this site are followed after sign-in. */
export function safeNext(value: unknown, fallback = "/forfragningar"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}
