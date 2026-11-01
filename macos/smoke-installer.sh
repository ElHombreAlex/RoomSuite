#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd -P)"
image="${1:?Pass the path to the installer disk image}"
temp="$(mktemp -d "${TMPDIR:-/tmp}/roomsuite-macos-smoke.XXXXXXXX")"
mounted=0
cleanup() {
  if (( mounted )); then hdiutil detach "$temp/mount" -quiet || true; fi
  rm -rf -- "$temp"
}
trap cleanup EXIT
mkdir -p "$temp/mount" "$temp/Applications with spaces"
hdiutil attach "$image" -readonly -nobrowse -quiet -mountpoint "$temp/mount"
mounted=1
ditto "$temp/mount/RoomSuite.app" "$temp/Applications with spaces/RoomSuite.app"
hdiutil detach "$temp/mount" -quiet
mounted=0
app="$temp/Applications with spaces/RoomSuite.app"
resources="$app/Contents/Resources"
launcher="$app/Contents/MacOS/RoomSuite"
node="$resources/runtime/node"
export ROOMSUITE_APP_DATA="$temp/User Data"
export PLAYWRIGHT_BROWSERS_PATH="$resources/browsers"
unset ROOMSUITE_BROWSER_PATH ROOMSUITE_MCP_MODE ROOMSUITE_MCP_GROUPS || true
export CLIPROOM_PORT="$("$node" -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
mkdir -p "$ROOMSUITE_APP_DATA"
"$launcher" --export-mcp-config "$temp/config.json"
"$node" - "$temp/config.json" "$resources" "$ROOMSUITE_APP_DATA" "$CLIPROOM_PORT" <<'NODE'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const [, , file, resources, data, port] = process.argv;
const config = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.roomsuite;
assert.equal(config.command, path.join(resources, 'runtime/node'));
assert.deepEqual(config.args, [path.join(resources, 'app/mcp/server.mjs')]);
assert.equal(config.env.ROOMSUITE_MCP_WORKSPACE, path.join(data, 'agent-workspace'));
assert.equal(config.env.ROOMSUITE_MCP_URL, `http://127.0.0.1:${port}`);
assert.equal(config.env.PLAYWRIGHT_BROWSERS_PATH, path.join(resources, 'browsers'));
NODE
if "$launcher" --export-mcp-config "$temp/config.json"; then echo 'Config export overwrote an existing file.' >&2; exit 1; fi
"$launcher" --self-test
printf 'preserve' > "$ROOMSUITE_APP_DATA/keep.txt"
"$launcher" --self-test
test "$(cat "$ROOMSUITE_APP_DATA/keep.txt")" = preserve
"$node" "$root/macos/check-browser.cjs" "$resources/app/mcp/node_modules/playwright"
cd "$resources/app"
"$node" --test --test-concurrency=1 mcp/tests/productivity.test.mjs
echo 'Installed Mac application, browser, MCP and data persistence passed.'
