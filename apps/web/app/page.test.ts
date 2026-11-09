import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the app name in Swedish", () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).toContain("<h1>Bojen</h1>");
  });
});
