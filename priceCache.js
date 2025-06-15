const Redis = require('redis');
const Bull = require('bull');
const { getPriceForPair } = require('./tokenUtils');

class PriceFeedProvider {
  constructor(options = {}) {
    this.redis = Redis.createClient(options.redis || {});
    this.priceQueue = new Bull('price updates', { redis: options.redis || {} });
    
    // Configuration
    this.config = {
      tiers: {
        TIER_1: { 
          ttl: 10_000,      // 10 seconds
          refresh: 5_000,   // Refresh every 5s
          pairs: new Set()  // Will be populated with top pairs
        },
        TIER_2: { 
          ttl: 60_000,      // 1 minute
          refresh: 30_000,  // Refresh every 30s
          pairs: new Set()
        },
        TIER_3: { 
          ttl: 300_000,     // 5 minutes
          refresh: 180_000, // Refresh every 3min
          pairs: new Set()
        },
        TIER_4: { 
          ttl: 600_000,     // 10 minutes
          refresh: null,    // On-demand only
          pairs: new Set()
        }
      },
      maxStaleAge: 3600_000, // 1 hour max stale
      circuitBreaker: {
        failureThreshold: 5,
        timeout: 30_000,
        resetTimeout: 60_000
      }
    };

    // Metrics
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      responseTime: [],
      lastReset: Date.now()
    };

