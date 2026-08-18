# viz-airspace-radar

A Splunk Dashboard Studio **custom visualization** that renders live ADS-B
aircraft as a radar scope (`viz-airspace-radar.airspace_radar`). Expects a
search returning `hex, callsign, lat, lon, altitude_ft, heading, speed_kts`.

Pairs with [TA-airspace-watch](https://github.com/livehybrid/TA-airspace-watch)
(the ADS-B modular input) and the AirspaceWatch dashboards.

## Build / release
CI (`.github/workflows/splunk-app-ci.yml`) stages the app, runs the test
suites and AppInspect (cloud/future/private_victoria), and publishes a
packaged `.tar.gz` to GitHub Releases on a `v*.*.*` tag — ready to upload to
Splunkbase. Releases are gated on unit tests, the e2e render check and
AppInspect all passing.

## Testing

Two layers, both run in CI on every push (none of it ships in the package):

- **Unit (jest, jsdom + canvas mock)** — `npm test`. Drives the real
  `visualization.js` through a stubbed `DashboardExtensionAPI` with a manual
  animation-frame queue: scope furniture, aircraft labels from search rows,
  range filtering, projection geometry (north/east placement), option handling
  and palette fallbacks, plus drift guards between `visualizations.conf`,
  `config.json` and the source defaults.
- **End-to-end (Playwright)** — `npm run e2e`. Boots the **staged package** on
  a real `splunk/splunk:10.4.0` container (`docker/docker-compose.yml`),
  creates a Studio dashboard via REST with synthetic aircraft from
  `makeresults`, then asserts in a headless browser that the radar canvas
  paints and the sweep animates — and captures a render screenshot artifact.

**Splunk Enterprise note:** Studio custom visualizations are behind a feature
flag that is off by default on Enterprise (Cloud has it enabled). The docker
harness mounts it; for a manual install add to
`$SPLUNK_HOME/etc/system/local/web-features.conf` and restart:

```ini
[feature:dashboard_studio]
activate_studio_extension_framework = true
```

## License
Apache-2.0.
