const { ethers } = require("ethers");
const { 
  Token,
  CurrencyAmount,
  TradeType,
  Percent
} = require("@uniswap/sdk-core");
const { AlphaRouter, SwapType } = require("@uniswap/smart-order-router");

// Import chain configurations
const CHAIN_CONFIGS = require('./chainConfigs');

// Common token addresses across different chains
const TOKEN_ADDRESSES = {
  // Ethereum Mainnet (chainId: 1)
  1: {
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    MATIC: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
    CRV: "0xD533a949740bb3306d119CC777fa900bA034cd52"
  },
  // Optimism (chainId: 10)
  10: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    OP: "0x4200000000000000000000000000000000000042",
    LINK: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
    SNX: "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4"
  },
  // Polygon (chainId: 137)
  137: {
    WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    WBTC: "0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6",
    LINK: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    AAVE: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B"
  },
  // Arbitrum One (chainId: 42161)
  42161: {
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a"
  },
  // BNB Chain (chainId: 56)
  56: {
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
  },
  // Avalanche (chainId: 43114)
  43114: {
    WAVAX: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    WETH: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
    USDC: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664",
    USDT: "0xc7198437980c041c805A1EDcbA50c1Ce5db95118",
    DAI: "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70",
    WBTC: "0x50b7545627a5162F82A992c33b87aDc75187B218",
    LINK: "0x5947BB275c521040051D82396192181b413227A3"
  },
  // Base (chainId: 8453)
  8453: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"
  }
};

// ERC20 ABI for token info
const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

/**
 * Find token addresses for a given chain name
 * @param {string} chainName - Name of the blockchain (e.g., "Ethereum", "Polygon", "Arbitrum One")
 * @returns {Object} Object containing token addresses for the chain
 */
function findTokensByChainName(chainName) {
  // Find chainId by chain name
  let chainId = null;
  for (const [id, config] of Object.entries(CHAIN_CONFIGS)) {
    if (config.name.toLowerCase() === chainName.toLowerCase()) {
      chainId = parseInt(id);
      break;
    }
  }
  
  if (!chainId) {
    throw new Error(`Chain "${chainName}" not found. Available chains: ${Object.values(CHAIN_CONFIGS).map(c => c.name).join(', ')}`);
  }
  
  const tokens = TOKEN_ADDRESSES[chainId] || {};
  return {
    chainId,
    chainName: CHAIN_CONFIGS[chainId].name,
    tokens
  };
}

/**
 * Get token address by symbol for a specific chain
 * @param {string} chainName - Name of the blockchain
 * @param {string} symbol - Token symbol (e.g., "USDC", "WETH")
 * @returns {string|null} Token address or null if not found
 */
function getTokenAddress(chainName, symbol) {
  const { tokens } = findTokensByChainName(chainName);
  return tokens[symbol.toUpperCase()] || null;
}

/**
 * Create a Token instance with fetched decimals
 * @param {number} chainId - Chain ID
 * @param {string} address - Token address
 * @param {ethers.providers.Provider} provider - Ethers provider
 * @returns {Promise<Token>} Token instance
 */
async function createToken(chainId, address, provider) {
  const tokenContract = new ethers.Contract(address, ERC20_ABI, provider);
  const [decimals, symbol, name] = await Promise.all([
    tokenContract.decimals(),
    tokenContract.symbol().catch(() => "Unknown"),
    tokenContract.name().catch(() => "Unknown Token")
  ]);
  
  return new Token(
    chainId,
    ethers.utils.getAddress(address),
    decimals,
    symbol,
    name
  );
}

/**
 * Get price quote for a specific token pair on a given chain
 * @param {Object} params - Parameters for price query
 * @param {string} params.chainName - Name of the blockchain
 * @param {string} params.tokenInSymbol - Input token symbol (e.g., "USDC")
 * @param {string} params.tokenOutSymbol - Output token symbol (e.g., "WETH")
 * @param {string} params.amount - Amount to trade
 * @param {string} [params.tradeType="exactIn"] - Trade type: "exactIn" or "exactOut"
 * @returns {Promise<Object>} Price quote information
 */
