"use client";

import { useEffect, useState } from "react";
import { getMarketData } from "@/lib/api";
import { getAIRecommendation } from "@/lib/aiEngine";

export default function Dashboard() {
  const [aiInsight, setAiInsight] = useState("Loading...");
  const [volume, setVolume] = useState<number | null>(null);
  const [volatility, setVolatility] = useState<number | null>(null);

  const fetchAIInsight = async () => {
    const { volume, volatility } = await getMarketData();
    setVolume(volume);
    setVolatility(volatility);

    const { signal, reason } = getAIRecommendation({ volume, volatility });
    const insight =
      signal === "strong"
        ? `✅ Recommended - ${reason}`
        : signal === "neutral"
        ? `⚠️ Moderate - ${reason}`
        : `🚫 Not Recommended - ${reason}`;
    setAiInsight(insight);
  };

  useEffect(() => {
    fetchAIInsight();
  }, []);

  return (
    <div className="p-4 text-white text-xl space-y-4">
      <div>⚡ Welcome to FlashEngineX Dashboard</div>
      <div>📈 Volume: {volume !== null ? `$${volume.toLocaleString()}` : "Loading..."}</div>
      <div>🌪 Volatility: {volatility !== null ? `${volatility}%` : "Loading..."}</div>
      <div>🧠 AI Insight: {aiInsight}</div>
    </div>
  );
}
