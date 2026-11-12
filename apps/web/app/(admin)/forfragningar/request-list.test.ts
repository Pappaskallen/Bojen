import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestList } from "./request-list";

describe("RequestList", () => {
  it("shows each request with approve and reject", () => {
    const html = renderToStaticMarkup(
      createElement(RequestList, {
        requests: [
          {
            visitId: "v1",
            start: "2027-10-20T06:00:00.000Z",
            end: "2027-10-20T08:00:00.000Z",
            customerName: "Per Ny",
            service: "Vinterkonservering",
            boat: "Solvik – Nimbus 305",
            notes: "Nyckeln i boden.",
            photos: 2,
          },
        ],
      }),
    );
    expect(html).toContain("Per Ny – Vinterkonservering");
    expect(html).toContain("onsdag 20 oktober kl. 08:00");
    expect(html).toContain("2 bilder");
    expect(html).toContain(">Godkänn<");
    expect(html).toContain(">Avböj<");
  });

  it("says when there is nothing to approve", () => {
    expect(renderToStaticMarkup(createElement(RequestList, { requests: [] }))).toContain(
      "Inga förfrågningar just nu.",
    );
  });
});
