import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../dist/server.js";

const host = createFakePluginHost({ pluginId: "aws-activate-usage" });
await plugin(host.bb);

const registrations = host.harness.inspection.registrations;
assert.deepEqual(registrations.rpcMethods.sort(), ["aws_login", "credits_summary"]);
assert.equal(registrations.cli?.name, "aws-activate-usage");

await host.harness.lifecycle.dispose();
console.log("Plugin registration smoke test passed.");
