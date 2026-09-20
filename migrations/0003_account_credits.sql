ALTER TABLE accounts ADD COLUMN credits_total_capacity REAL;
ALTER TABLE accounts ADD COLUMN credits_total_remaining REAL;
ALTER TABLE accounts ADD COLUMN credits_soonest_expire_at INTEGER;
ALTER TABLE accounts ADD COLUMN credits_updated_at INTEGER;
ALTER TABLE accounts ADD COLUMN credits_error TEXT;
ALTER TABLE accounts ADD COLUMN credits_error_at INTEGER;
