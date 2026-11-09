// Fetching an app's client metadata document (CIMD) without letting it point Rodeo's server at
// itself or its network: https only, every address the name resolves to must be public (RFC 6890),
// no redirects, five seconds, 5 KB.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Two lists, not one: a BlockList also matches an IPv4 address against an IPv6 rule for mapped
// addresses (::ffff:0:0/96), so one list would refuse every public IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
const V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: readonly (readonly [string, number])[] = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];
for (const [net, bits] of V4) BLOCKED_V4.addSubnet(net, bits, "ipv4");
for (const [net, bits] of V6) BLOCKED_V6.addSubnet(net, bits, "ipv6");

/** Whether an address is one an app's document may never be fetched from: private, loopback, link-local, reserved. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 6 ? BLOCKED_V6.check(address, "ipv6") : BLOCKED_V4.check(address, "ipv4");
}

/** A DNS lookup for node:https that fails when any address of the name is blocked (so a rebinding name can't slip one in). */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    const list = addresses as unknown as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = Object.assign(new Error(`${hostname} isn't a public address`), { code: "EBLOCKED" });
      callback(blocked, "", 4);
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
};

/** A metadata document as fetched: its parsed body, and how long its HTTP headers let Rodeo keep it (null: not said). */
export interface FetchedDoc {
  readonly body: unknown;
  readonly maxAgeMs: number | null;
}

/** How long a Cache-Control header lets a document be kept, in ms: 0 for no-store or no-cache, null when it says nothing usable. */
export function maxAgeOf(cacheControl: string | undefined): number | null {
  if (!cacheControl) return null;
  const v = cacheControl.toLowerCase();
  if (/(^|,)\s*(no-store|no-cache)\s*(,|$)/.test(v)) return 0;
  const m = /(^|,)\s*max-age=(\d+)\s*(,|$)/.exec(v);
  return m ? Number(m[2]) * 1000 : null;
}

/**
 * Reads a response as a JSON document. It refuses anything that isn't a 200 JSON answer, and a body
 * over maxBytes, and says why in a short message. Redirects count as errors: they are never followed.
 */
export function readDoc(res: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const status = res.statusCode ?? 0;
    if (status !== 200) {
      // dropping the response, not reading it, so a large error page costs nothing
      res.destroy();
      reject(new Error(`it answered ${status}`));
      return;
    }
    const type = String(res.headers["content-type"] ?? "").toLowerCase();
    if (!type.includes("json")) {
      res.destroy();
      reject(new Error("it isn't JSON"));
      return;
    }
    // a missing or odd header is NaN, which is not over the limit: the byte count below still applies
    if (Number(res.headers["content-length"]) > maxBytes) {
      res.destroy();
      reject(new Error("it's larger than 5 KB"));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(new Error("it's larger than 5 KB"));
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("it isn't valid JSON"));
      }
    });
    res.on("error", reject);
  });
}

/**
 * Fetches an app's metadata document from an https address on a public name. Rejects with a short
 * reason the consent page can show. It never follows a redirect and gives up after five seconds.
 */
export async function fetchClientDoc(url: string, userAgent: string): Promise<FetchedDoc> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.port !== "") throw new Error("an app's document must be https on the default port");
  // Node skips the lookup for an address written as a number, so such a host would bypass the guard
  if (u.hostname.startsWith("[") || isIP(u.hostname) !== 0) throw new Error("an app's document must be on a named public host");
  return new Promise<FetchedDoc>((resolve, reject) => {
    const req = request(u, {
      method: "GET",
      agent: false,
      lookup: guardedLookup,
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
    }, 5000);
    // one place to settle, so the timer is always cleared and a timeout reads as a timeout
    const stop = (err: Error) => {
      clearTimeout(timer);
      reject(timedOut ? new Error("it took longer than 5 seconds") : err);
    };
    req.on("response", (res) => {
      readDoc(res, 5 * 1024).then((body) => {
        clearTimeout(timer);
        resolve({ body, maxAgeMs: maxAgeOf(res.headers["cache-control"]) });
      }, stop);
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EBLOCKED") stop(new Error(`${u.hostname} isn't a public address`));
      else stop(new Error(`it couldn't be reached (${err.code ?? err.message})`));
    });
    req.end();
  });
}
