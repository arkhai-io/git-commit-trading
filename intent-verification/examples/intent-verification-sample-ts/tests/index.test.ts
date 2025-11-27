import { describe, expect, test } from "bun:test";
import { sum } from "..";

import { verifyIntent } from 'intent-verification-ts'

describe("sum", () => {
  test("adds 1 + 2 to equal 2", () => {
    expect(sum(1, 2)).toBe(3);
  });
});

describe("verifyIntent", () => {
  test("should verify intent with valid parameters", async () => {
    const userIntent = "I want to ensure the tests/index.test.ts works correctly";
    const solutionRepoUrl = "https://github.com/VAR-META-Tech/intent-verification-sample-ts";
    const solutionCommit1 = "2fd75de38547b530ea18cbe86d47c5f7e9817265";
    const solutionCommit2 = "76142ad34176aafdff119306c72ef0b700009905";
    const testRepoUrl = "https://github.com/VAR-META-Tech/intent-verification-sample-ts";
    const testCommit = "2fd75de38547b530ea18cbe86d47c5f7e9817265";
    const apiKey = process.env.OPENAI_API_KEY || "";

    if (!apiKey) {
      throw new Error("API_KEY environment variable is required");
    }

    const result = await verifyIntent(
      testRepoUrl,
      testCommit,
      solutionRepoUrl,
      solutionCommit1,
      solutionCommit2,
      userIntent,
      apiKey
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  }, 60000); // 60 second timeout for API calls
});

