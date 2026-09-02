import { describe, expect, it, vi } from "vitest";
import { fetchTickerMentions, mapRedditListing } from "./reddit.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body } as Response;
}

describe("mapRedditListing", () => {
  it("extrae los títulos y respeta el límite", () => {
    const raw = {
      data: {
        children: [
          { data: { title: "AAPL to the moon", created_utc: 1 } },
          { data: { title: "thoughts on AAPL earnings", created_utc: 2 } },
        ],
      },
    };
    expect(mapRedditListing(raw, 1)).toEqual(["AAPL to the moon"]);
  });

  it("devuelve [] si no hay children", () => {
    expect(mapRedditListing({ data: { children: [] } })).toEqual([]);
  });
});

describe("fetchTickerMentions", () => {
  it("devuelve [] sin credenciales (sin llamar a fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchTickerMentions("AAPL", { fetchImpl });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("obtiene token y luego busca menciones", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { children: [{ data: { title: "AAPL surges", created_utc: 1 } }] } }),
      );
    const result = await fetchTickerMentions("AAPL", {
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });
    expect(result).toEqual(["AAPL surges"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
