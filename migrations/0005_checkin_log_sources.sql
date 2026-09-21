ALTER TABLE checkin_logs
ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'
CHECK (source IN ('manual', 'automatic', 'legacy'));

DELETE FROM checkin_logs
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY account_id, local_date
        ORDER BY
          CASE WHEN status IN ('success', 'already') THEN 0 ELSE 1 END,
          created_at DESC,
          id DESC
      ) AS row_number
    FROM checkin_logs
  )
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_logs_account_date
ON checkin_logs(account_id, local_date);
