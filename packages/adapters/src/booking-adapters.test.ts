import { describe, expect, it } from "vitest";
import { createFakeGeocoder } from "./geocoding/fake";
import { createPhotonGeocoder } from "./geocoding/photon";
import { createFakeSms } from "./sms/fake";
import { createFakeStorage } from "./storage/fake";
import { createSupabaseStorage } from "./storage/supabase";

function recordingFetch(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(answer(call.url, call.init));
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("fake sms", () => {
  it("keeps what was sent", async () => {
    const sms = createFakeSms();
    await sms.send({ to: "+46701740601", body: "första" });
    await sms.send({ to: "+46701740601", body: "andra" });
    expect(sms.sent).toHaveLength(2);
    expect(sms.lastTo("+46701740601")).toBe("andra");
    expect(sms.lastTo("+46701740602")).toBeUndefined();
  });
});

describe("Photon geocoder", () => {
  const features = {
    features: [
      {
        geometry: { coordinates: [18.62, 59.31] },
        properties: {
          street: "Bryggvägen",
          housenumber: "12",
          city: "Värmdö",
          countrycode: "SE",
        },
      },
      {
        geometry: { coordinates: [18.7, 59.31] },
        properties: {
          name: "Djurö Båtvarv",
          street: "Varvsvägen",
          city: "Djurhamn",
          countrycode: "SE",
        },
      },
      {
        geometry: { coordinates: [24.9, 60.2] },
        properties: { name: "Bryggvägen", city: "Helsingfors", countrycode: "FI" },
      },
    ],
  };

  it("searches near a point and keeps Swedish results", async () => {
    const { fetch, calls } = recordingFetch(() => Response.json(features));
    const geocoder = createPhotonGeocoder({ baseUrl: "http://photon.test/", fetch });

    const results = await geocoder.search("Bryggvägen 12", { near: { lng: 18.6, lat: 59.3 } });

    expect(results).toEqual([
      { label: "Bryggvägen 12, Värmdö", position: { lng: 18.62, lat: 59.31 } },
      { label: "Djurö Båtvarv, Varvsvägen, Djurhamn", position: { lng: 18.7, lat: 59.31 } },
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("http://photon.test/api/");
    expect(url.searchParams.get("q")).toBe("Bryggvägen 12");
    expect(url.searchParams.get("lat")).toBe("59.3");
    expect(url.searchParams.get("lon")).toBe("18.6");
  });

  it("does not ask for very short queries and keeps the address out of errors", async () => {
    const { fetch, calls } = recordingFetch(() => new Response("busy", { status: 503 }));
    const geocoder = createPhotonGeocoder({ fetch });
    expect(await geocoder.search("ab")).toEqual([]);
    expect(calls).toHaveLength(0);
    await expect(geocoder.search("Bryggvägen 12")).rejects.toThrow(/^Photon answered 503$/);
  });

  it("has a fake with a few addresses", async () => {
    const geocoder = createFakeGeocoder();
    expect((await geocoder.search("djurö")).map((r) => r.label)).toEqual(["Sjöstigen 4, Djurö"]);
  });
});

describe("Supabase storage", () => {
  it("creates the private bucket once and uploads with the service key", async () => {
    const { fetch, calls } = recordingFetch((url) =>
      url.endsWith("/bucket")
        ? Response.json({ error: "Duplicate" }, { status: 409 })
        : Response.json({}),
    );
    const storage = createSupabaseStorage({
      url: "http://supabase.test/",
      serviceRoleKey: "service-key",
      bucket: "attachments",
      fetch,
    });

    await storage.put("t1/jobs/j1/drev.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    await storage.put("t1/jobs/j1/motor.jpg", new Uint8Array([4]), "image/jpeg");

    expect(calls.map((c) => c.url)).toEqual([
      "http://supabase.test/storage/v1/bucket",
      "http://supabase.test/storage/v1/object/attachments/t1/jobs/j1/drev.jpg",
      "http://supabase.test/storage/v1/object/attachments/t1/jobs/j1/motor.jpg",
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ public: false });
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer service-key");
    expect(headers["Content-Type"]).toBe("image/jpeg");
  });

  it("fails without the key in the message", async () => {
    const { fetch } = recordingFetch(() => new Response("no", { status: 403 }));
    const storage = createSupabaseStorage({
      url: "http://supabase.test",
      serviceRoleKey: "secret-service-key",
      bucket: "b",
      fetch,
    });
    await expect(storage.put("t/x.jpg", new Uint8Array([1]), "image/jpeg")).rejects.toThrow(
      /^Supabase Storage could not create the bucket: 403$/,
    );
  });

  it("has a fake that refuses to overwrite", async () => {
    const storage = createFakeStorage();
    await storage.put("t/a.jpg", new Uint8Array([1]), "image/jpeg");
    await expect(storage.put("t/a.jpg", new Uint8Array([2]), "image/jpeg")).rejects.toThrow();
    expect(storage.objects.get("t/a.jpg")?.contentType).toBe("image/jpeg");
  });
});
