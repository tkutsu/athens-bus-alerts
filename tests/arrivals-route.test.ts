import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/stops/[stopCode]/arrivals/route";

function getArrivals(stopCode = "400075") {
  return GET(new Request(`http://localhost/api/stops/${stopCode}/arrivals`), {
    params: Promise.resolve({ stopCode }),
  });
}

describe("live arrival requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares overlapping same-stop misses and gives each caller its own body", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const requests = Array.from({ length: 10 }, () => getArrivals());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(new Response(JSON.stringify([{ route_code: "2810", veh_code: "bus", btime2: "3" }])));
    const bodies = await Promise.all((await Promise.all(requests)).map((response) => response.json()));
    expect(bodies).toHaveLength(10);
    expect(bodies.every((body) => body.arrivals[0].minutes === 3)).toBe(true);
  });

  it("keeps different stops independent and retries after an upstream error", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([getArrivals(), getArrivals("400076")]);
    expect(first.status).toBe(502);
    expect(second.status).toBe(200);
    expect((await getArrivals()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
