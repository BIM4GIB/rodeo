// Requests to the drive services: a network failure and an error answer both
// become a message a person can act on, from the service's own error text when
// it gives one.

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** The service's error text from a JSON body ({ error: string } or { error: { message } }), or "". */
function detailOf(body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

/** The error for a request that answered with a failure status. */
export async function failure(res: Response, service: string): Promise<DriveError> {
  let detail = "";
  try {
    detail = detailOf(await res.json());
  } catch {
    // not JSON: the status alone
  }
  const more = detail ? `: ${detail}` : ".";
  if (res.status === 401) return new DriveError(`${service} needs you to sign in again.`, 401);
  if (res.status === 403) return new DriveError(`${service} refused the request${more}`, 403);
  if (res.status === 404) return new DriveError(`That file is no longer in ${service}.`, 404);
  if (res.status === 429) return new DriveError(`${service} is busy. Try again in a moment.`, 429);
  return new DriveError(`${service} failed (${res.status})${more}`, res.status);
}

/** fetch() with a readable message when the request never gets an answer. */
export async function send(url: string, init: RequestInit, service: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new DriveError(`Could not reach ${service}. Check the connection and try again.`);
  }
}

/** A byte array as a request body (a copy, so it can be sent again on a retry). */
export function blob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]);
}
