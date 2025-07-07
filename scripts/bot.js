require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`👤 Deployer: ${deployer.address}`);
  const CONTRACT_ADDRESS = "0x34daE80a5C9Eefc2464E925Ea3b255819C291211"; // তোমার কন্ট্রাক্ট
  const FLASHLOAN_AMOUNT = "1"; // FlashLoan amount: 1 USDC

  // ✅ Get deployed contract
  const contract = await ethers.getContractAt(
    "UltraArbitrageFlashLoanBotUpgradeable",
    CONTRACT_ADDRESS
  );

  // ✅ Get tokenA (USDC-like) info
  const tokenA = await contract.tokenA();
  const usdc = await ethers.getContractAt("IERC20Metadata", tokenA);
  const tokenName = await usdc.name();
  const tokenSymbol = await usdc.symbol();
  const tokenDecimals = await usdc.decimals();

  console.log(`🪙 Token: ${tokenName} (${tokenSymbol})`);
  console.log(`🔢 Decimals: ${tokenDecimals}`);
  console.log(`🔗 tokenA Address: ${tokenA}`);

  const amount = ethers.parseUnits(FLASHLOAN_AMOUNT, tokenDecimals);
  console.log(`🔁 Preparing FlashLoan for ${ethers.formatUnits(amount, tokenDecimals)} ${tokenSymbol}`);
  console.log(`📍 Using FlashLoanBot at: ${CONTRACT_ADDRESS}`);

  // ✅ Check current balance of tokenA in the contract
  const tokenABalanceHex = await ethers.provider.send("eth_call", [{
    to: tokenA,
    data: "0x70a08231000000000000000000000000" + CONTRACT_ADDRESS.slice(2)
  }, "latest"]);

  const tokenABalance = ethers.formatUnits(ethers.BigNumber.from(tokenABalanceHex), tokenDecimals);
  console.log(`📦 Contract Balance: ${tokenABalance} ${tokenSymbol}`);

  // ✅ Try executing FlashLoan
  try {
    const tx = await contract.requestFlashLoan(amount);
    console.log(`📤 TX Sent. Waiting... Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ TX Confirmed in block: ${receipt.blockNumber}`);
    console.log(`📈 Gas Used: ${receipt.gasUsed.toString()}`);
  } catch (err) {
    console.error(`❌ FlashLoan Failed!`);

    if (err.error && err.error.message) {
      console.error(`❗ Revert Reason: ${err.error.message}`);
    } else if (err.reason) {
      console.error(`❗ Reason: ${err.reason}`);
    } else if (err.code === "UNPREDICTABLE_GAS_LIMIT") {
      console.error("⚠️ Unpredictable gas limit - Possibly due to revert inside logic.");
    } else if (err.message && err.message.includes("transfer amount exceeds balance")) {
      console.error("💥 Transfer failed: Not enough balance to repay Aave flashloan.");
    } else {
      console.error("❓ Unknown Error:", err);
    }
  }

  console.log("🔚 Bot execution finished.");
}

main().catch((error) => {
  console.error("🚨 Unexpected Fatal Error in main():", error);
  process.exitCode = 1;
});
