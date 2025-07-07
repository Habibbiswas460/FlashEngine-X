// lib/aiEngine.ts

export type MarketData = {
  volume: number;
  volatility: number;
};

export type AIRecommendation = {
  signal: "strong" | "neutral" | "weak";
  reason: string;
};

export function getAIRecommendation({ volume, volatility }: MarketData): AIRecommendation {
  if (volume > 100_000_000 && volatility > 5) {
    return { signal: "strong", reason: "High Volume & Volatility" };
  } else if (volume > 50_000_000) {
    return { signal: "neutral", reason: "Medium Volume, Watch Carefully" };
  } else {
    return { signal: "weak", reason: "Low Volume Market" };
  }
}
