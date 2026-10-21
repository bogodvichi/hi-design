import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDevAgentEnv } from "../src/agent-env.js";

describe("tools-dev agent environment", () => {
  it("makes the installed Vela and its adjacent OpenCode discoverable without PATH installation", () => {
    const env = { PATH: "" };
    const vela = "/workspace/node_modules/vela-platform/bin/vela";

    assert.deepEqual(resolveDevAgentEnv(env, () => vela), { VELA_BIN: vela });
    assert.deepEqual(env, { PATH: "" });
  });

  it("preserves an explicit Vela selection without consulting the project dependency", () => {
    assert.deepEqual(resolveDevAgentEnv({ VELA_BIN: "/custom/bin/vela" }, () => {
      assert.fail("an explicit Vela selection must take precedence");
    }), {});
  });

  it("leaves existing agent discovery available when the optional Vela package is absent", () => {
    assert.deepEqual(resolveDevAgentEnv({}, () => null), {});
  });

  it("does not replace explicit OpenCode overrides when supplying the default Vela", () => {
    const env = { OPENCODE_BIN: "/custom/opencode", VELA_OPENCODE_BIN: "/custom/companion" };

    assert.deepEqual({ ...env, ...resolveDevAgentEnv(env, () => "/project/bin/vela") }, {
      ...env,
      VELA_BIN: "/project/bin/vela",
    });
  });
});
