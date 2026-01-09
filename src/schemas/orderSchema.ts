import { z } from 'zod';
import { OrderType } from '../types';

/**
 * Order execution request schema
 * Validates incoming POST /api/orders/execute requests
 */
export const executeOrderSchema = z.object({
  type: z.enum([OrderType.MARKET], {
    message: 'type must be "market"',
  }),
  tokenIn: z.string()
    .min(1, 'tokenIn is required')
    .max(64, 'tokenIn must be at most 64 characters'),
  tokenOut: z.string()
    .min(1, 'tokenOut is required')
    .max(64, 'tokenOut must be at most 64 characters'),
  amount: z.string()
    .regex(/^\d+\.?\d*$/, 'amount must be a valid decimal string')
    .refine((val) => parseFloat(val) > 0, 'amount must be greater than 0'),
  slippage: z.string()
    .regex(/^0?\.\d+$|^0$/, 'slippage must be a decimal between 0 and 1')
    .refine((val) => {
      const num = parseFloat(val);
      return num >= 0 && num <= 0.5;
    }, 'slippage must be between 0 and 0.5 (50%)'),
});

export type ExecuteOrderInput = z.infer<typeof executeOrderSchema>;

/**
 * Validate order request and return errors if invalid
 */
export const validateOrderRequest = (data: unknown): {
  success: boolean;
  data?: ExecuteOrderInput;
  errors?: Array<{ field: string; message: string }>;
} => {
  const result = executeOrderSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((issue: z.ZodIssue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));

  return { success: false, errors };
};
