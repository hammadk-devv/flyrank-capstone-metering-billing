const PRICING = {
  input: 10,
  cachedInput: 2,
  output: 30,
  reasoning: 30,
};

export function calculateAiCost({
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
}) {
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(cachedInputTokens) ||
    !Number.isInteger(outputTokens) ||
    !Number.isInteger(reasoningTokens)
  ) {
    throw new Error("Token counts must be integers");
  }

  if (
    inputTokens < 0 ||
    cachedInputTokens < 0 ||
    outputTokens < 0 ||
    reasoningTokens < 0
  ) {
    throw new Error("Token counts cannot be negative");
  }

  if (cachedInputTokens > inputTokens) {
    throw new Error("Cached input tokens cannot exceed input tokens");
  }

  const freshInputTokens = inputTokens - cachedInputTokens;

  const inputCost =
    freshInputTokens * PRICING.input +
    cachedInputTokens * PRICING.cachedInput;

  const outputCost =
    outputTokens * PRICING.output +
    reasoningTokens * PRICING.reasoning;

  return {
    inputCostMicroUnits: inputCost,
    outputCostMicroUnits: outputCost,
    totalCostMicroUnits: inputCost + outputCost,
  };
}