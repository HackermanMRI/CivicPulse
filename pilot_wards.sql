\set content `cat /tmp/narayanganj_wards.geojson`

INSERT INTO wards (name_en, name_bn, city_corp, district, geom, ref_point, fallback_radius_m, source)
SELECT
  f->'properties'->>'name_en',
  f->'properties'->>'name_bn',
  f->'properties'->>'city_corp',
  f->'properties'->>'district',
  g,
  ST_PointOnSurface(g)::geography,
  300,
  f->'properties'->>'source'
FROM jsonb_array_elements((:'content')::jsonb->'features') AS f,
     LATERAL (SELECT ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326)), 3)) AS g) AS x;