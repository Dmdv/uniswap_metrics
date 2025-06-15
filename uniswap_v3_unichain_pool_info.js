const { ethers } = require("ethers");
const fetch = require("node-fetch");

require('dotenv').config();

const INFURA_KEY = process.env.INFURA_KEY;
if (!INFURA_KEY) {
  throw new Error("INFURA_KEY environment variable is required");
}

// https://app.uniswap.org/explore/pools/unichain/0x1D6ae37DB0e36305019fB3d4bad2750B8784aDF9

const RPC_URL = `https://unichain-mainnet.infura.io/v3/${INFURA_KEY}`;
const POOL_ADDRESS = "0x1D6ae37DB0e36305019fB3d4bad2750B8784aDF9";

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
];
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
];

// CoinGecko ids for getting USD prices
const COINGECKO_IDS = {
  WETH: "weth",
  WBTC: "wrapped-bitcoin"
};

async function getUSDPrices() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=weth,wrapped-bitcoin&vs_currencies=usd`;
  const res = await fetch(url);
  const data = await res.json();
  return {
    WETH: data.weth.usd,
    WBTC: data["wrapped-bitcoin"].usd
  };
}

// Accurate binary search for block by timestamp
async function findBlockByTimestamp(provider, targetTimestamp) {
  let latestBlock = await provider.getBlock("latest");
  let latest = latestBlock.number;
  let earliest = latest - 5000;
  if (earliest < 0) earliest = 0;

  // Move earliest back until its timestamp < targetTimestamp
  while (true) {
    const block = await provider.getBlock(earliest);
    if (block.timestamp < targetTimestamp) break;
    earliest = Math.max(0, earliest - 5000);
    if (earliest === 0) break;
  }

  // Binary search
  while (earliest < latest) {
    const mid = Math.floor((earliest + latest) / 2);
    const block = await provider.getBlock(mid);
    if (block.timestamp < targetTimestamp) {
      earliest = mid + 1;
    } else {
      latest = mid;
    }
  }
  return earliest;
}

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
  const iface = new ethers.utils.Interface(POOL_ABI);

  // Get token addresses
  const token0 = await pool.token0();
  const token1 = await pool.token1();

  // Get slot0 (for price and tick)
  const slot0 = await pool.slot0();
  const sqrtPriceX96 = slot0.sqrtPriceX96;
  const tick = slot0.tick;

  // Get decimals and symbols
  const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);

  // --- Uniswap V2 Price Calculation (On-chain only, no external sources) ---
  // Example V2 pool address (replace with actual if needed)
  const V2_POOL_ADDRESS = "0xC2aDdA861F89bBB333c90c492cB837741916A225"; // TODO: set real V2 pool address
  const V2_POOL_ABI = [
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() view returns (address)",
    "function token1() view returns (address)"
  ];
  try {
    const v2Pool = new ethers.Contract(V2_POOL_ADDRESS, V2_POOL_ABI, provider);
    const [v2Token0, v2Token1] = await Promise.all([
      v2Pool.token0(),
      v2Pool.token1()
    ]);
    const v2Token0Contract = new ethers.Contract(v2Token0, ERC20_ABI, provider);
    const v2Token1Contract = new ethers.Contract(v2Token1, ERC20_ABI, provider);
    const [v2Decimals0, v2Decimals1, v2Symbol0, v2Symbol1] = await Promise.all([
      v2Token0Contract.decimals(),
      v2Token1Contract.decimals(),
      v2Token0Contract.symbol(),
      v2Token1Contract.symbol()
    ]);
    const reserves = await v2Pool.getReserves();
    const reserve0Norm = Number(reserves[0]) / 10 ** v2Decimals0;
    const reserve1Norm = Number(reserves[1]) / 10 ** v2Decimals1;
    const v2Price0per1 = reserve1Norm / reserve0Norm;
    const v2Price1per0 = reserve0Norm / reserve1Norm;
    console.log(`(V2) Pool: ${v2Symbol0}/${v2Symbol1} (${V2_POOL_ADDRESS})`);
    console.log(`(V2) Price (${v2Symbol0} per ${v2Symbol1}): ${v2Price0per1}`);
    console.log(`(V2) Price (${v2Symbol1} per ${v2Symbol0}): ${v2Price1per0}`);
  } catch (e) {
    console.log("(V2) Failed to fetch V2 pool price (set correct V2 pool address): ", e);
  }
  
  const [decimals0, decimals1, symbol0, symbol1, balance0, balance1, totalSupply0, totalSupply1] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
    token0Contract.symbol(),
    token1Contract.symbol(),
    token0Contract.balanceOf(POOL_ADDRESS),
    token1Contract.balanceOf(POOL_ADDRESS),
    token0Contract.totalSupply(),
    token1Contract.totalSupply()
  ]);

  // Pool balances
  const balance0Norm = Number(balance0) / 10 ** decimals0;
  const balance1Norm = Number(balance1) / 10 ** decimals1;

  // Calculate price token0/token1 and reverse
  const price0per1 = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (decimals0 - decimals1);
  const price1per0 = 1 / price0per1;

  // Liquidity
  const liquidity = await pool.liquidity();

  // Get USD prices from CoinGecko
  let usdPrices = { WETH: 0, WBTC: 0 };
  try {
    usdPrices = await getUSDPrices();
  } catch (e) {
    console.log("Failed to fetch prices from CoinGecko");
  }

  // TVL (Total Value Locked) in USD
  let tvl = 0;
  if (symbol0 === "WETH" && symbol1 === "WBTC") {
    tvl = balance0Norm * usdPrices.WETH + balance1Norm * usdPrices.WBTC;
  } else if (symbol0 === "WBTC" && symbol1 === "WETH") {
    tvl = balance0Norm * usdPrices.WBTC + balance1Norm * usdPrices.WETH;
  }

  // Get fee tier from contract
  let feeTier = 0.01; // fallback
  try {
    const fee = await pool.fee(); // returns 10000 for 1%
    feeTier = fee / 1e6; // 10000 -> 0.01
  } catch (e) {
    feeTier = 0.01;
  }

  // --- 24H Volume and APR Calculation ---
  // Accurate block for 24h ago
  let fromBlock, fromBlockObj, toBlock, toBlockObj;
  try {
    const now = Math.floor(Date.now() / 1000);
    const targetTimestamp = now - 24 * 3600;
    fromBlock = await findBlockByTimestamp(provider, targetTimestamp);
    fromBlockObj = await provider.getBlock(fromBlock);
  } catch (e) {
    fromBlock = (await provider.getBlockNumber()) - 5000; // fallback
    fromBlockObj = await provider.getBlock(fromBlock);
  }
  toBlock = await provider.getBlockNumber();
  toBlockObj = await provider.getBlock(toBlock);

  // Log time boundaries
  const nowDate = new Date(toBlockObj.timestamp * 1000).toISOString();
  const fromDate = new Date(fromBlockObj.timestamp * 1000).toISOString();
  console.log(`Current time (toBlock): ${nowDate}`);
  console.log(`Lower boundary (fromBlock): #${fromBlock} at ${fromDate}`);
  console.log(`Upper boundary (toBlock): #${toBlock} at ${nowDate}`);

  // Swap event signature
  const swapTopic = iface.getEventTopic("Swap");

  // Fetch Swap events
  let swapEvents = [];
  try {
    swapEvents = await provider.getLogs({
      address: POOL_ADDRESS,
      fromBlock,
      toBlock,
      topics: [swapTopic]
    });
  } catch (e) {
    console.log("Failed to fetch Swap events");
  }

  // Parse and sum volume in USD
  let volumeUSD = 0;
  for (const event of swapEvents) {
    const parsed = iface.parseLog(event);
    const amount0 = Number(parsed.args.amount0);
    const amount1 = Number(parsed.args.amount1);
    // Convert to normalized values
    const amount0Norm = Math.abs(amount0) / 10 ** decimals0;
    const amount1Norm = Math.abs(amount1) / 10 ** decimals1;
    // Use only input side for volume (Uniswap Analytics style)
    let usd = 0;
    if (symbol0 === "WETH" && symbol1 === "WBTC") {
      if (amount0 < 0) {
        usd = amount0Norm * usdPrices.WETH;
      } else {
        usd = amount1Norm * usdPrices.WBTC;
      }
    } else if (symbol0 === "WBTC" && symbol1 === "WETH") {
      if (amount0 < 0) {
        usd = amount0Norm * usdPrices.WBTC;
      } else {
        usd = amount1Norm * usdPrices.WETH;
      }
    }
    volumeUSD += Math.abs(usd);
  }

  // Calculate daily fees and APR
  const dailyFees = volumeUSD * feeTier;
  const yearlyFees = dailyFees * 365;
  const apr = tvl > 0 ? (yearlyFees / tvl) * 100 : 0;

  // --- FDV Calculation ---
  let fdv0 = 0, fdv1 = 0;
  if (symbol0 === "WETH" && usdPrices.WETH) fdv0 = Number(totalSupply0) / 10 ** decimals0 * usdPrices.WETH;
  if (symbol1 === "WBTC" && usdPrices.WBTC) fdv1 = Number(totalSupply1) / 10 ** decimals1 * usdPrices.WBTC;
  if (symbol0 === "WBTC" && usdPrices.WBTC) fdv0 = Number(totalSupply0) / 10 ** decimals0 * usdPrices.WBTC;
  if (symbol1 === "WETH" && usdPrices.WETH) fdv1 = Number(totalSupply1) / 10 ** decimals1 * usdPrices.WETH;

  // --- Pool Age Calculation ---
  let poolAgeDays = null;
  try {
    // Try to get the first block with Swap or Initialize event
    const firstSwap = await provider.getLogs({
      address: POOL_ADDRESS,
      fromBlock: 0,
      toBlock: toBlock,
      topics: [swapTopic],
      limit: 1
    });
    let firstBlock = null;
    if (firstSwap.length > 0) {
      firstBlock = firstSwap[0].blockNumber;
    } else {
      // fallback: use current block
      firstBlock = toBlock;
    }
    const firstBlockObj = await provider.getBlock(firstBlock);
    poolAgeDays = (toBlockObj.timestamp - firstBlockObj.timestamp) / 86400;
  } catch (e) {
    poolAgeDays = null;
  }

  // --- Buy/Sell Volume, Makers, Buyers, Sellers ---
  let buyVolumeUSD = 0, sellVolumeUSD = 0;
  const makers = new Set();
  const buyers = new Set();
  const sellers = new Set();
  for (const event of swapEvents) {
    const parsed = iface.parseLog(event);
    const amount0 = Number(parsed.args.amount0);
    const amount1 = Number(parsed.args.amount1);
    const sender = parsed.args.sender;
    const recipient = parsed.args.recipient;
    // Convert to normalized values
    const amount0Norm = Math.abs(amount0) / 10 ** decimals0;
    const amount1Norm = Math.abs(amount1) / 10 ** decimals1;
    let usd = 0;
    let isBuy = false;
    if (symbol0 === "WETH" && symbol1 === "WBTC") {
      if (amount0 < 0) {
        usd = amount0Norm * usdPrices.WETH;
        isBuy = true; // WETH in, buying WBTC
      } else {
        usd = amount1Norm * usdPrices.WBTC;
        isBuy = false; // WBTC in, selling WBTC
      }
    } else if (symbol0 === "WBTC" && symbol1 === "WETH") {
      if (amount0 < 0) {
        usd = amount0Norm * usdPrices.WBTC;
        isBuy = true; // WBTC in, buying WETH
      } else {
        usd = amount1Norm * usdPrices.WETH;
        isBuy = false; // WETH in, selling WETH
      }
    }
    if (isBuy) {
      buyVolumeUSD += Math.abs(usd);
      buyers.add(sender);
      sellers.add(recipient);
    } else {
      sellVolumeUSD += Math.abs(usd);
      sellers.add(sender);
      buyers.add(recipient);
    }
    makers.add(sender);
  }

  // Print metrics
  console.log(`Pool: ${symbol0}/${symbol1} (${POOL_ADDRESS})`);
  console.log(`Price (${symbol0} per ${symbol1}): ${price0per1}`);
  console.log(`Price (${symbol1} per ${symbol0}): ${price1per0}`);
  console.log(`Tick: ${tick}`);
  console.log(`Liquidity: ${liquidity}`);
  console.log(`Pool balances: ${balance0Norm} ${symbol0}, ${balance1Norm} ${symbol1}`);
  console.log(`TVL: $${tvl.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`FDV: ${symbol0}: $${fdv0.toLocaleString(undefined, {maximumFractionDigits:2})}, ${symbol1}: $${fdv1.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`24H volume: $${volumeUSD.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`Buy volume: $${buyVolumeUSD.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`Sell volume: $${sellVolumeUSD.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`24H fees: $${dailyFees.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`APR: ${apr.toFixed(2)}%`);
  console.log(`Pool age: ${poolAgeDays !== null ? poolAgeDays.toFixed(2) + ' days' : 'N/A'}`);
  console.log(`Makers: ${makers.size}, Buyers: ${buyers.size}, Sellers: ${sellers.size}`);
}

main(); 