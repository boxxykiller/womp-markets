-- Market data is now kept indefinitely; the per-source retention window is gone.
ALTER TABLE "MarketSource" DROP COLUMN "retentionDays";
