import { reviewLinkRoute } from "../../../../lib/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/** The review link in F9 (spec part 1, chapter 7): counts the click, then the review page. */
export async function GET(_request: Request, { params }: Context) {
  return reviewLinkRoute((await params).code);
}
