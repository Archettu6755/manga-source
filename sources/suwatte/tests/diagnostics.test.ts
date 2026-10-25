import assert from "node:assert/strict";
import test from "node:test";
import { DIAGNOSTIC_SOURCES, diagnoseSource, diagnosticContext, failureKind, networkError, observeDiagnosticRequest,
  sanitizeDiagnosticMessage, SourceError, type DiagnosticProbe } from "@archettu/manga-core";

function probe(overrides: Partial<DiagnosticProbe> = {}): DiagnosticProbe {
  return { source: "komiic", reader: "fixture", sourceId: "stable-source", version: 1,
    browse: async () => [{ id: "comic" }], search: async () => [{ id: "comic" }], details: async () => ({}),
    chapters: async () => [{ id: "chapter" }], pages: async () => ["https://images.example/page"], image: async () => true, ...overrides };
}

test("One diagnostic contract covers all five sources and reports each requested stage", async () => {
  for (const source of DIAGNOSTIC_SOURCES) {
    const report = await diagnoseSource(probe({ source }), diagnosticContext(), { stage: "pages", proxy: true });
    assert.equal(report.source, source);
    assert.equal(report.network, "existing-proxy");
    assert.equal(report.status, "passed");
    assert.deepEqual(report.stages.map(step => step.stage), ["browse", "search", "details", "chapters", "pages"]);
    assert.ok(report.stages.every(step => step.status === "passed"));
  }
});

test("HTTP restrictions stop all later steps and prevent a caught error from triggering a mirror request", async () => {
  for (const status of [210, 401, 402, 403, 429, 451]) {
    const context = diagnosticContext();
    let requests = 0;
    const send = async () => { requests++; return { status, body: "{}" }; };
    const report = await diagnoseSource(probe({ browse: async () => {
      try { await observeDiagnosticRequest(context, "GET", "https://komiic.cc/api/query", send); }
      catch { await observeDiagnosticRequest(context, "GET", "https://komiic.com/api/query", send); }
      return [];
    } }), context, { stage: "image", proxy: false });
    assert.equal(requests, 1);
    assert.equal(context.requests.length, 1);
    assert.equal(report.status, "restricted");
    assert.equal(report.stages[0].status, "failed");
    assert.ok(report.stages.slice(1).every(step => step.status === "skipped"));
    assert.equal(report.requests[0].status, status);
  }
});

test("API permission responses at HTTP 200 are reported as restrictions without requesting another chapter", async () => {
  for (const body of [{ code: 210 }, { data: { data: { canRead: false } } }, { errors: [{ message: "token is expired" }] }]) {
    const context = diagnosticContext();
    const report = await diagnoseSource(probe({ details: () => observeDiagnosticRequest(context, "POST", "https://api.example/query", async () => ({ status: 200, body: JSON.stringify(body) })) }), context, { stage: "pages", proxy: false });
    assert.equal(report.status, "restricted");
    assert.equal(report.stages.find(step => step.stage === "chapters")!.status, "skipped");
    assert.equal(report.requests.length, 1);
    if ("code" in body) assert.match(report.stages[2].message!, /API 210/);
  }
});

test("Empty search results remain distinct from transport failures and image HEAD restrictions", async () => {
  const empty = await diagnoseSource(probe({ search: async () => [] }), diagnosticContext(), { stage: "pages", proxy: false });
  assert.equal(empty.status, "partial");
  assert.equal(empty.stages[1].status, "empty");
  assert.equal(empty.stages.at(-1)!.status, "passed");
  const offline = await diagnoseSource(probe({ browse: async () => { throw networkError(new Error("fetch failed"), "https://marketing.aiacgn.com/path?request_id=fixture"); } }), diagnosticContext(), { stage: "pages", proxy: false });
  assert.equal(offline.status, "unreachable");
  assert.match(offline.stages[0].message!, /大陆参数服务/);
  const skipped = await diagnoseSource(probe({ image: async () => false }), diagnosticContext(), { stage: "image", proxy: false });
  assert.equal(skipped.status, "partial");
  assert.equal(skipped.stages.at(-1)!.status, "skipped");
});

test("Diagnostic reports omit credentials, query parameters, cookies and device identifiers", async () => {
  const context = diagnosticContext();
  const report = await diagnoseSource(probe({ browse: async () => {
    await observeDiagnosticRequest(context, "GET", "https://fixture-user:fixture-pass@api.example/private?token=fixture-token", async () => {
      throw new Error("fetch failed cookie=fixture-cookie password=fixture-password device_id=fixture-device");
    });
    return [];
  } }), context, { stage: "pages", proxy: true });
  assert.equal(report.requests[0].origin, "api.example");
  assert.doesNotMatch(JSON.stringify(report), /fixture-user|fixture-pass|fixture-token|fixture-cookie|fixture-password|fixture-device|\/private/);
  const text = sanitizeDiagnosticMessage("HTTP 403 https://user:fixture-pass@api.example/private?token=fixture-token Authorization=Bearer fixture-bearer cookie=fixture-cookie");
  assert.match(text, /HTTP 403/);
  assert.doesNotMatch(text, /fixture-pass|fixture-token|fixture-bearer|fixture-cookie|\/private/);
  const cookies = sanitizeDiagnosticMessage("HTTP 403 Cookie: session=fixture-session; refresh=fixture-refresh, other=fixture-other\n权限受限");
  assert.doesNotMatch(cookies, /fixture-session|fixture-refresh|fixture-other/);
  assert.match(cookies, /权限受限/);
});

test("Diagnostics enforce request budgets and preserve a restriction when the response body fails", async () => {
  const context = diagnosticContext(1);
  await observeDiagnosticRequest(context, "GET", "https://api.example/one", async () => ({ status: 200, body: "{}" }));
  let called = false;
  await assert.rejects(() => observeDiagnosticRequest(context, "GET", "https://api.example/two", async () => { called = true; return { status: 200, body: "{}" }; }), /数量上限/);
  assert.equal(called, false);
  const restricted = diagnosticContext();
  await assert.rejects(() => observeDiagnosticRequest(restricted, "GET", "https://api.example/", async record => { record.status = 403; throw new Error("terminated"); }), /访问受限/);
  assert.equal(restricted.stopped!.kind, "restricted");
  assert.equal(failureKind(new SourceError("缺少数据", "empty")), "empty");
  assert.equal(failureKind(new Error("UND_ERR_CONNECT_TIMEOUT")), "timeout");
  assert.equal(failureKind(new SyntaxError("Unexpected token")), "format");
});
