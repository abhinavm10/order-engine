-- Orders table schema
-- Run this migration to create the orders table

CREATE TYPE order_status AS ENUM (
  'pending',
  'routing', 
  'building',
  'submitted',
  'confirmed',
  'failed'
);

CREATE TYPE order_type AS ENUM (
  'market'
);

CREATE TYPE dex_provider AS ENUM (
  'raydium',
  'meteora'
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status order_status NOT NULL DEFAULT 'pending',
  type order_type NOT NULL,
  token_in VARCHAR(64) NOT NULL,
  token_out VARCHAR(64) NOT NULL,
  amount_in DECIMAL(18, 9) NOT NULL,
  slippage DECIMAL(5, 4) NOT NULL,
  amount_out DECIMAL(18, 9),
  dex_used dex_provider,
  tx_hash VARCHAR(128),
  failure_reason TEXT,
  raydium_quote DECIMAL(18, 9),
  meteora_quote DECIMAL(18, 9),
  logs JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster status queries
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Index for faster date range queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
