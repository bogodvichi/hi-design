import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureCodexCliForInstalledCodex } from "../src/codex-cli-bootstrap.js";

describe("official Codex installer transfer budget", () => {
  it.skipIf(process.platform === "win32")("allows slow CDN assets while retaining metadata limits and installer verification", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "codex-installer-"));
    try {
      const tools = path.join(home, "tools");
      const bin = path.join(home, ".local", "bin");
      await mkdir(tools);
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, "codex"), '#!/bin/sh\nprintf "codex-cli 0.165.0\\n"\n', { mode: 0o755 });
      await writeFile(path.join(home, "new-cli"), '#!/bin/sh\nprintf "codex-cli 0.166.0\\n"\n', { mode: 0o755 });
      await writeFile(path.join(home, "official-installer"), `set -eu
curl --max-time 30 https://releases.openai.com/codex/channels/latest
curl --max-time 30 https://releases.openai.com/codex/releases/0.166.0
curl --max-time 300 https://releases.openai.com/codex/releases/0.166.0/package.tar.gz
test -f "$HOME/verified-asset"
cp "$HOME/new-cli" "$CODEX_INSTALL_DIR/codex"
`);
      await writeFile(path.join(tools, "curl"), `#!/bin/sh
set -eu
case "$*" in
  *https://chatgpt.com/codex/install.sh*) cat "$HOME/official-installer"; exit 0 ;;
esac
limit=""
previous=""
for argument do
  if [ "$previous" = "--max-time" ]; then limit="$argument"; fi
  previous="$argument"
done
case "$*" in
  *channels/latest*|*releases/0.166.0) test "$limit" = "30" ;;
  *releases/0.166.0/*)
    if [ "$limit" -le 300 ]; then echo "curl: (28) transfer exceeded 300 seconds" >&2; exit 28; fi
    touch "$HOME/verified-asset" ;;
esac
`, { mode: 0o755 });
      const result = await ensureCodexCliForInstalledCodex({
        home, platform: "darwin",
        env: { HOME: home, PATH: `${tools}:${bin}:/usr/bin:/bin`, CODEX_INSTALL_DIR: bin },
        getLatestVersion: async () => "0.166.0",
      });
      expect(result).toMatchObject({ status: "updated", fromVersion: "0.165.0", toVersion: "0.166.0" });
      expect(await readFile(path.join(home, "verified-asset"), "utf8")).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
