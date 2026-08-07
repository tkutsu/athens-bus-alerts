import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/stops/[stopCode]/route";

describe("stop route metadata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses one upstream request and returns a cacheable route-only payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            RouteCode: "2810",
            hidden: "0",
            RouteDescr: "Piraeus - Dafni",
            RouteDescrEng: "Piraeus - Dafni",
            LineID: "218",
            LineDescr: "Line 218",
            LineDescrEng: "Line 218",
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/stops/400075"), {
      params: Promise.resolve({ stopCode: "400075" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "act=webRoutesForStop",
    );
    expect(await response.json()).toEqual({
      routes: [
        {
          routeCode: "2810",
          lineId: "218",
          description: "Piraeus - Dafni",
        },
      ],
    });
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=86400");
  });
});
