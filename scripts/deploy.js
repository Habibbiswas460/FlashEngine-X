require("dotenv").config();
const { ethers, upgrades } = require("hardhat");

async function main() {
  const FlashLoanBot = await ethers.getContractFactory("UltraArbitrageFlashLoanBotUpgradeable");

  const contract = await upgrades.deployProxy(
    FlashLoanBot,
    [
      process.env.AAVE_PROVIDER,
      process.env.TOKEN_A,
      process.env.TOKEN_B,
      process.env.DEX1,
      process.env.DEX2
    ],
    { initializer: "initialize" }
  );

  await contract.waitForDeployment();
  console.log(`✅ Contract deployed at: ${contract.target}`);
}

main().catch((error) => {
  console.error("❌ Deployment error:", error);
  process.exitCode = 1;
});
