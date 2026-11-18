# <img src="docs/icon.svg" alt="" width="40" align="top"> My Pocket Bus: Athens

Live arrivals for the Athens bus stops around you, and a ping when your bus is
close, so you can stop refreshing the screen. Find a stop nearby, by name or on
the map, and save a stop with the lines you care about as a named favorite to
turn its alerts on in one tap.

It's at [bus.themos.dev](https://bus.themos.dev), and you can install it to your
home screen like an app.

Pick a stop and you get everything arriving in the next 20 minutes on a
timeline, with the ten soonest buses listed on their own, even when two of them
are on the same line. Tap a bus to follow its line. You get a normal
notification when it's a minute away and an urgent one when it's due, then it
moves on to the next bus on that line until you tap it again.

## Stops

The stop list comes from OASA's official GTFS feed, baked into one static file
the browser downloads once. Finding nearby stops, searching by name and
filtering the map all happen in the browser, without asking the server. When
OASA updates the feed, regenerate the file:

```bash
pnpm sync:stops
```

Which lines stop where, and when the next buses arrive, come live from OASA
Telematics through the Worker. Route details change far less often than
arrivals, so those get cached.

## Running it on Cloudflare Workers

Build it and run it locally in the Workers runtime:

```bash
pnpm preview
```

Deploy to the `athens-bus-alerts` Worker:

```bash
pnpm deploy
```
