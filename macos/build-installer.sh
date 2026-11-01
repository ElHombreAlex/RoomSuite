#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
if [[ "$(uname -s)" != Darwin ]]; then echo 'Build this installer on macOS.' >&2; exit 1; fi
node_path="$(node -p 'process.execPath')"
node_arch="$(node -p 'process.arch')"
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( major < 20 )); then echo 'Node.js 20 or later is required.' >&2; exit 1; fi
case "$(uname -m):$node_arch" in
  arm64:arm64) arch=arm64 ;;
  x86_64:x64) arch=x64 ;;
  *) echo 'Node must match the native Mac architecture.' >&2; exit 1 ;;
esac
if [[ ! -f "$root/mcp/node_modules/playwright/package.json" ]]; then echo 'Run npm ci --prefix mcp first.' >&2; exit 1; fi
node_license="$(dirname "$(dirname "$node_path")")/LICENSE"
if [[ ! -f "$node_license" ]]; then echo "The Node.js license was not found at $node_license." >&2; exit 1; fi
version="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo 'Invalid package version.' >&2; exit 1; fi
out="${1:-$root/dist}"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
image="$out/RoomSuite-macOS-$arch.dmg"
if [[ -e "$image" ]]; then echo "Installer already exists: $image" >&2; exit 1; fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/roomsuite-macos-build.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
app="$stage/volume/RoomSuite.app"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/runtime" "$stage/volume"
node "$root/windows/prepare-bundle.cjs" "$resources/app"
cp "$node_path" "$resources/runtime/node"
cp "$node_license" "$resources/runtime/NODE-LICENSE.txt"
ditto "$root/mcp/node_modules" "$resources/app/mcp/node_modules"
export PLAYWRIGHT_BROWSERS_PATH="$resources/browsers"
export PLAYWRIGHT_SKIP_BROWSER_GC=1
"$resources/runtime/node" "$resources/app/mcp/node_modules/playwright/cli.js" install chromium --only-shell --no-remove
"$resources/runtime/node" "$root/macos/check-browser.cjs" "$resources/app/mcp/node_modules/playwright"
rm -rf -- "$resources/browsers/.links"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>RoomSuite</string>
<key>CFBundleDisplayName</key><string>RoomSuite</string>
<key>CFBundleIdentifier</key><string>com.roomsuite.app</string>
<key>CFBundleExecutable</key><string>RoomSuite</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>$version</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
export MACOSX_DEPLOYMENT_TARGET=14.0
echo "Compiling the $arch launcher."
swiftc -O -framework Cocoa "$root/macos/RoomSuiteLauncher.swift" -o "$app/Contents/MacOS/RoomSuite"
ln -s /Applications "$stage/volume/Applications"
echo "Creating the $arch disk image."
df -h "$stage" "$out"
hdiutil create -fs HFS+ -volname RoomSuite -srcfolder "$stage/volume" -format UDZO "$image"
echo "Installer created: $image"
