import { describe, it, expect, beforeEach } from 'vitest';
import { MockDexRouter } from '../../src/lib/dex/mockDexRouter';
import { DexProvider } from '../../src/types';

describe('MockDexRouter', () => {
  let router: MockDexRouter;

  beforeEach(() => {
    // Reset router with known seed for deterministic tests if possible
    process.env.MOCK_SEED = 'test-seed';
    router = new MockDexRouter();
  });

  describe('getQuotes', () => {
    it('should return quotes from both DEXs', async () => {
      const result = await router.getQuotes('SOL', 'USDC', '1.0');
      
      expect(result).toHaveProperty('raydium');
      expect(result).toHaveProperty('meteora');
      expect(result.raydium.dex).toBe(DexProvider.RAYDIUM);
      expect(result.meteora.dex).toBe(DexProvider.METEORA);
      expect(result.raydium.price).toMatch(/^\d+\.?\d*$/);
    });
  });

  describe('selectBestDex', () => {
    it('should select DEX with better effective price (after fees)', () => {
      // Raydium: 100 with 0.3% fee = 99.7 effective
      // Meteora: 100 with 0.2% fee = 99.8 effective (Better)
      
      const raydium = { dex: DexProvider.RAYDIUM, price: '100', fee: '0.003' };
      const meteora = { dex: DexProvider.METEORA, price: '100', fee: '0.002' };
      
      const result = router.selectBestDex(raydium, meteora);
      
      expect(result.selectedDex).toBe(DexProvider.METEORA);
    });

    it('should select Raydium if price beats Meteora fee advantage', () => {
      // Raydium: 101 with 0.3% fee = 100.697 effective (Better)
      // Meteora: 100 with 0.2% fee = 99.8 effective
      
      const raydium = { dex: DexProvider.RAYDIUM, price: '101', fee: '0.003' };
      const meteora = { dex: DexProvider.METEORA, price: '100', fee: '0.002' };
      
      const result = router.selectBestDex(raydium, meteora);
      
      expect(result.selectedDex).toBe(DexProvider.RAYDIUM);
    });
  });

  describe('checkSlippage', () => {
    it('should pass if executed price is within tolerance', () => {
      // Expected: 100, Executed: 99.6, Slippage: 0.4%
      // Max Slippage: 0.5% -> Pass
      const result = router.checkSlippage('100', '99.6', '0.005');
      expect(result.passed).toBe(true);
    });

    it('should fail if executed price is outside tolerance', () => {
      // Expected: 100, Executed: 99, Slippage: 1%
      // Max Slippage: 0.5% -> Fail
      const result = router.checkSlippage('100', '99', '0.005');
      expect(result.passed).toBe(false);
    });
  });
});
