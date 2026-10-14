-- Support the placement ledger filter and date ordering, including soft deletion.
CREATE INDEX "hour_logs_placementId_deletedAt_date_idx" ON "hour_logs"("placementId", "deletedAt", "date" DESC);
