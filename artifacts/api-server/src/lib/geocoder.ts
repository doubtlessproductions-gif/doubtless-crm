import { logger } from "./logger.js";

interface NominatimResult {
  lat: string;
  lon: string;
}

export async function geocodeCity(
  city: string,
  state?: string | null,
  country?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({ format: "json", limit: "1", addressdetails: "0" });
    params.set("city", city);
    if (state) params.set("state", state);
    if (country) params.set("country", country);

    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "DoubtlessProductionsCRM/1.0 (contact@doubtless.dev)" },
      });
      if (!response.ok) return null;
      const data = await response.json() as NominatimResult[];
      if (!data.length) return null;
      return { lat: parseFloat(data[0]!.lat), lng: parseFloat(data[0]!.lon) };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn({ err, city, state }, "Geocoding failed");
    return null;
  }
}
