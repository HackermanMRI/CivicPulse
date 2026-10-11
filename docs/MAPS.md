# Self-hosted base map (B3, R35)

The dashboard map uses MapLibre with a Protomaps **PMTiles** extract of the pilot area, served by nginx from
`tiles/pilot.pmtiles`. Without the file everything still works: reports, hotspots and the 3D grid are drawn on a
plain background and the map shows "Base map not installed".

## Make the extract (once, needs internet)

1. Download the `pmtiles` command-line tool for Windows from https://github.com/protomaps/go-pmtiles/releases
   (`go-pmtiles_*_Windows_x86_64.zip`) and unzip `pmtiles.exe` into the project folder.
2. Pick a recent daily build from https://maps.protomaps.com/builds/ (file name like `20261001.pmtiles`).
3. Extract only the pilot area (Bashundhara to Narayanganj), zoom 0–15:
   ```powershell
   .\pmtiles.exe extract https://build.protomaps.com/20261001.pmtiles tiles\pilot.pmtiles --bbox=90.38,23.58,90.56,23.86 --maxzoom=15
   ```
   Replace the date with the build you picked. The result is a few tens of MB.
4. Restart nginx: `docker compose restart nginx`, then reload the dashboard.

The file is gitignored. The map credits "© OpenStreetMap contributors".

## Limits

- No street or place names are drawn: labels need glyph files, which are not bundled. The two area buttons and the
  hotspot "Show" buttons move the map without dragging (B15).
- Layer names follow the Protomaps basemap schema (earth, landuse, water, roads, buildings). If a future build renames
  them, the background still shows and the report layers still work.
