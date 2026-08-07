# Athens Bus Tracker

A compact, installable personal web app for nearby OASA bus stops, live
arrivals, a clickable stop map, multi-line arrival alerts, and named favorite
presets.

Choose a stop once to open its live 15-minute arrival timeline. Every physical
bus is shown separately, including buses sharing a line code. Tapping a bus
toggles continuous tracking for that line: selected lines notify normally at
one minute and urgently when due, then continue with the next bus on the line.

**Live app:** [https://bus.themos.dev](https://bus.themos.dev)

## Stop catalogue

The browser downloads one static stop catalogue generated from OASA's official GTFS
feed. Nearby ranking, name search, and map filtering then run locally without Worker
requests. Refresh the generated catalogue when the feed changes:

```bash
pnpm sync:stops
```

The catalogue powers stop discovery and stop details. Serving routes and live
arrivals are fetched from OASA Telematics through the Worker; route metadata is
cached because it changes much less often than arrivals.

## Cloudflare Workers

Build and test the app in the Workers runtime:

```bash
pnpm preview
```

Deploy it to the configured `athens-bus-alerts` Worker:

```bash
pnpm deploy
```
