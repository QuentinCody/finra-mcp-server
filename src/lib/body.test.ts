import {afterEach, expect, it, vi} from "vitest";
import {readBody} from "./market";
afterEach(() => vi.useRealTimers());

it("limits decoded response bytes even with a misleading content length", async () => {
  await expect(readBody(new Response("α".repeat(20), {headers: {"content-length": "2"}}), 30)).rejects.toMatchObject({status: 502});
});
it("rejects an oversized advertised response before reading its body", async () => {
  const response = new Response(new ReadableStream(), {headers: {"content-length": "9999"}});
  await expect(readBody(response, 100)).rejects.toMatchObject({status: 502});
});
it("rejects invalid UTF-8 without silent replacement", async () => {
  await expect(readBody(new Response(new Uint8Array([0xff])))).rejects.toMatchObject({status: 502});
});
it("bounds a stalled body without waiting for unresponsive cancellation", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  const assertion = expect(readBody(new Response(new ReadableStream({cancel})))).rejects.toMatchObject({status: 504});
  await vi.advanceTimersByTimeAsync(15001); await assertion;
  expect(cancel).toHaveBeenCalled();
});
