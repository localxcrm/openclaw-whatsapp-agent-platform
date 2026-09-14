import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Ajv } from "ajv";

const manifest = JSON.parse(await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
  configSchema: object;
  controlUi?: { entry?: string; styles?: string[] };
};
const validate = new Ajv({ strict: false }).compile(manifest.configSchema);

test("plugin manifest accepts legacy and multi-account configuration", () => {
  assert.equal(validate({ apiToken: "legacy-token", agentId: "main" }), true, JSON.stringify(validate.errors));
  assert.equal(validate({
    accounts: {
      admin: { apiToken: "admin-token", agentId: "demo-admin" },
      sales: { apiToken: "sales-token", agentId: "demo-sales", enabled: true, sessionMode: "main" },
    },
  }), true, JSON.stringify(validate.errors));
});

test("plugin manifest rejects unsafe account ids and incomplete accounts", () => {
  assert.equal(validate({ accounts: { "../Admin": { apiToken: "token", agentId: "main" } } }), false);
  assert.equal(validate({ accounts: { sales: { agentId: "demo-sales" } } }), false);
  assert.equal(validate({ accounts: { sales: { apiToken: "token", agentId: "demo-sales", sessionMode: "shared" } } }), false);
});

test("plugin manifest publishes the prebuilt native Control UI assets", async () => {
  assert.equal(manifest.controlUi?.entry, "dist/control-ui/0.8.1/control-ui.js");
  assert.deepEqual(manifest.controlUi?.styles, ["dist/control-ui/0.8.1/control-ui.css"]);
  await Promise.all([
    readFile(new URL(`../${manifest.controlUi?.entry}`, import.meta.url)),
    readFile(new URL(`../${manifest.controlUi?.styles?.[0]}`, import.meta.url)),
  ]);
});

test("allows an empty account map", () => { assert.equal(validate({ accounts: {}, transport: "channel" }), true); });
