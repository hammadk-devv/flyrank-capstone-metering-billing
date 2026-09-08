import { describe, expect, it } from "vitest";
import { calculateAiCost } from "../src/services/cost.service.js";

describe("calculateAiCost", () => {
  it("calculates cached input and reasoning correctly", () => {
    const result = calculateAiCost({
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 500,
      reasoningTokens: 100,
    });

    expect(result.inputCostMicroUnits).toBe(8400);
    expect(result.outputCostMicroUnits).toBe(18000);
    expect(result.totalCostMicroUnits).toBe(26400);
  });

  it("charges cached input at the cheaper rate", () => {
    const result = calculateAiCost({
      inputTokens: 1000,
      cachedInputTokens: 1000,
      outputTokens: 0,
      reasoningTokens: 0,
    });

    expect(result.totalCostMicroUnits).toBe(2000);
  });

  it("counts reasoning tokens as output cost", () => {
    const result = calculateAiCost({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 500,
      reasoningTokens: 100,
    });

    expect(result.totalCostMicroUnits).toBe(18000);
  });

  it("rejects cached tokens greater than input tokens", () => {
    expect(() =>
      calculateAiCost({
        inputTokens: 100,
        cachedInputTokens: 101,
        outputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toThrow("Cached input tokens cannot exceed input tokens");
  });

  it("rejects negative token counts", () => {
    expect(() =>
      calculateAiCost({
        inputTokens: -1,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toThrow("Token counts cannot be negative");
  });
});