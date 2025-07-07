require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    polygon: {
      url: process.env.POLYGON_RPC,          // e.g. Alchemy / Infura RPC URL
      accounts: [process.env.PRIVATE_KEY],   // Wallet private key
      chainId: 137,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY_V2,  // ✅ New Etherscan v2 API key
  },
};
