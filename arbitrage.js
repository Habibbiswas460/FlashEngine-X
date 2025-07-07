const { ethers } = require("ethers");
require("dotenv").config();
const { NonceManager } = require("@ethersproject/experimental");

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Wallet + Nonce Manager
const baseWallet = new ethers.Wallet(preocss.env.PRIVATE_KEY. provider);
const wallet = new NonceManager(baseWallet);

const contractAbi = [
  "function requestFlashLoan(uint256 amount) external",
  "function setActivePairIndex(uint index) external"
];
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, wallet);

const POLL_INTERVAL = 30 * 1000;
const AMOUNT = ethers.parseUnits("10", 18);

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

async function tryFlashLoan(pair) {
  let txRequest;

  try {
    await contract.setActivePairIndex(pair.index);

    const feeData = await provider.getFeeData();
    txRequest = await contract.requestFlashLoan.populateTransaction(AMOUNT);

    const tx = await wallet.sendTransaction({
      ...txRequest,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      maxFeePerGas: feeData.maxFeePerGas
    });

    console.log(`⏳ [${pair.name}] TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`✅ SUCCESS on ${pair.name} | Block: ${receipt.blockNumber}`);
      updateScore(pair.index, true);
    } else {
      console.log("⚠️ TX Failed.");
      updateScore(pair.index, false);
    }

  } catch (err) {
    if (err.code === 'UNKNOWN_ERROR' && err?.error?.message?.includes("could not replace existing tx")) {
      console.warn(`🚫 Replace Failed on ${pair.name} (Tx Pending Too Long or Already Mined)`);
      updateScore(pair.index, false);
      return;
    }

    if (err.code === "CALL_EXCEPTION" || err.message?.includes("replacement fee too low")) {
      console.warn(`⏳ Gas too low. Retrying with bumped gas for ${pair.name}`);
      if (txRequest) {
        await bumpedGasRetry(txRequest, pair);
      } else {
        console.error(`❌ txRequest undefined during retry.`);
        updateScore(pair.index, false);
      }
      return;
    }

    if (err.code === "TRANSACTION_REPLACED" && err.replacement) {
      const replacedTx = err.replacement;
      const receipt = await replacedTx.wait();
      if (receipt.status === 1) {
        console.log(`🔁 Replaced TX SUCCESS: ${replacedTx.hash}`);
        updateScore(pair.index, true);
      } else {
        console.log(`🔁 Replaced TX FAILED: ${replacedTx.hash}`);
        updateScore(pair.index, false);
      }
      return;
    }

    console.error(`[ERROR: ${pair.name}]`, err.reason || err.message || err);
    updateScore(pair.index, false);
  }
}

async function bumpedGasRetry(txRequest, pair) {
  try {
    const feeData = await provider.getFeeData();

    const tx = await wallet.sendTransaction({
      ...txRequest,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n,
      maxFeePerGas: feeData.maxFeePerGas * 2n
    });

    console.log(`🚀 [${pair.name}] Retried TX: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`✅ Retry SUCCESS on ${pair.name} | Block: ${receipt.blockNumber}`);
      updateScore(pair.index, true);
    } else {
      console.log("⚠️ Retry Failed.");
      updateScore(pair.index, false);
    }

  } catch (err) {
    console.error(`[RETRY ERROR: ${pair.name}]`, err.reason || err.message || err);
    updateScore(pair.index, false);
  }
}

async function main() {
  console.log("🤖 AI Pair Arbitrage Bot Started...");

  setInterval(async () => {
    for (const pair of pairs) {
      await tryFlashLoan(pair);
    }
  }, POLL_INTERVAL);
}

main();
