import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { getSnowLoad } from "./snowLoadService.js";

// Captured from the public map on 2026-11-04 for Břasy 309/2's ČÚZK
// definition point (49.829316, 13.584631), cell 7032856. Not a design value.
const brasyResponse = { sk0: "0.83", sk: "0.85", mi: "0.31", sigma: "0.20", V: "0.65", alpha: "1.53", error: "" };

test("Břasy recovers sourced snow data after an upstream connection reset", async () => {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    assert.equal(form.get("id"), "7032856");
    assert.equal(form.get("action"), "getData");
    assert.equal(form.get("coords"), "49-49-46_13-35-05");
    requests++;
    if (requests === 1) { req.socket.destroy(); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(brasyResponse));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const oldUrl = process.env.SNOW_LOAD_ONLINE_URL;
  const oldEnabled = process.env.SNOW_LOAD_ONLINE_ENABLED;
  process.env.SNOW_LOAD_ONLINE_URL = `http://127.0.0.1:${address.port}`;
  delete process.env.SNOW_LOAD_ONLINE_ENABLED;
  try {
    const result = await getSnowLoad(49.829316, 13.584631, 467);
    assert.equal(result.sk, Number(brasyResponse.sk));
    assert.match(result.source, /online dotaz getData.php/);
    assert.equal(requests, 2);
  } finally {
    if (oldUrl === undefined) delete process.env.SNOW_LOAD_ONLINE_URL;
    else process.env.SNOW_LOAD_ONLINE_URL = oldUrl;
    if (oldEnabled === undefined) delete process.env.SNOW_LOAD_ONLINE_ENABLED;
    else process.env.SNOW_LOAD_ONLINE_ENABLED = oldEnabled;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Břasy uses the captured official cell during an outage, never a neighbouring cell", async () => {
  const oldEnabled = process.env.SNOW_LOAD_ONLINE_ENABLED;
  process.env.SNOW_LOAD_ONLINE_ENABLED = "false";
  try {
    const result = await getSnowLoad(49.829316, 13.584631, 467);
    assert.equal(result.sk, Number(brasyResponse.sk));
    assert.match(result.source, /7032856/);
    assert.match(result.source, /2026-11-04/);
    const withinCell = await getSnowLoad(49.829317, 13.584631, 467);
    assert.equal(withinCell.sk, Number(brasyResponse.sk));
    const neighbour = await getSnowLoad(49.831316, 13.584631, 467);
    assert.equal(neighbour.sk, null);
  } finally {
    if (oldEnabled === undefined) delete process.env.SNOW_LOAD_ONLINE_ENABLED;
    else process.env.SNOW_LOAD_ONLINE_ENABLED = oldEnabled;
  }
});

test("transient failures are bounded; authoritative rejections do not use an archive", async () => {
  let status = 503;
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ sk: "0.85", error: "Pro tuto souřadnici nejsou známá data" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const oldUrl = process.env.SNOW_LOAD_ONLINE_URL;
  process.env.SNOW_LOAD_ONLINE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const outage = await getSnowLoad(49.829316, 13.584631, 467);
    assert.equal(outage.sk, Number(brasyResponse.sk));
    assert.match(outage.source, /archiv/);
    assert.equal(requests, 3);
    for (status of [404, 200]) {
      requests = 0;
      const result = await getSnowLoad(49.829316, 13.584631, 467);
      assert.equal(result.sk, null);
      assert.equal(requests, 1);
    }
  } finally {
    if (oldUrl === undefined) delete process.env.SNOW_LOAD_ONLINE_URL;
    else process.env.SNOW_LOAD_ONLINE_URL = oldUrl;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("invalid online loads never become engineering values", async () => {
  let value: unknown;
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ sk: value, error: "" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const oldUrl = process.env.SNOW_LOAD_ONLINE_URL;
  process.env.SNOW_LOAD_ONLINE_URL = `http://127.0.0.1:${address.port}`;
  try {
    for (value of ["", " ", "-1", 0, "Infinity", null]) {
      const result = await getSnowLoad(49.829316, 13.584631, 467);
      assert.equal(result.sk, null, `invalid sk: ${JSON.stringify(value)}`);
    }
  } finally {
    if (oldUrl === undefined) delete process.env.SNOW_LOAD_ONLINE_URL;
    else process.env.SNOW_LOAD_ONLINE_URL = oldUrl;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
