import type {ApiFetchFn} from "@bio-mcp/shared/codemode/catalog";
import type {createFinraTransport, FinraFetchOptions} from "./http";
import {exportLocation, exportRequest, exportResultUrl} from "./export-request";
import {fail, marketEnvelope, readBody} from "./market";

type ExportInput = ReturnType<typeof exportRequest>;
type Transport = ReturnType<typeof createFinraTransport>;

function nativeText(raw: string): unknown {
  try { return JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { return raw; }
}

function pollAfter(value: string | null) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : 60;
  return Number.isFinite(seconds) ? Math.max(60, seconds) : 60;
}

async function observation(response: Response, input: ExportInput) {
  // Credential failures retain status/headers only, consistent with the existing adapter.
  const credentialFailure = response.status === 401 || response.status === 403;
  if (credentialFailure) void response.body?.cancel().catch(() => {});
  const raw = credentialFailure ? "" : await readBody(response);
  const envelope = await marketEnvelope(nativeText(raw), raw, response, input.path,
    input.dataVersion ? {dataVersion: input.dataVersion} : {}, input.query);
  return {...envelope, _mcp: {...envelope._mcp, ...(credentialFailure ? {response_sha256: null} : {})},
    http_status: response.status, raw_response: credentialFailure ? undefined : raw,
    location: response.headers.get("location"), retry_after: response.headers.get("retry-after"),
    credential_error_body_omitted: credentialFailure};
}

async function downloadResult(native: Record<string, unknown>, status: Awaited<ReturnType<typeof observation>>, signal: AbortSignal) {
  const url = exportResultUrl(native.resultLink, native.expires);
  let response: Response;
  try { response = await fetch(url.href, {method: "GET", redirect: "manual", signal}); }
  catch { fail("FINRA export download failed or timed out", 502, {status_observation: status}); }
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); fail("FINRA export deadline exceeded", 504); }
  const raw = await readBody(response, 8 * 1024 * 1024);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const result = {data: nativeText(raw), raw_response: raw, source: {
    url: `${url.origin}${url.pathname}`, // Signed query parameters stay in the native status, not this source label.
    http_status: response.status, retrieved_at: new Date().toISOString(),
    decoded_utf8_sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join(""),
    content_type: response.headers.get("content-type"), etag: response.headers.get("etag"),
    last_modified: response.headers.get("last-modified"), retry_after: response.headers.get("retry-after"),
  }};
  if (response.status !== 200) fail(`FINRA export file HTTP ${response.status}; no redirect or automatic retry`, response.status >= 400 ? response.status : 502, {status_observation: status, download: result});
  return result;
}

async function runExport(input: ExportInput, transport: Transport, options: FinraFetchOptions, signal: AbortSignal) {
  const response = await transport(input.path, {}, {...options, signal, method: input.requestId ? "GET" : "POST",
    dataVersion: input.dataVersion, body: input.query, refreshOnUnauthorized: Boolean(input.requestId)});
  const observed = await observation(response, input);
  const context = {group: input.group, dataset: input.dataset, complete: false,
    complete_dataset_verified: false, observation: observed};
  if (!input.requestId) {
    return exportSubmissionReceipt(observed, input, response, context);
  }
  if (![200, 202].includes(response.status)) fail(`FINRA export status HTTP ${response.status}; verify credential entitlement or retry later`, response.status >= 400 ? response.status : 502, context);
  const native = observed.data;
  if (!native || typeof native !== "object" || Array.isArray(native) || !("requestId" in native) || native.requestId !== input.requestId) {
    fail("FINRA status did not identify the requested export", 502, context);
  }
  const record = native as Record<string, unknown>;
  if (response.status === 202 && record.status === "pending") return {status: 202, data: {...context,
    export_state: "pending", request_id: input.requestId, poll_after_seconds: pollAfter(observed.retry_after)}};
  if (response.status !== 200 || record.status !== "complete") fail("Unrecognized FINRA export status; no result was downloaded", 502, context);
  const result = input.download ? await downloadResult(record, observed, signal).catch(error => {
    const failure = error as {status?: number; data?: Record<string, unknown>};
    fail(error instanceof Error ? error.message : "FINRA export download failed", failure.status ?? 502, {status_observation: observed, ...failure.data});
  }) : undefined;
  return {status: 200, data: {...context, export_state: result ? "downloaded" : "ready", request_id: input.requestId,
    result_path: input.localPrefix + input.requestId + "/result", ...(result ? {result, file_read_complete: true} : {}),
    instruction: "A completed export file does not prove complete dataset coverage or historical point-in-time availability."}};
}

function exportSubmissionReceipt(observed: Awaited<ReturnType<typeof observation>>, input: ExportInput, response: Response, context: { group: string; dataset: string; complete: boolean; complete_dataset_verified: boolean; observation: Awaited<ReturnType<typeof observation>> }) {
  const location = exportLocation(observed.location, input.statusPrefix);
  if (response.status !== 202 || !location) fail("FINRA export receipt did not provide a valid matching status location; submission was not retried", response.status >= 400 ? response.status : 502, {
    ...context, export_submission_outcome: response.status === 202 ? "accepted"
      : response.status >= 400 && response.status < 500 && response.status !== 408 ? "rejected" : "unknown",
  });
  return {
    status: 202, data: {
      ...context, export_state: "accepted", request_id: location.requestId,
      status_path: input.localPrefix + location.requestId, result_path: input.localPrefix + location.requestId + "/result",
      poll_after_seconds: pollAfter(observed.retry_after), instruction: "Resume explicitly after poll_after_seconds; no automatic polling or resubmission."
    }
  };
}

/** Separate, resumable steps; starting an export is never automatically replayed. */
export async function finraExport(request: Parameters<ApiFetchFn>[0], transport: Transport, options: FinraFetchOptions) {
  const input = exportRequest(request.method, request.path, request.params, request.body);
  if (!options.clientId || !options.clientSecret) fail("FINRA exports require both FINRA_CLIENT_ID and FINRA_CLIENT_SECRET, including for authenticated status reads", 503);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([runExport(input, transport, options, controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("FINRA export step exceeded its 50-second deadline"), {status: 504})); }, 50000);
    })]);
  } catch (error) {
    const failure = error && typeof error === "object" ? error as {status?: number; data?: Record<string, unknown>} : {};
    fail(error instanceof Error ? error.message : "FINRA export step failed", failure.status ?? 502, {
      complete: false, ...(input.requestId ? {} : {export_submission_outcome: "unknown"}), ...failure.data,
    });
  } finally { clearTimeout(timer); controller.abort(); }
}