async function getPriceForPair(params) {
  const { chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType = "exactIn" } = params;
  
  // Get chain configuration
  const chainData = findTokensByChainName(chainName);
  const chainId = chainData.chainId;
  const config = CHAIN_CONFIGS[chainId];
  
  if (!config) {
    throw new Error(`Chain configuration not found for ${chainName}`);
  }
  
  // Get token addresses
  const tokenInAddress = getTokenAddress(chainName, tokenInSymbol);
  const tokenOutAddress = getTokenAddress(chainName, tokenOutSymbol);
  
  if (!tokenInAddress) {
    throw new Error(`Token ${tokenInSymbol} not found on ${chainName}`);
  }
  if (!tokenOutAddress) {
    throw new Error(`Token ${tokenOutSymbol} not found on ${chainName}`);
  }
  
  // Initialize provider and router
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const router = new AlphaRouter({ chainId, provider });
  
  // Create token instances
  const tokenIn = await createToken(chainId, tokenInAddress, provider);
  const tokenOut = await createToken(chainId, tokenOutAddress, provider);
  
  // Prepare amount
  const decimals = tradeType === "exactIn" ? tokenIn.decimals : tokenOut.decimals;
  const amountWei = ethers.utils.parseUnits(amount, decimals).toString();
  
  // Get route
  const route = await router.route(
    CurrencyAmount.fromRawAmount(
      tradeType === "exactIn" ? tokenIn : tokenOut,
      amountWei
    ),
    tradeType === "exactIn" ? tokenOut : tokenIn,
    tradeType === "exactIn" ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
    {
      recipient: ethers.constants.AddressZero,
      slippageTolerance: new Percent(5, 1000), // 0.5%
      deadline: Math.floor(Date.now() / 1000) + 20 * 60, // 20 minutes
      type: SwapType.SWAP_ROUTER_02,
    }
  );
  
  if (!route) {
    throw new Error(`No route found for ${tokenInSymbol} -> ${tokenOutSymbol} on ${chainName}`);
  }
  
  // Format response
  return {
    chainName,
    chainId,
    pair: `${tokenInSymbol}/${tokenOutSymbol}`,
    tokenIn: {
      symbol: tokenIn.symbol,
      address: tokenIn.address,
      decimals: tokenIn.decimals
    },
    tokenOut: {
      symbol: tokenOut.symbol,
      address: tokenOut.address,
      decimals: tokenOut.decimals
    },
    tradeType,
    price: route.trade.executionPrice.toSignificant(6),
    priceImpact: route.trade.priceImpact.toSignificant(2),
    inputAmount: route.trade.inputAmount.toSignificant(6),
    outputAmount: route.trade.outputAmount.toSignificant(6),
    minimumReceived: route.trade.minimumAmountOut(new Percent(5, 1000)).toSignificant(6),
    maximumInput: route.trade.maximumAmountIn(new Percent(5, 1000)).toSignificant(6),
    route: route.trade.swaps.map(swap => ({
      tokenIn: swap.inputAmount.currency.address,
      tokenOut: swap.outputAmount.currency.address,
      fee: swap.route.pools[0]?.fee || "N/A",
      protocol: swap.route.protocol
    })),
    estimatedGas: route.estimatedGasUsed.toString(),
    estimatedGasPrice: route.gasPriceWei.toString()
  };
}

/**
 * Get all available tokens for a chain
 * @param {string} chainName - Name of the blockchain
 * @returns {Array<Object>} Array of token information
 */
function getAllTokensForChain(chainName) {
  const { chainId, tokens } = findTokensByChainName(chainName);
  
  return Object.entries(tokens).map(([symbol, address]) => ({
    symbol,
    address,
    chainId,
    chainName
  }));
}

/**
 * Search for tokens by partial symbol match
 * @param {string} query - Partial token symbol to search
 * @param {string} [chainName] - Optional chain name to filter results
 * @returns {Array<Object>} Array of matching tokens
 */
function searchTokens(query, chainName = null) {
  const results = [];
  const searchQuery = query.toUpperCase();
  
  for (const [chainId, tokens] of Object.entries(TOKEN_ADDRESSES)) {
    const chain = CHAIN_CONFIGS[chainId];
    
    // Skip if chainName filter is provided and doesn't match
    if (chainName && chain.name.toLowerCase() !== chainName.toLowerCase()) {
      continue;
    }
    
    for (const [symbol, address] of Object.entries(tokens)) {
      if (symbol.includes(searchQuery)) {
        results.push({
          symbol,
          address,
          chainId: parseInt(chainId),
          chainName: chain.name
        });
      }
    }
  }
  
  return results;
}

module.exports = {
  findTokensByChainName,
  getTokenAddress,
  getPriceForPair,
  getAllTokensForChain,
  searchTokens,
  TOKEN_ADDRESSES,
  createToken
};