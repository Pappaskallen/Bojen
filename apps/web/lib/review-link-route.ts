import { customerPage } from "@bojen/core/i18n/sv";

export interface ReviewLinkDeps {
  /** The firm's review page for the code, with the click counted, or null. */
  open: (code: string) => Promise<string | null>;
}

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * `GET /r/{code}`, the link in F9's answer to a good score: counts the click (KPI 18) and goes
 * on to the firm's review page. The code is the only key, so the page it leaves from is not
 * told it (no referrer), and nothing is cached.
 */
export function createReviewLinkRoute(deps: ReviewLinkDeps) {
  return async (code: string): Promise<Response> => {
    const url = await deps.open(code);
    if (!url) {
      return new Response(customerPage.errors.review, {
        status: 404,
        headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(null, { status: 302, headers: { ...noStore, Location: url } });
  };
}
