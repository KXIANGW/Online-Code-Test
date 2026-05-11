import { describe, expect, it } from "vitest";
import { checkOutput } from "./checker";

describe("checkOutput", () => {
  it("accepts equivalent trailing whitespace and newline differences", () => {
    expect(checkOutput("1 2  \r\n3\n\n", "1 2\n3")).toEqual({ verdict: "AC" });
  });

  it("returns WA with diff when content differs", () => {
    expect(checkOutput("41\n", "42\n")).toMatchObject({
      verdict: "WA",
      diff: 'Line 1: expected "42", got "41"',
    });
  });
});