    this.initializeWorkers();
    this.startTierRefresh();
  }

  /**
   * Main entry point - Get price with caching
   */
  async getPrice(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType = 'exactIn') {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType);
    
    try {
      // Try cache first
      const cached = await this.getFromCache(cacheKey);
      if (cached && !this.isExpired(cached)) {
        this.metrics.cacheHits++;
        this.recordResponseTime(Date.now() - startTime);
        return cached.data;
      }

      // Cache miss or expired - check if we can serve stale
      if (cached && this.canServeStale(cached)) {
        // Serve stale data while triggering background refresh
        this.queuePriceUpdate(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType, 'background');
        this.metrics.cacheHits++; // Count as hit since we served data
        this.recordResponseTime(Date.now() - startTime);
        return { ...cached.data, _stale: true };
      }

      // No cache or too stale - fetch synchronously
      this.metrics.cacheMisses++;
      const price = await this.fetchPrice(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType);
      
      // Cache the result
      await this.setCache(cacheKey, price, this.getTierForPair(chainName, tokenInSymbol, tokenOutSymbol));
      
      this.recordResponseTime(Date.now() - startTime);
      return price;

    } catch (error) {
      this.metrics.errors++;
      
      // Try to serve very stale data as fallback
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        return { ...cached.data, _error: error.message, _veryStale: true };
      }
      
      throw error;
    }
  }

  /**
   * Generate consistent cache key
   */
  generateCacheKey(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType) {
    return `price:${chainName}:${tokenInSymbol}:${tokenOutSymbol}:${amount}:${tradeType}`.toLowerCase();
  }

  /**
   * Get data from cache
   */
  async getFromCache(key) {
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set data in cache with TTL based on tier
   */
  async setCache(key, data, tier) {
    try {
      const cacheEntry = {
        data,
        timestamp: Date.now(),
        tier
      };
      
      const ttl = this.config.tiers[tier].ttl;
      await this.redis.setex(key, Math.floor(ttl / 1000), JSON.stringify(cacheEntry));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Check if cached data is expired
   */
  isExpired(cached) {
    const tier = cached.tier || 'TIER_4';
    const ttl = this.config.tiers[tier].ttl;
    return (Date.now() - cached.timestamp) > ttl;
  }

  /**
   * Check if we can serve stale data (not too old)
   */
  canServeStale(cached) {
    return (Date.now() - cached.timestamp) < this.config.maxStaleAge;
  }

  /**
   * Determine tier for a token pair based on popularity
   */
  getTierForPair(chainName, tokenInSymbol, tokenOutSymbol) {
    const pairKey = `${chainName}:${tokenInSymbol}:${tokenOutSymbol}`.toLowerCase();
    
    for (const [tier, config] of Object.entries(this.config.tiers)) {
      if (config.pairs.has(pairKey)) {
        return tier;
      }
    }
    
    return 'TIER_4'; // Default to lowest tier
  }

  /**
   * Fetch price from blockchain (wrapper around existing function)
   */
  async fetchPrice(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType) {
    return await getPriceForPair({
      chainName,
      tokenInSymbol,
      tokenOutSymbol,
      amount,
      tradeType
    });
  }

  /**
   * Queue background price update
   */
  async queuePriceUpdate(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType, priority = 'normal') {
    const jobData = {
      chainName,
      tokenInSymbol,
      tokenOutSymbol,
      amount,
      tradeType,
      timestamp: Date.now()
    };

    const options = {
      priority: priority === 'high' ? 1 : priority === 'background' ? -1 : 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    };

    await this.priceQueue.add('fetch-price', jobData, options);
  }

  /**
   * Initialize background workers
   */
  initializeWorkers() {
    // Main price fetching worker
    this.priceQueue.process('fetch-price', 10, async (job) => {
      const { chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType } = job.data;
      
      try {
        const price = await this.fetchPrice(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType);
        const cacheKey = this.generateCacheKey(chainName, tokenInSymbol, tokenOutSymbol, amount, tradeType);
        const tier = this.getTierForPair(chainName, tokenInSymbol, tokenOutSymbol);
        
        await this.setCache(cacheKey, price, tier);
        
        return { success: true, cacheKey, tier };
      } catch (error) {
        console.error('Worker error:', error);
        throw error;
      }
    });

    // Error handling
    this.priceQueue.on('failed', (job, err) => {
      console.error(`Job ${job.id} failed:`, err);
    });
  }

  /**
   * Start tier-based refresh cycles
   */
  startTierRefresh() {
    // TIER_1 refresh (every 5 seconds)
    setInterval(() => {
      this.refreshTier('TIER_1');
    }, this.config.tiers.TIER_1.refresh);

    // TIER_2 refresh (every 30 seconds)
    setInterval(() => {
      this.refreshTier('TIER_2');
    }, this.config.tiers.TIER_2.refresh);

    // TIER_3 refresh (every 3 minutes)
    setInterval(() => {
      this.refreshTier('TIER_3');
    }, this.config.tiers.TIER_3.refresh);
  }

  /**
   * Refresh all pairs in a tier
   */
  async refreshTier(tier) {
    const pairs = Array.from(this.config.tiers[tier].pairs);
    
    for (const pairKey of pairs) {
      const [chainName, tokenInSymbol, tokenOutSymbol] = pairKey.split(':');
      // Use standard amount for tier refreshes
      await this.queuePriceUpdate(chainName, tokenInSymbol, tokenOutSymbol, '1000', 'exactIn', 'background');
    }
  }

  /**
   * Add pair to specific tier (for dynamic tier management)
   */
  addPairToTier(chainName, tokenInSymbol, tokenOutSymbol, tier) {
    const pairKey = `${chainName}:${tokenInSymbol}:${tokenOutSymbol}`.toLowerCase();
    this.config.tiers[tier].pairs.add(pairKey);
  }

  /**
   * Get metrics for monitoring
   */
  async getMetrics() {
    const now = Date.now();
    const uptime = now - this.metrics.lastReset;
    
    return {
      ...this.metrics,
      uptime,
      hitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      avgResponseTime: this.metrics.responseTime.length > 0 
        ? this.metrics.responseTime.reduce((a, b) => a + b) / this.metrics.responseTime.length 
        : 0,
      queueStats: {
        active: await this.priceQueue.getActive(),
        waiting: await this.priceQueue.getWaiting(),
        completed: await this.priceQueue.getCompleted(),
        failed: await this.priceQueue.getFailed()
      }
    };
  }

  /**
   * Record response time for metrics
   */
  recordResponseTime(time) {
    this.metrics.responseTime.push(time);
    // Keep only last 1000 measurements
    if (this.metrics.responseTime.length > 1000) {
      this.metrics.responseTime.shift();
    }
  }

  /**
   * Warm up cache with popular pairs
   */
  async warmUp() {
    // Popular pairs to pre-warm
    const popularPairs = [
      { chainName: 'Ethereum', tokenInSymbol: 'USDC', tokenOutSymbol: 'WETH', tier: 'TIER_1' },
      { chainName: 'Ethereum', tokenInSymbol: 'WETH', tokenOutSymbol: 'USDC', tier: 'TIER_1' },
      { chainName: 'Ethereum', tokenInSymbol: 'WBTC', tokenOutSymbol: 'WETH', tier: 'TIER_1' },
      { chainName: 'Polygon', tokenInSymbol: 'USDC', tokenOutSymbol: 'WMATIC', tier: 'TIER_2' },
      { chainName: 'Arbitrum One', tokenInSymbol: 'USDC', tokenOutSymbol: 'WETH', tier: 'TIER_2' }
    ];

    for (const pair of popularPairs) {
      this.addPairToTier(pair.chainName, pair.tokenInSymbol, pair.tokenOutSymbol, pair.tier);
      await this.queuePriceUpdate(pair.chainName, pair.tokenInSymbol, pair.tokenOutSymbol, '1000', 'exactIn', 'high');
    }
  }
}

module.exports = PriceFeedProvider; 