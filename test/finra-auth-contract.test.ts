#!/usr/bin/env node

/**
 * Behaviour gates for the FINRA HTTP layer. These exercise the real modules
 * with `globalThis.fetch` stubbed, so they fail if the regressions they cover
 * come back:
 *
 *   1. A pre-flight credential check that refuses to call an anonymous API.
 *   2. An Authorization header fabricated when no credentials are configured.
 *   3. The adapter dropping `method`/`body`, which turns a filtered POST into
 *      an unfiltered GET that returns wrong-but-plausible rows.
 *   4. A 401 hit anonymously being relayed as FINRA's opaque message, or
 *      downgraded to a success.
 *
 * Run with `npm run test:regression`. Needs @bio-mcp/shared built
 * (`pnpm --filter @bio-mcp/shared run build`) because the package's exports map
 * points at dist/.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createFinraApiFetch, resolveFinraPath } from "../src/lib/api-adapter.ts";
import { finraFetch, resetFinraTokenCache } from "../src/lib/http.ts";

/** Record every outbound request and answer from a scripted queue. */
function stubFetch(responder) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return responder(String(url), init, calls.length - 1);
    };
    return {
        calls,
        restore() {
            globalThis.fetch = original;
        },
    };
}

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

function headerOf(init, name) {
    return new Headers(init.headers ?? {}).get(name);
}

test("anonymous call reaches FINRA and sends no Authorization header", async () => {
    resetFinraTokenCache();
    const stub = stubFetch(() => json([{ symbolCode: "A" }]));
    try {
        const apiFetch = createFinraApiFetch({});
        const result = await apiFetch({ method: "GET", path: "/short-interest", params: { limit: 1 } });

        assert.equal(stub.calls.length, 1, "expected exactly one upstream request");
        assert.equal(
            stub.calls[0].url,
            "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest?limit=1",
        );
        assert.equal(headerOf(stub.calls[0].init, "authorization"), null);
        assert.equal(result.status, 200);
        assert.deepEqual(result.data, [{ symbolCode: "A" }]);
    } finally {
        stub.restore();
    }
});

test("empty-string secrets count as absent, not as a credential", async () => {
    resetFinraTokenCache();
    const stub = stubFetch(() => json([]));
    try {
        const apiFetch = createFinraApiFetch({ FINRA_CLIENT_ID: "", FINRA_CLIENT_SECRET: "" });
        await apiFetch({ method: "GET", path: "/threshold-list" });

        assert.equal(stub.calls.length, 1, "an empty secret must not trigger a token request");
        assert.equal(headerOf(stub.calls[0].init, "authorization"), null);
    } finally {
        stub.restore();
    }
});

test("api.post forwards the method and the JSON filter body", async () => {
    resetFinraTokenCache();
    const stub = stubFetch(() => json([{ symbolCode: "AAPL" }]));
    try {
        const apiFetch = createFinraApiFetch({});
        const body = {
            limit: 1,
            compareFilters: [{ fieldName: "symbolCode", fieldValue: "AAPL", compareType: "EQUAL" }],
        };
        await apiFetch({ method: "POST", path: "/short-interest", params: {}, body });

        const call = stub.calls[0];
        assert.equal(call.init.method, "POST", "a filtered query must not degrade to a GET");
        assert.equal(call.url, "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest");
        assert.deepEqual(JSON.parse(call.init.body), body);
    } finally {
        stub.restore();
    }
});

test("configured credentials mint a token and attach it as a Bearer", async () => {
    resetFinraTokenCache();
    const stub = stubFetch((url) =>
        url.includes("oauth2/access_token")
            ? json({ access_token: "tok-123", expires_in: 1800 })
            : json([{ symbolCode: "A" }]),
    );
    try {
        const apiFetch = createFinraApiFetch({ FINRA_CLIENT_ID: "id", FINRA_CLIENT_SECRET: "secret" });
        await apiFetch({ method: "GET", path: "/short-interest" });

        assert.equal(stub.calls.length, 2, "expected a token request then the data request");
        assert.match(stub.calls[0].url, /oauth2\/access_token$/);
        assert.equal(headerOf(stub.calls[1].init, "authorization"), "Bearer tok-123");
    } finally {
        stub.restore();
        resetFinraTokenCache();
    }
});

test("an anonymous 401 throws an actionable error and is never a success", async () => {
    resetFinraTokenCache();
    const stub = stubFetch(() => json({ message: "Unauthorized" }, 401));
    try {
        const apiFetch = createFinraApiFetch({});
        await assert.rejects(
            () => apiFetch({ method: "GET", path: "/data/group/fixedIncomeMarket/name/whatever" }),
            (err) => {
                assert.equal(err.status, 401);
                assert.match(err.message, /fixedIncomeMarket/);
                assert.match(err.message, /FINRA_CLIENT_ID/);
                assert.match(err.message, /gateway\.finra\.org/);
                return true;
            },
        );
        assert.equal(stub.calls.length, 1, "no credentials means no token refresh to retry with");
    } finally {
        stub.restore();
    }
});

test("path aliases map onto the anonymous otcMarket group", () => {
    assert.equal(resolveFinraPath("/short-volume"), "/data/group/otcMarket/name/regShoDaily");
    assert.equal(resolveFinraPath("/otc-daily-list"), "/data/group/otcMarket/name/otcDailyList");
    assert.equal(
        resolveFinraPath("/metadata/consolidatedShortInterest"),
        "/metadata/group/otcMarket/name/consolidatedShortInterest",
    );
    // A raw FINRA path passes through untouched.
    assert.equal(
        resolveFinraPath("/data/group/otcMarket/name/weeklySummary"),
        "/data/group/otcMarket/name/weeklySummary",
    );
});

test("finraFetch sends no Authorization header when only one half of the pair is set", async () => {
    resetFinraTokenCache();
    const stub = stubFetch(() => json([]));
    try {
        await finraFetch("/data/group/otcMarket/name/thresholdList", { limit: 1 }, { clientId: "id" });
        assert.equal(stub.calls.length, 1);
        assert.equal(headerOf(stub.calls[0].init, "authorization"), null);
    } finally {
        stub.restore();
    }
});
