import { IDexQuote, DexProvider } from '../../types';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Interface for DEX providers
 * Follows Interface Segregation - only methods needed for quotes
 */
export interface IDexProvider {
  getQuote(tokenIn: string, tokenOut: string, amount: string): Promise<IDexQuote>;
}

/**
 * Sleep utility for simulating network delays
 */
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Seeded random number generator for deterministic tests
 * When MOCK_SEED is set, produces consistent results
 */
class SeededRandom {
  private seed: number;

  constructor(seed?: string) {
    this.seed = seed ? this.hashString(seed) : Math.random() * 1000000;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

// Global random generator (seeded or not based on config)
const random = new SeededRandom(config.MOCK_SEED);

/**
 * Base price for mock calculations
 * In real implementation, this would come from on-chain data
 */
const BASE_PRICE = 100;

/**
 * Raydium DEX Simulator
 * Variance: -2.5% to +2.5% around base price
 * Fee: 0.3%
 */
export class RaydiumSimulator implements IDexProvider {
  async getQuote(tokenIn: string, tokenOut: string, amount: string): Promise<IDexQuote> {
    // Simulate network delay (200-300ms)
    await sleep(200 + random.next() * 100);

    // Calculate price with variance (-2.5% to +2.5%)
    const variance = 1 + (random.next() * 0.05 - 0.025);
    const price = (BASE_PRICE * variance).toFixed(9);

    logger.debug({
      dex: DexProvider.RAYDIUM,
      tokenIn,
      tokenOut,
      amount,
      price,
    }, 'Raydium quote generated');

    return {
      dex: DexProvider.RAYDIUM,
      price,
      fee: '0.003', // 0.3% fee
    };
  }
}

/**
 * Meteora DEX Simulator
 * Variance: -3% to +3% around base price (wider range = more volatile)
 * Fee: 0.2% (lower fee)
 */
export class MeteoraSimulator implements IDexProvider {
  async getQuote(tokenIn: string, tokenOut: string, amount: string): Promise<IDexQuote> {
    // Simulate network delay (200-300ms)
    await sleep(200 + random.next() * 100);

    // Calculate price with wider variance (-3% to +3%)
    const variance = 1 + (random.next() * 0.06 - 0.03);
    const price = (BASE_PRICE * variance).toFixed(9);

    logger.debug({
      dex: DexProvider.METEORA,
      tokenIn,
      tokenOut,
      amount,
      price,
    }, 'Meteora quote generated');

    return {
      dex: DexProvider.METEORA,
      price,
      fee: '0.002', // 0.2% fee
    };
  }
}
