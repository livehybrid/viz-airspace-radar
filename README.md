# viz-airspace-radar

A Splunk Dashboard Studio **custom visualization** that renders live ADS-B
aircraft as a radar scope (`viz-airspace-radar.airspace_radar`). Expects a
search returning `hex, callsign, lat, lon, altitude_ft, heading, speed_kts`.

Pairs with [TA-airspace-watch](https://github.com/livehybrid/TA-airspace-watch)
(the ADS-B modular input) and the AirspaceWatch dashboards.

## Build / release
CI (`.github/workflows/splunk-app-ci.yml`) stages the app, runs AppInspect
(cloud/victoria), and publishes a packaged `.tar.gz` to GitHub Releases on a
`v*.*.*` tag — ready to upload to Splunkbase.

## License
Apache-2.0.
