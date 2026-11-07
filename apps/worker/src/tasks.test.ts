import { describe, expect, it } from "vitest";
import { tasks } from "./tasks";

describe("worker task registry", () => {
  it("is empty until the first task is added", () => {
    expect(Object.keys(tasks)).toEqual([]);
  });
});
