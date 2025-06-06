const { ethers } = require("ethers");
const fetch = require("node-fetch");

// https://app.uniswap.org/explore/pools/unichain/0x1D6ae37DB0e36305019fB3d4bad2750B8784aDF9

const RPC_URL = "https://unichain-mainnet.infura.io/v3/";
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
  "function balanceOf(address) view returns (uint256)"
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

  const [decimals0, decimals1, symbol0, symbol1, balance0, balance1] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
    token0Contract.symbol(),
    token1Contract.symbol(),
    token0Contract.balanceOf(POOL_ADDRESS),
    token1Contract.balanceOf(POOL_ADDRESS)
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

  // Print metrics
  console.log(`Pool: ${symbol0}/${symbol1} (${POOL_ADDRESS})`);
  console.log(`Price (${symbol0} per ${symbol1}): ${price0per1}`);
  console.log(`Price (${symbol1} per ${symbol0}): ${price1per0}`);
  console.log(`Tick: ${tick}`);
  console.log(`Liquidity: ${liquidity}`);
  console.log(`Pool balances: ${balance0Norm} ${symbol0}, ${balance1Norm} ${symbol1}`);
  console.log(`TVL: $${tvl.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`24H volume: $${volumeUSD.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`24H fees: $${dailyFees.toLocaleString(undefined, {maximumFractionDigits:2})}`);
  console.log(`APR: ${apr.toFixed(2)}%`);
}

main(); 