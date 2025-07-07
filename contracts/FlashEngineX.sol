// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

interface IDexRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external view returns (uint[] memory amounts);
}

contract UltraArbitrageFlashLoanBotUpgradeable is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IPoolAddressesProvider private _provider;
    IPool private _pool;

    address public tokenA;
    address public tokenB;
    address public DEX1;
    address public DEX2;

    struct PairConfig {
        address tokenA;
        address tokenB;
        address DEX1;
        address DEX2;
    }

    PairConfig[] public pairConfigs;
    uint public activePairIndex;

    uint public slippageTolerance;
    uint public minProfit;
    bool public autoWithdrawProfit;
    bool public paused;

    mapping(address => bool) public operators;

    uint public totalArbitrages;
    uint public totalProfit;
    uint public lastExecutionTime;

    event ArbitrageExecuted(uint profit, uint timestamp);
    event ArbitrageFailed(string reason, uint timestamp);
    event FlashLoanRequested(address asset, uint amount);
    event TokensWithdrawn(address token, uint amount, address to);
    event EmergencyETHWithdrawn(uint amount, address to);
    event PairConfigChanged(address tokenA, address tokenB, address DEX1, address DEX2, uint index);
    event Paused(bool status);
    event SwapExecuted(address from, address to, uint inAmt, uint outAmt, uint time);
    event DebugBalance(string message, uint balance);

    function initialize(
        address provider,
        address _tokenA,
        address _tokenB,
        address _DEX1,
        address _DEX2
    ) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        _provider = IPoolAddressesProvider(provider);
        _pool = IPool(_provider.getPool());

        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token");
        require(_DEX1 != address(0) && _DEX2 != address(0), "Invalid DEX");

        tokenA = _tokenA;
        tokenB = _tokenB;
        DEX1 = _DEX1;
        DEX2 = _DEX2;
        slippageTolerance = 2;
        minProfit = 1e16;

        pairConfigs.push(PairConfig(_tokenA, _tokenB, _DEX1, _DEX2));
        activePairIndex = 0;
    }

    modifier onlyEOA() {
        require(msg.sender == tx.origin, "No smart contracts");
        _;
    }

    modifier notPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "Not operator");
        _;
    }

    function executeOperation(address asset, uint256 amount, uint256 premium, address, bytes calldata)
        external nonReentrant notPaused returns (bool)
    {
        require(msg.sender == address(_pool), "Caller must be Aave Pool");
        require(asset == tokenA, "Invalid loan asset");

        emit DebugBalance("Initial tokenA Balance", IERC20Upgradeable(tokenA).balanceOf(address(this)));
        emit DebugBalance("Initial tokenA", IERC20Upgradeable(tokenA).balanceOf(address(this)));


        address[] memory path = new address[](2);
        uint[] memory amounts;

        path[0] = tokenA;
        path[1] = tokenB;
        amounts = IDexRouter(DEX1).getAmountsOut(amount, path);
        emit DebugBalance("Estimated tokenB from DEX1", amounts[1]);

        uint minOut = (amounts[1] * (100 - slippageTolerance)) / 100;

        IERC20Upgradeable(tokenA).safeApprove(DEX1, 0);
        IERC20Upgradeable(tokenA).safeApprove(DEX1, amount);
        amounts = IDexRouter(DEX1).swapExactTokensForTokens(
            amount,
            minOut,
            path,
            address(this),
            block.timestamp
        );
        uint intermediateAmount = amounts[1];
        emit DebugBalance("Received tokenB after DEX1 swap", intermediateAmount);

        require(intermediateAmount >= minOut, "DEX1 swap slippage too high");
        emit SwapExecuted(tokenA, tokenB, amount, intermediateAmount, block.timestamp);

        path[0] = tokenB;
        path[1] = tokenA;
        amounts = IDexRouter(DEX2).getAmountsOut(intermediateAmount, path);
        emit DebugBalance("Estimated tokenA from DEX2", amounts[1]);

        minOut = (amounts[1] * (100 - slippageTolerance)) / 100;

        IERC20Upgradeable(tokenB).safeApprove(DEX2, 0);
        IERC20Upgradeable(tokenB).safeApprove(DEX2, intermediateAmount);
        amounts = IDexRouter(DEX2).swapExactTokensForTokens(
            intermediateAmount,
            minOut,
            path,
            address(this),
            block.timestamp
        );
        uint finalTokenA = amounts[1];
        emit DebugBalance("Received tokenA after DEX2 swap", finalTokenA);

        require(finalTokenA >= minOut, "DEX2 swap slippage too high");
        emit SwapExecuted(tokenB, tokenA, intermediateAmount, finalTokenA, block.timestamp);

        emit DebugBalance("Final tokenA Balance Before Repay", IERC20Upgradeable(tokenA).balanceOf(address(this)));

        uint totalDebt = amount + premium;

        if (finalTokenA <= totalDebt + minProfit) {
            emit ArbitrageFailed("No profit", block.timestamp);
            IERC20Upgradeable(tokenA).safeApprove(address(_pool), 0);
            IERC20Upgradeable(tokenA).safeApprove(address(_pool), totalDebt);
            return true;
        }

        uint profit = finalTokenA - totalDebt;
        totalArbitrages++;
        totalProfit += profit;
        lastExecutionTime = block.timestamp;

        IERC20Upgradeable(tokenA).safeApprove(address(_pool), 0);
        IERC20Upgradeable(tokenA).safeApprove(address(_pool), totalDebt);
        emit ArbitrageExecuted(profit, block.timestamp);

        if (autoWithdrawProfit && profit > 0) {
            IERC20Upgradeable(tokenA).safeTransfer(owner(), profit);
        }

        return true;
    }

    function requestFlashLoan(uint amount) external onlyOperator notPaused onlyEOA {
        require(amount > 0, "Amount must be > 0");
        emit FlashLoanRequested(tokenA, amount);
        _pool.flashLoanSimple(address(this), tokenA, amount, "", 0);
    }

    function pause(bool _status) external onlyOwner {
        paused = _status;
        emit Paused(_status);
    }

    function setDEXs(address _DEX1, address _DEX2) external onlyOwner {
        DEX1 = _DEX1;
        DEX2 = _DEX2;
    }

    function setTokens(address _tokenA, address _tokenB) external onlyOwner {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function setSlippageTolerance(uint _slip) external onlyOwner {
        require(_slip <= 10, "Max 10% slippage");
        slippageTolerance = _slip;
    }

    function setMinProfit(uint _profit) external onlyOwner {
        minProfit = _profit;
    }

    function setAutoWithdraw(bool _status) external onlyOwner {
        autoWithdrawProfit = _status;
    }

    function setOperator(address user, bool status) external onlyOwner {
        operators[user] = status;
    }

    function addPairConfig(address _tokenA, address _tokenB, address _DEX1, address _DEX2) external onlyOwner {
        pairConfigs.push(PairConfig(_tokenA, _tokenB, _DEX1, _DEX2));
        emit PairConfigChanged(_tokenA, _tokenB, _DEX1, _DEX2, pairConfigs.length - 1);
    }

    function setActivePairIndex(uint index) external onlyOwner {
        require(index < pairConfigs.length, "Invalid index");
        activePairIndex = index;
        PairConfig memory cfg = pairConfigs[index];
        tokenA = cfg.tokenA;
        tokenB = cfg.tokenB;
        DEX1 = cfg.DEX1;
        DEX2 = cfg.DEX2;
        emit PairConfigChanged(cfg.tokenA, cfg.tokenB, cfg.DEX1, cfg.DEX2, index);
    }

    function withdrawToken(address token) external onlyOwner {
        uint balance = IERC20Upgradeable(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20Upgradeable(token).safeTransfer(owner(), balance);
        emit TokensWithdrawn(token, balance, owner());
    }

    function emergencyWithdrawETH() external onlyOwner {
        uint bal = address(this).balance;
        require(bal > 0, "No ETH");
        payable(owner()).transfer(bal);
        emit EmergencyETHWithdrawn(bal, owner());
    }

    receive() external payable {}
}
