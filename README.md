# Athens Bus Alerts

A compact, installable personal web app for nearby OASA bus stops, live
arrivals, a clickable stop map, multi-line arrival alerts, and named favorite
presets.

## Stop catalogue

Global stop search uses OASA's official static GTFS feed. Refresh the generated
catalogue when the feed changes:

```bash
pnpm sync:stops
```

The catalogue only powers name/code search and distance ordering. Live stop
details, lines, and arrivals are always fetched from OASA Telematics.
