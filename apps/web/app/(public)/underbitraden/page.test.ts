import { legal } from "@bojen/core/i18n/sv";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SubprocessorsPage from "./page";

describe("the list of sub-processors", () => {
  it("names every sub-processor, where it is and what it gets", () => {
    const html = renderToStaticMarkup(createElement(SubprocessorsPage));
    expect(html).toContain("<h1>Underbiträden</h1>");
    for (const row of legal.subprocessors.rows) {
      expect(html).toContain(row.name);
      expect(html).toContain(row.where);
    }
    // Planned ones are marked, so a firm sees what is coming before it is in use.
    expect(html.match(/Tas i bruk senare/g)).toHaveLength(
      legal.subprocessors.rows.filter((r) => r.status === "planned").length,
    );
  });
});
