import type { Turn } from "@copilot-cost-analyzer/domain";

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    index: 1,
    userMessage: "hi",
    assistantResponse: "hello",
    toolCalls: [],
    usage: {
      uncachedInput: { known: true, value: 100 },
      cacheWrite: { known: true, value: 200 },
      cacheRead: { known: true, value: 300 },
      tool: { known: true, value: 0 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 10 },
      output: { known: true, value: 20 },
      costAiCredits: { known: true, value: 0.01 },
      model: "example-model",
      roundsCount: 3,
    },
    explanation: "explanation text",
    ...overrides,
  };
}
