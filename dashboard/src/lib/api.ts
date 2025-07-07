export type MarketData = {
  volume: number;
  volatility: number;
};

export async function getMarketData(): Promise<MarketData> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/coins/polygon");
    const data = await res.json();

    const volume = Math.round(data.market_data.total_volume.usd);
    const volatility = Math.abs(data.market_data.price_change_percentage_24h.toFixed(2));

    return {
      volume,
      volatility,
    };
  } catch (e) {
    console.error("❌ Market data fetch error:", (e as Error).message);
    return { volume: 0, volatility: 0 };
  }
}
