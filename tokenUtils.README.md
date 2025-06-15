# Token Utilities for Uniswap Trading

This module provides utility functions for working with tokens across multiple blockchain networks, integrated with Uniswap V3 for price discovery and trading.

## Features

- Find token addresses by chain name
- Get price quotes for token pairs using Uniswap V3's Smart Order Router
- Search tokens across multiple chains
- Support for 8 major blockchains

## Supported Chains

- Ethereum (chainId: 1)
- Optimism (chainId: 10)
- Polygon (chainId: 137)
- Arbitrum One (chainId: 42161)
- BNB Chain (chainId: 56)
- Avalanche (chainId: 43114)
- Base (chainId: 8453)

## Functions

### `findTokensByChainName(chainName)`

Find all available token addresses for a given blockchain.

**Parameters:**
- `chainName` (string): Name of the blockchain (e.g., "Ethereum", "Polygon")

**Returns:**
- Object containing:
  - `chainId`: The numeric chain ID
  - `chainName`: The normalized chain name
  - `tokens`: Object mapping token symbols to addresses

**Example:**
```javascript
const ethereumTokens = findTokensByChainName('Ethereum');
console.log(ethereumTokens.tokens.USDC); // 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

### `getTokenAddress(chainName, symbol)`

Get a specific token's address on a given chain.

**Parameters:**
- `chainName` (string): Name of the blockchain
- `symbol` (string): Token symbol (e.g., "USDC", "WETH")

**Returns:**
- `string`: Token address or null if not found

**Example:**
```javascript
const usdcAddress = getTokenAddress('Polygon', 'USDC');
// Returns: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```

### `getPriceForPair(params)`

Get a price quote for swapping tokens using Uniswap V3's Smart Order Router.

**Parameters:**
- `params` (object):
  - `chainName` (string): Name of the blockchain
  - `tokenInSymbol` (string): Input token symbol
  - `tokenOutSymbol` (string): Output token symbol
  - `amount` (string): Amount to trade
  - `tradeType` (string, optional): "exactIn" or "exactOut" (default: "exactIn")

**Returns:**
- Promise resolving to an object containing:
  - Price information
  - Trade route details
  - Estimated gas costs
  - Price impact

**Example:**
```javascript
const priceQuote = await getPriceForPair({
  chainName: 'Ethereum',
  tokenInSymbol: 'USDC',
  tokenOutSymbol: 'WETH',
  amount: '1000',
  tradeType: 'exactIn'
});
```

### `getAllTokensForChain(chainName)`

Get all available tokens for a specific chain as an array.

**Parameters:**
- `chainName` (string): Name of the blockchain

**Returns:**
- Array of token objects, each containing:
  - `symbol`: Token symbol
  - `address`: Token address
  - `chainId`: Chain ID
  - `chainName`: Chain name

**Example:**
```javascript
const arbitrumTokens = getAllTokensForChain('Arbitrum One');
// Returns array of all tokens on Arbitrum
```

### `searchTokens(query, chainName)`

Search for tokens by partial symbol match across chains.

**Parameters:**
- `query` (string): Partial token symbol to search
- `chainName` (string, optional): Chain name to filter results

**Returns:**
- Array of matching token objects

**Example:**
```javascript
const usdTokens = searchTokens('USD');
// Returns all tokens containing "USD" in their symbol
```

## Usage Example

```javascript
const { getPriceForPair, getTokenAddress } = require('./tokenUtils');

async function checkPrice() {
  // Get USDC address on Ethereum
  const usdcAddress = getTokenAddress('Ethereum', 'USDC');
  console.log('USDC Address:', usdcAddress);

  // Get price quote for swapping 1000 USDC to WETH
  const quote = await getPriceForPair({
    chainName: 'Ethereum',
    tokenInSymbol: 'USDC',
    tokenOutSymbol: 'WETH',
    amount: '1000',
    tradeType: 'exactIn'
  });

  console.log(`1000 USDC = ${quote.outputAmount} WETH`);
  console.log(`Price: 1 USDC = ${quote.price} WETH`);
  console.log(`Price Impact: ${quote.priceImpact}%`);
}

checkPrice();
```

## Token List

The module includes pre-configured addresses for popular tokens on each chain:

### Common Tokens
- **Stablecoins**: USDC, USDT, DAI, BUSD
- **Wrapped Native**: WETH, WMATIC, WBNB, WAVAX
- **Bitcoin**: WBTC, BTCB
- **DeFi**: UNI, AAVE, LINK, CRV, CAKE
- **Chain-specific**: OP (Optimism), ARB (Arbitrum), GMX, etc.

## Requirements

- Node.js 14+
- Dependencies:
  - `ethers` ^5.0.0
  - `@uniswap/sdk-core`
  - `@uniswap/smart-order-router`
  - Valid RPC endpoints (configured via INFURA_KEY environment variable)

## Environment Setup

Make sure to set the `INFURA_KEY` environment variable:

```bash
export INFURA_KEY=your_infura_project_key
```

Or create a `.env` file:
```
INFURA_KEY=your_infura_project_key
```

## Error Handling

All functions include proper error handling:
- Invalid chain names will throw an error with available chains listed
- Missing tokens will return null or throw descriptive errors
- Network/RPC errors are caught and wrapped with helpful messages

## Notes

- The `getPriceForPair` function uses Uniswap V3's Smart Order Router to find optimal trading routes
- Price quotes include multi-hop routes for better pricing
- Gas estimates are provided but actual gas usage may vary
- Default slippage tolerance is set to 0.5%
- Token addresses are checksummed for safety