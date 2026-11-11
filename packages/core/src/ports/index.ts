import type { GeoPoint } from "../scheduling/travel";

/** Sends one sms. 46elks in production (phase 3), a fake in tests. */
export interface SmsSender {
  send(message: { to: string; body: string }): Promise<{ id: string }>;
}

export interface GeocodeResult {
  /** For example `Bryggvägen 12, Värmdö`. */
  label: string;
  position: GeoPoint;
}

/** Address search for the booking page. Photon (OpenStreetMap) in production. */
export interface Geocoder {
  search(query: string, options?: { near?: GeoPoint; limit?: number }): Promise<GeocodeResult[]>;
}

/** Files such as pictures of the drive. Supabase Storage in production. */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}
