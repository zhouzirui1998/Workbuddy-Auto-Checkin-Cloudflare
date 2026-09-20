ALTER TABLE accounts
ADD COLUMN variant TEXT NOT NULL DEFAULT 'cn' CHECK (variant IN ('cn', 'ai'));

CREATE INDEX IF NOT EXISTS idx_accounts_variant_enabled ON accounts(variant, enabled);
