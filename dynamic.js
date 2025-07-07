// 📂 FlashEngineX-Dynamic.js
const { ethers } = require("ethers");
require("dotenv").config();

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const contractAbi = [
  "function requestFlashLoan(uint256 amount) external",
  "function setActivePairIndex(uint index) external",
  "function simulateFlashLoan(uint256 amount) public view returns (int256)"
];
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, wallet);

const POLL_INTERVAL = 60 * 1000; // প্রতি ৬০ সেকেন্ডে একবার
const AMOUNT = ethers.parseUnits("10", 18); // ১০ টোকেন
const MAX_RETRIES = 1;
const MAX_GAS_PER_TX = ethers.parseUnits("0.02", "gwei") * 200000n; // প্রাথমিক ধারণা
const DAILY_MATIC_LIMIT = ethers.parseUnits("10", 18);
let dailySpent = ethers.parseUnits("0", 18);

let pairs = [
  { name: "WMATIC/USDC", index: 0, score: 0 },
  { name: "WMATIC/DAI", index: 1, score: 0 },
  { name: "WMATIC/TETU", index: 2, score: 0 },
  { name: "WMATIC/QUICK", index: 3, score: 0 },
];

function updateScore(pairIndex, success) {
  pairs[pairIndex].score += success ? 2 : -1;
  if (pairs[pairIndex].score < 0) pairs[pairIndex].score = 0;
  pairs.sort((a, b) => b.score - a.score);
}

async function bumpedGasRetry(txRequest, pair, nonce) {
  try {
    const bumped = await provider.getFeeData();
    const tx = await wallet.sendTransaction({
      ...txRequest,
      nonce,
      maxFeePerGas: bumped.maxFeePerGas * 2n,
      maxPriorityFeePerGas: bumped.maxPriorityFeePerGas * 2n,
    });
    console.log(`\u{1F680} Retried TX for ${pair.name}: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      console.log(`✅ Retry SUCCESS on ${pair.name}`);
      updateScore(pair.index, true);
    } else {
      console.log(`❌ Retry FAILED on ${pair.name}`);
      updateScore(pair.index, false);
    }
  } catch (e) {
    console.error(`[Retry ERROR: ${pair.name}]`, e.message);
    updateScore(pair.index, false);
  }
}

async function tryFlashLoan(pair) {
  let txRequest, nonce;
  try {
    // Step 1: Set pair
    await contract.setActivePairIndex(pair.index);

    // Step 2: Simulate profit
    const profit = await contract.simulateFlashLoan(AMOUNT);
    if (profit <= 0) {
      console.log(`⏩ Skipping ${pair.name} - No Profit`);
      return;
    }

    // Step 3: Gas estimation & balance check
    const feeData = await provider.getFeeData();
    const estimatedGas = MAX_GAS_PER_TX;
    const estimatedCost = feeData.maxFeePerGas * estimatedGas;

    if (estimatedCost + dailySpent > DAILY_MATIC_LIMIT) {
      console.warn("⛔ Daily MATIC limit exceeded.");
      return;
    }

    // Step 4: Prepare TX
    txRequest = await contract.requestFlashLoan.populateTransaction(AMOUNT);
    nonce = await provider.getTransactionCount(wallet.address, "latest");

    const tx = await wallet.sendTransaction({
      ...txRequest,
      nonce,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    });

    console.log(`⏳ TX Sent for ${pair.name}: ${tx.hash}`);
    dailySpent += estimatedCost;

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      console.log(`✅ SUCCESS on ${pair.name}`);
      updateScore(pair.index, true);
    } else {
      console.log(`⚠️ TX Failed.`);
      updateScore(pair.index, false);
    }

  } catch (err) {
    if (err.message?.includes("could not replace existing tx")) {
      console.warn(`🚫 Replace Failed on ${pair.name}`);
      updateScore(pair.index, false);
    } else if (err.message?.includes("replacement fee too low")) {
      console.warn(`⏳ Retry due to low gas on ${pair.name}`);
      if (txRequest && nonce !== undefined) {
        await bumpedGasRetry(txRequest, pair, nonce);
      }
    } else {
      console.error(`[ERROR: ${pair.name}]`, err.message);
      updateScore(pair.index, false);
    }
  }
}

async function main() {
  console.log("🤖 FlashEngineX-Dynamic Started...");
  setInterval(async () => {
    const topPairs = pairs.slice(0, 2); // Top 2
    for (let pair of topPairs) {
      await tryFlashLoan(pair);
    }
  }, POLL_INTERVAL);
}

main();
