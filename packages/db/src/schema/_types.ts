import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

/** WGS 84, the coordinate system used by GPS and Google Maps. */
export const WGS84 = 4326;

/** A position as longitude and latitude in degrees (WGS 84). */
export interface LngLat {
  lng: number;
  lat: number;
}

/** A polygon as rings of positions. The first ring is the outer edge; each ring is closed. */
export type PolygonRings = LngLat[][];

/** Binary data. Used for encrypted columns; the plaintext never reaches the database. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** A point on the earth. Distances on `geography` are in metres. */
export const geographyPoint = customType<{ data: LngLat; driverData: string }>({
  dataType: () => `geography(Point,${WGS84})`,
  toDriver: (p) => sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), ${WGS84})::geography`,
  fromDriver: (hex) => {
    const reader = new EwkbReader(hex);
    reader.expectType(1);
    return reader.point();
  },
});

/** An area on the earth, for example "Värmdö syd". */
export const geographyPolygon = customType<{ data: PolygonRings; driverData: string }>({
  dataType: () => `geography(Polygon,${WGS84})`,
  toDriver: (rings) => sql`ST_GeogFromText(${polygonToWkt(rings)})`,
  fromDriver: (hex) => {
    const reader = new EwkbReader(hex);
    reader.expectType(3);
    return reader.rings();
  },
});

/** A Postgres `daterange`, kept as its text form, for example `[2026-05-01,2026-10-15)`. */
export const dateRange = customType<{ data: string; driverData: string }>({
  dataType: () => "daterange",
});

export function polygonToWkt(rings: PolygonRings): string {
  const ringText = rings.map(
    (ring) => `(${ring.map((p) => `${String(p.lng)} ${String(p.lat)}`).join(", ")})`,
  );
  return `SRID=${String(WGS84)};POLYGON(${ringText.join(", ")})`;
}

/** Reads the hex EWKB that PostGIS returns for `geography` columns. */
export class EwkbReader {
  private readonly view: DataView;
  private offset = 0;
  private littleEndian = true;

  constructor(hex: string) {
    const bytes = Buffer.from(hex, "hex");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  expectType(geometryType: number): void {
    this.littleEndian = this.view.getUint8(this.offset) === 1;
    this.offset += 1;
    const type = this.uint32();
    if ((type & 0x20000000) !== 0) this.uint32(); // SRID
    if ((type & 0xffff) !== geometryType) {
      throw new Error(`Expected EWKB geometry type ${String(geometryType)}, got ${String(type)}`);
    }
  }

  point(): LngLat {
    const lng = this.view.getFloat64(this.offset, this.littleEndian);
    const lat = this.view.getFloat64(this.offset + 8, this.littleEndian);
    this.offset += 16;
    return { lng, lat };
  }

  rings(): PolygonRings {
    const ringCount = this.uint32();
    return Array.from({ length: ringCount }, () => {
      const pointCount = this.uint32();
      return Array.from({ length: pointCount }, () => this.point());
    });
  }

  private uint32(): number {
    const value = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return value;
  }
}

/** A Postgres `tstzrange`, kept as its text form, for example `["2026-05-04 06:00:00+00","2026-05-04 08:00:00+00")`. */
export const timestampRange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

/** Builds a half-open `tstzrange` literal `[start, end)` from two instants. */
export function timeRange(start: Date, end: Date): string {
  return `[${start.toISOString()},${end.toISOString()})`;
}
