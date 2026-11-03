// Where the sun is for a latitude, a day of the year and a solar time, and the times a Heliodon
// shows: the usual declination and hour-angle approximation, which Vectorworks' Heliodon uses too
// (the demos' Heliodons' altitudes and azimuths agree with it to a hundredth of a degree), and
// sunrise and sunset with the sun's centre 0.833° below the horizon, in clock time.

import type { HeliodonSun } from "./types.ts";

export interface SunPlace {
  /** unit vector towards the sun in drawing coordinates (x east, y north when north is 0, z up) */
  readonly dir: { readonly x: number; readonly y: number; readonly z: number };
  /** degrees above the horizon */
  readonly altitude: number;
  /** degrees clockwise from north */
  readonly azimuth: number;
}

const RAD = Math.PI / 180;
/** how far below the horizon the sun's centre is at sunrise and sunset (refraction and its radius), degrees */
const HORIZON = -0.833;

function declination(dayOfYear: number): number {
  return -23.44 * RAD * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
}

/** Where the sun is: `north` is the drawing's north, degrees counter-clockwise from its +y axis. */
export function sunPlace(v: { latitude: number; dayOfYear: number; hour: number; north: number }): SunPlace {
  const lat = v.latitude * RAD;
  const decl = declination(v.dayOfYear);
  const hourAngle = 15 * RAD * (v.hour - 12);
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // from north, clockwise: east in the morning (negative hour angle), south at noon north of the tropics
  const az = Math.atan2(-Math.sin(hourAngle) * Math.cos(decl), Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle));
  const east = Math.sin(az) * Math.cos(alt);
  const north = Math.cos(az) * Math.cos(alt);
  // the drawing's north turns the compass
  const t = v.north * RAD;
  return {
    dir: { x: east * Math.cos(t) - north * Math.sin(t), y: east * Math.sin(t) + north * Math.cos(t), z: Math.sin(alt) },
    altitude: alt / RAD,
    azimuth: ((az / RAD) % 360 + 360) % 360,
  };
}

