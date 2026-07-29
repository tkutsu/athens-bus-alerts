import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";

const GTFS_URL =
  "https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057/resource/119db488-16ea-4c76-b560-41c472872390/download/osy_gtfs.zip";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../public/data/stops.json");

const response = await fetch(GTFS_URL, {
  signal: AbortSignal.timeout(120_000),
});

if (!response.ok) {
  throw new Error(`GTFS download failed with HTTP ${response.status}`);
}

const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
const stopsFile = files["stops.txt"];

if (!stopsFile) {
  throw new Error("The GTFS archive did not contain stops.txt");
}

const rows = parse(new TextDecoder().decode(stopsFile), {
  bom: true,
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

const stopsByCode = new Map();

for (const row of rows) {
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

  stopsByCode.set(code, {
    code,
    name,
    latitude,
    longitude,
  });
}

const payload = {
  source: GTFS_URL,
  generatedAt: new Date().toISOString(),
  stops: [...stopsByCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "en", { numeric: true }),
  ),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

console.log(`Wrote ${payload.stops.length} stops to ${outputPath}`);
