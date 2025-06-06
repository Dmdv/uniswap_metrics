import requests
from web3 import Web3
from datetime import datetime, timezone

RPC_URL = "https://unichain-mainnet.infura.io/v3/"
POOL_ADDRESS = "0x1D6ae37DB0e36305019fB3d4bad2750B8784aDF9"
POOL_ABI = [
    {
        "inputs": [],
        "name": "slot0",
        "outputs": [
            {"internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160"},
            {"internalType": "int24", "name": "tick", "type": "int24"},
            {"internalType": "uint16", "name": "observationIndex", "type": "uint16"},
            {"internalType": "uint16", "name": "observationCardinality", "type": "uint16"},
            {"internalType": "uint16", "name": "observationCardinalityNext", "type": "uint16"},
            {"internalType": "uint8", "name": "feeProtocol", "type": "uint8"},
            {"internalType": "bool", "name": "unlocked", "type": "bool"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "liquidity",
        "outputs": [{"internalType": "uint128", "name": "", "type": "uint128"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "token0",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "token1",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "fee",
        "outputs": [{"internalType": "uint24", "name": "", "type": "uint24"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "sender", "type": "address"},
            {"indexed": True, "internalType": "address", "name": "recipient", "type": "address"},
            {"indexed": False, "internalType": "int256", "name": "amount0", "type": "int256"},
            {"indexed": False, "internalType": "int256", "name": "amount1", "type": "int256"},
            {"indexed": False, "internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160"},
            {"indexed": False, "internalType": "uint128", "name": "liquidity", "type": "uint128"},
            {"indexed": False, "internalType": "int24", "name": "tick", "type": "int24"},
        ],
        "name": "Swap",
        "type": "event",
    },
]
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
]

def get_usd_prices():
    url = "https://api.coingecko.com/api/v3/simple/price?ids=weth,wrapped-bitcoin&vs_currencies=usd"
    data = requests.get(url).json()
    return {
        "WETH": data["weth"]["usd"],
        "WBTC": data["wrapped-bitcoin"]["usd"]
    }

def find_block_by_timestamp(w3, target_timestamp):
    latest = w3.eth.get_block('latest').number
    earliest = max(0, latest - 5000)
    while True:
        block = w3.eth.get_block(earliest)
        if block.timestamp < target_timestamp:
            break
        earliest = max(0, earliest - 5000)
        if earliest == 0:
            break
    low, high = earliest, latest
    while low < high:
        mid = (low + high) // 2
        block = w3.eth.get_block(mid)
        if block.timestamp < target_timestamp:
            low = mid + 1
        else:
            high = mid
    return low

def main():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    pool = w3.eth.contract(address=POOL_ADDRESS, abi=POOL_ABI)

    token0 = pool.functions.token0().call()
    token1 = pool.functions.token1().call()
    slot0 = pool.functions.slot0().call()
    sqrtPriceX96 = slot0[0]
    tick = slot0[1]
    liquidity = pool.functions.liquidity().call()
    fee = pool.functions.fee().call() / 1e6

    token0_contract = w3.eth.contract(address=token0, abi=ERC20_ABI)
    token1_contract = w3.eth.contract(address=token1, abi=ERC20_ABI)
    decimals0 = token0_contract.functions.decimals().call()
    decimals1 = token1_contract.functions.decimals().call()
    symbol0 = token0_contract.functions.symbol().call()
    symbol1 = token1_contract.functions.symbol().call()
    balance0 = token0_contract.functions.balanceOf(POOL_ADDRESS).call() / (10 ** decimals0)
    balance1 = token1_contract.functions.balanceOf(POOL_ADDRESS).call() / (10 ** decimals1)

    price0per1 = (sqrtPriceX96 / 2 ** 96) ** 2 * 10 ** (decimals0 - decimals1)
    price1per0 = 1 / price0per1

    usd_prices = get_usd_prices()
    if symbol0 == "WETH" and symbol1 == "WBTC":
        tvl = balance0 * usd_prices["WETH"] + balance1 * usd_prices["WBTC"]
    elif symbol0 == "WBTC" and symbol1 == "WETH":
        tvl = balance0 * usd_prices["WBTC"] + balance1 * usd_prices["WETH"]
    else:
        tvl = 0

    now = int(datetime.now(timezone.utc).timestamp())
    target_timestamp = now - 24 * 3600
    from_block = find_block_by_timestamp(w3, target_timestamp)
    to_block = w3.eth.get_block('latest').number
    from_block_obj = w3.eth.get_block(from_block)
    to_block_obj = w3.eth.get_block(to_block)

    print(f"Current time (toBlock): {datetime.utcfromtimestamp(to_block_obj.timestamp).isoformat()}Z")
    print(f"Lower boundary (fromBlock): #{from_block} at {datetime.utcfromtimestamp(from_block_obj.timestamp).isoformat()}Z")
    print(f"Upper boundary (toBlock): #{to_block} at {datetime.utcfromtimestamp(to_block_obj.timestamp).isoformat()}Z")

    # Get Swap events
    swap_event = pool.events.Swap()
    volume_usd = 0
    for event in swap_event.get_logs(fromBlock=from_block, toBlock=to_block):
        args = event['args']
        amount0 = args['amount0']
        amount1 = args['amount1']
        amount0_norm = abs(amount0) / (10 ** decimals0)
        amount1_norm = abs(amount1) / (10 ** decimals1)
        if symbol0 == "WETH" and symbol1 == "WBTC":
            if amount0 < 0:
                usd = amount0_norm * usd_prices["WETH"]
            else:
                usd = amount1_norm * usd_prices["WBTC"]
        elif symbol0 == "WBTC" and symbol1 == "WETH":
            if amount0 < 0:
                usd = amount0_norm * usd_prices["WBTC"]
            else:
                usd = amount1_norm * usd_prices["WETH"]
        else:
            usd = 0
        volume_usd += abs(usd)

    daily_fees = volume_usd * fee
    yearly_fees = daily_fees * 365
    apr = (yearly_fees / tvl) * 100 if tvl > 0 else 0

    print(f"Pool: {symbol0}/{symbol1} ({POOL_ADDRESS})")
    print(f"Price ({symbol0} per {symbol1}): {price0per1}")
    print(f"Price ({symbol1} per {symbol0}): {price1per0}")
    print(f"Tick: {tick}")
    print(f"Liquidity: {liquidity}")
    print(f"Pool balances: {balance0} {symbol0}, {balance1} {symbol1}")
    print(f"TVL: ${tvl:,.2f}")
    print(f"24H volume: ${volume_usd:,.2f}")
    print(f"24H fees: ${daily_fees:,.2f}")
    print(f"APR: {apr:.2f}%")

if __name__ == "__main__":
    main() 