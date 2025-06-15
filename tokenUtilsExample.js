const {
  findTokensByChainName,
  getTokenAddress,
  getPriceForPair,
  getAllTokensForChain,
  searchTokens
} = require('./tokenUtils');

// Example usage of the token utility functions

async function main() {
  try {
    console.log('=== Token Utilities Examples ===\n');

    // 1. Find all tokens for a specific chain
    console.log('1. Finding all tokens on Ethereum:');
    const ethereumTokens = findTokensByChainName('Ethereum');
    console.log(`Chain ID: ${ethereumTokens.chainId}`);
    console.log(`Available tokens:`, Object.keys(ethereumTokens.tokens));
    console.log('\n');

    // 2. Get a specific token address
    console.log('2. Getting USDC address on Polygon:');
    const usdcAddress = getTokenAddress('Polygon', 'USDC');
    console.log(`USDC address on Polygon: ${usdcAddress}`);
    console.log('\n');

    // 3. Search for tokens across chains
    console.log('3. Searching for tokens containing "USD":');
    const usdTokens = searchTokens('USD');
    usdTokens.forEach(token => {
      console.log(`- ${token.symbol} on ${token.chainName}: ${token.address}`);
    });
    console.log('\n');

    // 4. Get all tokens for a specific chain
    console.log('4. Getting all tokens on Arbitrum One:');
    const arbitrumTokens = getAllTokensForChain('Arbitrum One');
    arbitrumTokens.forEach(token => {
      console.log(`- ${token.symbol}: ${token.address}`);
    });
    console.log('\n');

    // 5. Get price quote for a token pair
    console.log('5. Getting price quote for USDC -> WETH on Ethereum:');
    console.log('(This will take a moment to fetch from the blockchain...)\n');
    
    const priceQuote = await getPriceForPair({
      chainName: 'Ethereum',
      tokenInSymbol: 'USDC',
      tokenOutSymbol: 'WETH',
      amount: '1000', // 1000 USDC
      tradeType: 'exactIn'
    });

    console.log('Price Quote Results:');
    console.log(`Chain: ${priceQuote.chainName} (ID: ${priceQuote.chainId})`);
    console.log(`Pair: ${priceQuote.pair}`);
    console.log(`Trade Type: ${priceQuote.tradeType}`);
    console.log(`Input Amount: ${priceQuote.inputAmount} ${priceQuote.tokenIn.symbol}`);
    console.log(`Output Amount: ${priceQuote.outputAmount} ${priceQuote.tokenOut.symbol}`);
    console.log(`Price: 1 ${priceQuote.tokenIn.symbol} = ${priceQuote.price} ${priceQuote.tokenOut.symbol}`);
    console.log(`Price Impact: ${priceQuote.priceImpact}%`);
    console.log(`Minimum Received: ${priceQuote.minimumReceived} ${priceQuote.tokenOut.symbol}`);
    console.log(`Estimated Gas: ${priceQuote.estimatedGas}`);
    console.log('\nRoute:');
    priceQuote.route.forEach((hop, index) => {
      console.log(`  Hop ${index + 1}: ${hop.tokenIn} -> ${hop.tokenOut} (Fee: ${hop.fee}, Protocol: ${hop.protocol})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the examples
main();