import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse as parseStream } from "csv-parse";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";

const BUS_GTFS_URL =
  "https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057/resource/119db488-16ea-4c76-b560-41c472872390/download/osy_gtfs.zip";
// STASY publishes metro and tram as a RAR, which bsdtar (libarchive) reads.
const RAIL_GTFS_URL =
  "https://data.gov.gr/dataset/4e897a75-975a-4ce7-af65-f32ea01f93b9/resource/5e3858ee-d9ba-48c2-9015-744ea160976d/download/stasy_gtfs.rar";
const RAIL_LINES = ["M1", "M2", "M3", "T6", "T7"];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../public/data/stops.json");

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Download of ${url} failed with HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function parseCsv(bytes) {
  return parse(new TextDecoder().decode(bytes), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/** Bus and trolley stops from OSY, keyed by the stop code OASA Telematics uses. */
async function syncBusStops() {
  const files = unzipSync(await download(BUS_GTFS_URL));
  if (!files["stops.txt"]) {
    throw new Error("The bus GTFS archive did not contain stops.txt");
  }

  const stopsByCode = new Map();
  for (const row of parseCsv(files["stops.txt"])) {
    const code = String(row.stop_id ?? "").trim();
    const name = String(row.stop_name ?? "").trim();
    const latitude = Number(row.stop_lat);
    const longitude = Number(row.stop_lon);

    if (
      !/^\d{1,8}$/.test(code) ||
      !name ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    stopsByCode.set(code, { code, name, latitude, longitude });
  }

  return [...stopsByCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "en", { numeric: true }),
  );
}

/**
 * Metro and tram stations from STASY. The feed lists every platform as its own
 * stop with no line, so lines come from the trips that call there, and
 * platforms sharing a name merge into one station.
 */
async function syncRailStations() {
  const directory = await mkdtemp(join(tmpdir(), "stasy-gtfs-"));
  try {
    const archivePath = join(directory, "stasy_gtfs.rar");
    await writeFile(archivePath, await download(RAIL_GTFS_URL));
    await promisify(execFile)("bsdtar", ["-xf", archivePath, "-C", directory]);

    const readTable = async (name) =>
      parseCsv(await readFile(join(directory, name)));
    const lineByRoute = new Map(
      (await readTable("routes.txt")).map((row) => [
        row.route_id,
        row.route_short_name,
      ]),
    );
    const lineByTrip = new Map(
      (await readTable("trips.txt")).map((row) => [
        row.trip_id,
        lineByRoute.get(row.route_id),
      ]),
    );

    // stop_times.txt runs to tens of megabytes, so it is streamed.
    const linesByPlatform = new Map();
    const stopTimes = createReadStream(join(directory, "stop_times.txt")).pipe(
      parseStream({ bom: true, columns: true, skip_empty_lines: true }),
    );
    for await (const row of stopTimes) {
      const line = lineByTrip.get(row.trip_id);
      if (!RAIL_LINES.includes(line)) continue;
      if (!linesByPlatform.has(row.stop_id)) {
        linesByPlatform.set(row.stop_id, new Set());
      }
      linesByPlatform.get(row.stop_id).add(line);
    }

    const stationsByName = new Map();
    for (const row of await readTable("stops.txt")) {
      const lines = linesByPlatform.get(row.stop_id);
      const latitude = Number(row.stop_lat);
      const longitude = Number(row.stop_lon);
      if (!lines || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }

      const station = stationsByName.get(row.stop_name) ?? {
        name: row.stop_name,
        lines: new Set(),
        platforms: [],
      };
      for (const line of lines) station.lines.add(line);
      station.platforms.push({ latitude, longitude });
      stationsByName.set(row.stop_name, station);
    }

    const average = (values) =>
      Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1e6) / 1e6;

    return [...stationsByName.values()]
      .map(({ name, lines, platforms }) => ({
        name,
        lines: RAIL_LINES.filter((line) => lines.has(line)),
        latitude: average(platforms.map((platform) => platform.latitude)),
        longitude: average(platforms.map((platform) => platform.longitude)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "el"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const [stops, stations] = await Promise.all([
  syncBusStops(),
  syncRailStations(),
]);

const payload = {
  source: BUS_GTFS_URL,
  stationSource: RAIL_GTFS_URL,
  generatedAt: new Date().toISOString(),
  stops,
  stations,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

console.log(
  `Wrote ${stops.length} stops and ${stations.length} stations to ${outputPath}`,
);
