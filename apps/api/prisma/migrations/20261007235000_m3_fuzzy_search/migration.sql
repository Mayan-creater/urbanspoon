CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Restaurant_name_trgm_idx"
  ON "Restaurant" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX "Restaurant_description_trgm_idx"
  ON "Restaurant" USING GIN (lower(COALESCE("description", '')) gin_trgm_ops);
CREATE INDEX "Restaurant_city_trgm_idx"
  ON "Restaurant" USING GIN (lower("city") gin_trgm_ops);
CREATE INDEX "MenuItem_name_trgm_idx"
  ON "MenuItem" USING GIN (lower("name") gin_trgm_ops)
  WHERE "isAvailable" = true AND "archivedAt" IS NULL;
CREATE INDEX "MenuItem_description_trgm_idx"
  ON "MenuItem" USING GIN (lower(COALESCE("description", '')) gin_trgm_ops)
  WHERE "isAvailable" = true AND "archivedAt" IS NULL;
