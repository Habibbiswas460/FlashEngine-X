const { ethers } = require("ethers");
require("dotenv").config();
const fs = require("fs");

// === CONFIGURABLE PARAMETERS ===
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x09F2625Cbb1534f33F350705b4Dc36c0aE853536";
const POLL_INTERVAL = 30 * 1000;
const DEX_ROUTERS = [
  { name: "Quickswap", address: process.env.QUICKSWAP_ROUTER },
  { name: "Sushiswap", address: process.env.SUSHISWAP_ROUTER }
];
const TOKEN_PAIRS = [
  { base: process.env.WMATIC, quote: process.env.USDC, decimals: 18 }
  // চাইলে এখানে আরও পেয়ার যোগ করুন
];
const MIN_PROFIT = ethers.parseUnits("0.000001", 18);
const SWAP_FEE = 0.003; // 0.3% per swap

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const contractAbi = [
  "function requestFlashLoan(uint256 amount) external"
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, wallet);
const routers = DEX_ROUTERS.map(dex => ({
  ...dex,
  contract: new ethers.Contract(dex.address, routerAbi, provider)
}));

function log(msg) {
  console.log(msg);
  fs.appendFileSync("arbitrage_log.txt", `[${new Date().toISOString()}] ${msg}\n`);
}

async function getGasCost() {
  try {
    const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits("50", "gwei");
    // আনুমানিক 400k গ্যাস ধরে
    return gasPrice * 400000n;
  } catch {
    return ethers.parseUnits("0.01", 18);
  }
}

async function getArbOpportunities() {
  let opportunities = [];
  for (const pair of TOKEN_PAIRS) {
    for (let i = 0; i < routers.length; i++) {
      for (let j = 0; j < routers.length; j++) {
        if (i === j) continue;
        const routerA = routers[i];
        const routerB = routers[j];
        try {
          const amountIn = ethers.parseUnits("10", pair.decimals); // চাইলে randomize করতে পারেন
          const amountsOutA = await routerA.contract.getAmountsOut(amountIn, [pair.base, pair.quote]);
          const amountsOutB = await routerB.contract.getAmountsOut(amountsOutA[1], [pair.quote, pair.base]);
          const finalAmount = amountsOutB[1];
          const grossProfit = finalAmount - amountIn;
          const totalSwapFee = BigInt(amountIn * BigInt(Math.floor(SWAP_FEE * 1e6)) / BigInt(1e6) * 2n);
          const gasCost = await getGasCost();
          const netProfit = grossProfit - totalSwapFee - gasCost;
          if (netProfit > MIN_PROFIT) {
            opportunities.push({
              from: routerA.name,
              to: routerB.name,
              pair: `${pair.base}/${pair.quote}`,
              amountIn: ethers.formatUnits(amountIn, pair.decimals),
              netProfit: ethers.formatUnits(netProfit, pair.decimals),
              amount: amountIn
            });
          }
        } catch (err) {
          log(`⚠️ Error fetching DEX prices: ${err.reason || err}`);
        }
      }
    }
  }
  return opportunities;
}

async function tryArbitrage() {
  try {
    const ops = await getArbOpportunities();
    if (!ops.length) {
      log(`[${new Date().toLocaleTimeString()}] 🔍 No arbitrage opportunity`);
      return;
    }
    for (const op of ops) {
      log(`[${new Date().toLocaleTimeString()}] 🚀 ${op.from}→${op.to} | ${op.pair} | Amount: ${op.amountIn} | Net Profit: ${op.netProfit}`);
      try {
        const tx = await contract.requestFlashLoan(op.amount);
        log(`⏳ TX sent: ${tx.hash}`);
        const receipt = await tx.wait();
        if (receipt.status === 1) {
          log(`✅ SUCCESS! Block: ${receipt.blockNumber}`);
        } else {
          log(`⚠️ TX failed.`);
        }
      } catch (error) {
        log(`[ERROR] ${error.message || error}`);
      }
    }
  } catch (error) {
    log(`[FATAL ERROR] ${error.message || error}`);
  }
}

async function main() {
  log("🔁 Ultra Arbitrage Bot started. Monitoring 24/7...");
  setInterval(() => tryArbitrage(), POLL_INTERVAL);
}

async function getArbOpportunities() {
  let opportunities = [];
  for (const pair of TOKEN_PAIRS) {
    for (let i = 0; i < routers.length; i++) {
      for (let j = 0; j < routers.length; j++) {
        if (i === j) continue;
        const routerA = routers[i];
        const routerB = routers[j];
        try {
          const amountIn = ethers.parseUnits("10", pair.decimals); // চাইলে randomize করতে পারেন
          const amountsOutA = await routerA.contract.getAmountsOut(amountIn, [pair.base, pair.quote]);
          const amountsOutB = await routerB.contract.getAmountsOut(amountsOutA[1], [pair.quote, pair.base]);
          const finalAmount = amountsOutB[1];

          // === Show live price info ===
          log(
            `[${new Date().toLocaleTimeString()}] 💹 ${routerA.name}: ${ethers.formatUnits(amountIn, pair.decimals)} ${pair.base} → ${ethers.formatUnits(amountsOutA[1], pair.decimals)} ${pair.quote} | `
            + `${routerB.name}: ${ethers.formatUnits(amountsOutA[1], pair.decimals)} ${pair.quote} → ${ethers.formatUnits(finalAmount, pair.decimals)} ${pair.base}`
          );

          const grossProfit = finalAmount - amountIn;
          const totalSwapFee = BigInt(amountIn * BigInt(Math.floor(SWAP_FEE * 1e6)) / BigInt(1e6) * 2n);
          const gasCost = await getGasCost();
          const netProfit = grossProfit - totalSwapFee - gasCost;
          if (netProfit > MIN_PROFIT) {
            opportunities.push({
              from: routerA.name,
              to: routerB.name,
              pair: `${pair.base}/${pair.quote}`,
              amountIn: ethers.formatUnits(amountIn, pair.decimals),
              netProfit: ethers.formatUnits(netProfit, pair.decimals),
              amount: amountIn
            });
          }
        } catch (err) {
          log(`⚠️ Error fetching DEX prices: ${err.reason || err}`);
        }
      }
    }
  }
  return opportunities;
}

main();