/** The equation of time on `dayOfYear`, minutes: how far solar time runs ahead of mean time. */
export function equationOfTime(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/** Sunrise and sunset in solar time, hours (in a polar day 0 and 24, in a polar night both 12). */
export function sunriseSunset(latitude: number, dayOfYear: number): { rise: number; set: number } {
  const lat = latitude * RAD;
  const decl = declination(dayOfYear);
  const cos = (Math.sin(HORIZON * RAD) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const half = Math.acos(Math.max(-1, Math.min(1, cos))) / RAD / 15;
  return { rise: 12 - half, set: 12 + half };
}

/** 1 for 1 January to 365 for 31 December (a year of 365 days); `month` 1 to 12. */
export function dayOfYear(month: number, day: number): number {
  return Math.round((Date.UTC(2025, month - 1, day) - Date.UTC(2025, 0, 1)) / 864e5) + 1;
}

/** The plug-in a Heliodon is, by name. */
export const HELIODON = "Heliodon";

/** The months as a Heliodon names them, January first. */
export const MONTHS: readonly string[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The parameters of a Heliodon a change to which moves its sun. */
export const HELIODON_INPUTS: ReadonlySet<string> = new Set(["__Latitude", "__NorthSouth", "__Longitude", "__EastWest", "StdMeridian", "DaylightSavings", "UseSolarTime", "Time", "Day", "Month"]);

type Fields = ReadonlyMap<string, number | boolean | string>;

/** "4:45" for a time in hours. */
function clock(hours: number): string {
  const m = Math.round((((hours % 24) + 24) % 24) * 60) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Hours from "16:30", "4:30 PM", null when it says no time. */
function readClock(text: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(text);
  if (!m) return null;
  let h = +m[1] % (m[3] ? 12 : 24);
  if (m[3] && /p/i.test(m[3])) h += 12;
  return h + +m[2] / 60;
}

/** "136° 17'": degrees and minutes, rounded to the minute. */
function degrees(deg: number): string {
  const a = Math.round(Math.abs(deg) * 60);
  return `${deg < 0 && a > 0 ? "-" : ""}${Math.floor(a / 60)}° ${a % 60}'`;
}

/** Hours a Heliodon's clock runs ahead of solar time: its time zone's meridian against its longitude, the equation of time, daylight saving. */
function clockAhead(f: Fields, longitude: number, day: number): number {
  const zone = /GMT\s*([+-])(\d{1,2}):(\d{2})/.exec(String(f.get("StdMeridian") ?? ""));
  const meridian = zone ? (zone[1] === "-" ? -1 : 1) * (+zone[2] + +zone[3] / 60) * 15 : longitude;
  return (meridian - longitude) / 15 - equationOfTime(day) / 60 + (f.get("DaylightSavings") === true ? 1 : 0);
}

/** A Heliodon's sun from its parameters, by name; null when they don't say one. */
export function readHeliodonSun(f: Fields): HeliodonSun | null {
  const lat = f.get("__Latitude");
  const lon = f.get("__Longitude");
  const month = MONTHS.indexOf(String(f.get("Month") ?? "")) + 1;
  const day = Number(f.get("Day"));
  const time = readClock(String(f.get("Time") ?? ""));
  if (typeof lat !== "number" || typeof lon !== "number" || !month || !(day >= 1 && day <= 31) || time === null) return null;
  const latitude = f.get("__NorthSouth") === "S" ? -lat : lat;
  const longitude = f.get("__EastWest") === "W" ? -lon : lon;
  const n = dayOfYear(month, day);
  const solar = f.get("UseSolarTime") !== false;
  const ahead = clockAhead(f, longitude, n);
  const hour = solar ? time : time - ahead;
  const place = sunPlace({ latitude, dayOfYear: n, hour, north: 0 });
  const { rise, set } = sunriseSunset(latitude, n);
  return {
    latitude,
    longitude,
    month,
    day,
    hour,
    solar,
    zone: String(f.get("StdMeridian") ?? ""),
    daylightSaving: f.get("DaylightSavings") === true,
    altitude: place.altitude,
    azimuth: place.azimuth,
    sunrise: clock(rise + ahead),
    sunset: clock(set + ahead),
  };
}

/**
 * The parameters a Heliodon set to `next` (latitude, date and solar time; the rest as it has them)
 * has, by name, among them those it works out and shows (the solar time, altitude, azimuth,
 * sunrise and sunset), written as Vectorworks writes them.
 */
export function heliodonFields(f: Fields, next: Pick<HeliodonSun, "latitude" | "month" | "day" | "hour">): Record<string, string | number> {
  const lon = f.get("__Longitude");
  const longitude = (typeof lon === "number" ? lon : 0) * (f.get("__EastWest") === "W" ? -1 : 1);
  const n = dayOfYear(next.month, next.day);
  const ahead = clockAhead(f, longitude, n);
  const solar = f.get("UseSolarTime") !== false;
  const place = sunPlace({ latitude: next.latitude, dayOfYear: n, hour: next.hour, north: 0 });
  const { rise, set } = sunriseSunset(next.latitude, n);
  const az = place.azimuth;
  const minutes = Math.round((((next.hour % 24) + 24) % 24) * 60) % 1440;
  return {
    __Latitude: Math.abs(next.latitude),
    __NorthSouth: next.latitude < 0 ? "S" : "N",
    Month: MONTHS[next.month - 1],
    Day: String(next.day),
    Time: clock(solar ? next.hour : next.hour + ahead),
    SolarTime: clock(next.hour),
    SolarAltitude: `${degrees(place.altitude)} `,
    SolarAzimuth: `${degrees(az)} [${az <= 180 ? `${degrees(az)} east` : `${degrees(360 - az)} west`}]`,
    Sunrise: clock(rise + ahead),
    Sunset: clock(set + ahead),
    __C4DHours: Math.floor(minutes / 60),
    __C4DMinutes: minutes % 60,
    __C4DDay: next.day,
    __C4DMonth: next.month,
  };
}

/** The way a Heliodon's light shines, away from the sun: level when the sun is below the horizon. */
export function heliodonLight(sun: Pick<HeliodonSun, "altitude" | "azimuth">): [number, number, number] {
  const alt = Math.max(0, sun.altitude) * RAD;
  const az = sun.azimuth * RAD;
  return [-Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), -Math.sin(alt)];
}
