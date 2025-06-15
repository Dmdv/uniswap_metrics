const express = require('express');
const cors = require('cors');
const PriceFeedProvider = require('./priceCache');

class PriceServer {
  constructor(options = {}) {
    this.app = express();
    this.port = options.port || 3000;
    
    // Initialize price feed provider
    this.priceFeed = new PriceFeedProvider(options);
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    
    // Warm up cache on startup
    this.priceFeed.warmUp().then(() => {
      console.log('Cache warmed up successfully');
    }).catch(err => {
      console.error('Cache warm-up failed:', err);
    });
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // Get price for a token pair
    this.app.get('/price/:chainName/:tokenIn/:tokenOut', async (req, res) => {
      try {
        const { chainName, tokenIn, tokenOut } = req.params;
        const { amount = '1000', tradeType = 'exactIn' } = req.query;

        const price = await this.priceFeed.getPrice(
          chainName, 
          tokenIn, 
          tokenOut, 
          amount, 
          tradeType
        );

        // Add metadata
        const response = {
          success: true,
          data: price,
          metadata: {
            cached: !price._stale && !price._veryStale,
            stale: !!price._stale,
            veryStale: !!price._veryStale,
            error: price._error || null,
            timestamp: new Date().toISOString()
          }
        };

        // Set cache headers based on data freshness
        if (price._stale) {
          res.set('Cache-Control', 'public, max-age=5');
        } else if (price._veryStale) {
          res.set('Cache-Control', 'public, max-age=1');
        } else {
          res.set('Cache-Control', 'public, max-age=30');
        }

        res.json(response);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Batch price endpoint
    this.app.post('/prices', async (req, res) => {
      try {
        const { pairs } = req.body;
        
        if (!Array.isArray(pairs)) {
          return res.status(400).json({
            success: false,
            error: 'pairs must be an array'
          });
        }

        const results = await Promise.allSettled(
          pairs.map(async (pair) => {
            const { chainName, tokenIn, tokenOut, amount = '1000', tradeType = 'exactIn' } = pair;
            const price = await this.priceFeed.getPrice(chainName, tokenIn, tokenOut, amount, tradeType);
            return { pair, price };
          })
        );

        const response = {
          success: true,
          data: results.map((result, index) => ({
            pair: pairs[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value.price : null,
            error: result.status === 'rejected' ? result.reason.message : null
          })),
          timestamp: new Date().toISOString()
        };

        res.json(response);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Get system metrics
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.priceFeed.getMetrics();
        res.json({
          success: true,
          data: metrics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Add pair to tier (admin endpoint)
    this.app.post('/admin/tiers/:tier/pairs', (req, res) => {
      try {
        const { tier } = req.params;
        const { chainName, tokenIn, tokenOut } = req.body;

        if (!['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'].includes(tier)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid tier. Must be TIER_1, TIER_2, TIER_3, or TIER_4'
          });
        }

        this.priceFeed.addPairToTier(chainName, tokenIn, tokenOut, tier);
        
        res.json({
          success: true,
          message: `Added ${chainName}:${tokenIn}:${tokenOut} to ${tier}`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Force refresh a specific pair
    this.app.post('/admin/refresh', async (req, res) => {
      try {
        const { chainName, tokenIn, tokenOut, amount = '1000', tradeType = 'exactIn' } = req.body;
        
        await this.priceFeed.queuePriceUpdate(chainName, tokenIn, tokenOut, amount, tradeType, 'high');
        
        res.json({
          success: true,
          message: 'Price refresh queued',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Not found',
        timestamp: new Date().toISOString()
      });
    });
  }

  async start() {
    try {
      this.server = this.app.listen(this.port, () => {
        console.log(`Price server running on port ${this.port}`);
        console.log(`Health check: http://localhost:${this.port}/health`);
        console.log(`Metrics: http://localhost:${this.port}/metrics`);
        console.log(`Example: http://localhost:${this.port}/price/Ethereum/USDC/WETH?amount=1000`);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      this.server.close();
      console.log('Server stopped');
    }
  }
}

// Export for use as module
module.exports = PriceServer;

// Run directly if called as script
if (require.main === module) {
  const server = new PriceServer({
    port: process.env.PORT || 3000,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    }
  });

  server.start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully');
    await server.stop();
    process.exit(0);
  });
} 