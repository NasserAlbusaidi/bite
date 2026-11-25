-- Room walls per floor area: corner points on the dot grid. Null = the whole
-- canvas, which is what every area made before this migration keeps.
ALTER TABLE "floor_areas" ADD COLUMN "outline" jsonb;
