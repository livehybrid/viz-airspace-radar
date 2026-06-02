# Airspace Radar Visualization — Splunkbase listing copy

> Source of truth for the Splunkbase listing fields. Keep in sync with each release.
> Compatibility: Splunk Enterprise 9.0+ or Splunk Cloud with Dashboard Studio.

## Short Description (max 380 chars)

An animated phosphor radar scope for Dashboard Studio. Each result row is one aircraft (`hex, callsign, lat, lon, altitude_ft, heading, speed_kts`), drawn with a rotating sweep, range rings, callsign labels and heading vectors. Pairs with the TA-airspace-watch ADS-B modular input.

## Summary (max 3000 chars)

**Airspace Radar** turns a table of aircraft positions into a live, animated radar scope inside Dashboard Studio — a rotating phosphor sweep, range rings, centre cross-hair, per-aircraft callsign labels and heading vectors. It's a striking way to present ADS-B / flight-tracking data, geospatial point movement, or any "things on a scope" dataset.

The data contract is simple: **one row per aircraft**, with fields `hex`, `callsign`, `lat`, `lon`, `altitude_ft`, `heading`, `speed_kts`. Drive it from a live ADS-B feed (it pairs naturally with the companion **TA-airspace-watch** modular input that polls a tar1090/dump1090 receiver), from historical flight data, or from any search that produces those columns.

Standard `studio_visualization` custom viz, theme-aware, dependency-free.

## Details

1. Build a search returning one row per aircraft with: `hex, callsign, lat, lon, altitude_ft, heading, speed_kts` — for example:
   ```spl
   index=... sourcetype=airspace:adsb
   | stats latest(callsign) as callsign latest(lat) as lat latest(lon) as lon
           latest(altitude_ft) as altitude_ft latest(heading) as heading latest(speed_kts) as speed_kts by hex
   | where isnotnull(lat) AND isnotnull(lon)
   | table hex callsign lat lon altitude_ft heading speed_kts
   ```
2. Add the **Airspace Radar** viz to a Dashboard Studio panel and select that search as the primary data source.
3. Give the panel a large, roughly square area for the best scope rendering.

Aircraft are positioned by `lat`/`lon` relative to the scope centre; `heading` draws the vector, `callsign`/`altitude_ft`/`speed_kts` annotate each contact. For a live display, refresh the search every few seconds.

## Installation

1. Install the app and refresh Splunk Web (no restart required for a custom viz).
2. **Airspace Radar** appears in Dashboard Studio → Add chart → Custom.
3. (Optional) Install **TA-airspace-watch** to feed live ADS-B data.

## Troubleshooting

- **Empty scope:** verify the search returns rows with non-null `lat` and `lon`, and the exact field names above.
- **Aircraft clustered/off-centre:** the scope centres on the data's lat/lon spread; constrain the search to your area of interest (or a bounding box).
- **No labels/vectors:** ensure `callsign` and `heading` are present and numeric where expected.
- **Not animating:** give the panel adequate height and keep the browser tab active.
