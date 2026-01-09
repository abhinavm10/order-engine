import Decimal from 'decimal.js';
import { IDexQuote, ISwapResult, DexProvider } from '../../types';
import { logger } from '../../utils/logger';
import { RaydiumSimulator, MeteoraSimulator, IDexProvider } from './simulators';

/**
 * Sleep utility
 */
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate mock transaction hash
 */
const generateMockTxHash = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
};

/**
 * MockDexRouter - Routes orders to best DEX
 * 
 * Follows Open/Closed Principle:
 * - Adding new DEX only requires creating new simulator
 * - No modification to existing router logic needed
 */
export class MockDexRouter {
  private raydium: IDexProvider;
  private meteora: IDexProvider;

  constructor() {
    this.raydium = new RaydiumSimulator();
    this.meteora = new MeteoraSimulator();
  }

  /**
   * Get quotes from both DEXs
   */
  async getQuotes(
    tokenIn: string,
    tokenOut: string,
    amount: string
  ): Promise<{ raydium: IDexQuote; meteora: IDexQuote }> {
    logger.info({ tokenIn, tokenOut, amount }, 'Fetching DEX quotes...');

    // Fetch quotes in parallel
    const [raydium, meteora] = await Promise.all([
      this.raydium.getQuote(tokenIn, tokenOut, amount),
      this.meteora.getQuote(tokenIn, tokenOut, amount),
    ]);

    logger.info({
      raydiumPrice: raydium.price,
      meteoraPrice: meteora.price,
    }, 'Quotes received');

    return { raydium, meteora };
  }

  /**
   * Select best DEX based on effective price (price after fees)
   * Returns the DEX that gives more output tokens
   */
  selectBestDex(
    raydium: IDexQuote,
    meteora: IDexQuote
  ): { selectedDex: DexProvider; reason: string } {
    // Calculate effective price (price * (1 - fee))
    const raydiumEffective = new Decimal(raydium.price)
      .mul(new Decimal(1).minus(raydium.fee));
    
    const meteoraEffective = new Decimal(meteora.price)
      .mul(new Decimal(1).minus(meteora.fee));

    // Higher effective price = better for seller (more output)
    const selectedDex = raydiumEffective.gte(meteoraEffective)
      ? DexProvider.RAYDIUM
      : DexProvider.METEORA;

    const reason = `${selectedDex} selected: effective price ${
      selectedDex === DexProvider.RAYDIUM 
        ? raydiumEffective.toFixed(9) 
        : meteoraEffective.toFixed(9)
    } vs ${
      selectedDex === DexProvider.RAYDIUM
        ? meteoraEffective.toFixed(9)
        : raydiumEffective.toFixed(9)
    }`;

    logger.info({ selectedDex, reason }, 'DEX selected');

    return { selectedDex, reason };
  }

  /**
   * Execute swap on selected DEX
   * Simulates 2-3 second execution time
   */
  async executeSwap(
    dex: DexProvider,
    tokenIn: string,
    tokenOut: string,
    amount: string,
    expectedPrice: string,
    slippage: string
  ): Promise<ISwapResult> {
    logger.info({
      dex,
      tokenIn,
      tokenOut,
      amount,
      expectedPrice,
      slippage,
    }, 'Executing swap...');

    // Simulate swap execution (2-3 seconds)
    await sleep(2000 + Math.random() * 1000);

    // Calculate executed price with small slippage variance
    const slippageVariance = new Decimal(1).minus(
      new Decimal(Math.random()).mul(slippage)
    );
    const executedPrice = new Decimal(expectedPrice)
      .mul(slippageVariance)
      .toFixed(9);

    const result: ISwapResult = {
      txHash: generateMockTxHash(),
      executedPrice,
      dex,
    };

    logger.info({
      txHash: result.txHash,
      executedPrice: result.executedPrice,
      dex,
    }, 'Swap executed successfully');

    return result;
  }

  /**
   * Check if executed price is within slippage tolerance
   */
  checkSlippage(
    expectedPrice: string,
    executedPrice: string,
    slippage: string
  ): { passed: boolean; actualSlippage: string } {
    const expected = new Decimal(expectedPrice);
    const executed = new Decimal(executedPrice);
    const maxSlippage = new Decimal(slippage);

    // Calculate actual slippage as percentage
    const actualSlippage = expected.minus(executed).abs().div(expected);
    const passed = actualSlippage.lte(maxSlippage);

    logger.info({
      expectedPrice,
      executedPrice,
      maxSlippage: slippage,
      actualSlippage: actualSlippage.toFixed(6),
      passed,
    }, 'Slippage check');

    return {
      passed,
      actualSlippage: actualSlippage.toFixed(6),
    };
  }
}

// Export singleton instance
export const dexRouter = new MockDexRouter();
