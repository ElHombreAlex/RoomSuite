## RoomSuite 2.5.0

- Adds a Mac application and drag-to-Applications installer for Apple silicon and Intel Macs running macOS 14 or later. Each package includes Node.js, MCP tools and headless Chromium.
- The Mac launcher starts and stops the local server, opens the workspace in a browser, and provides MCP configuration. Projects and shared data are kept separately in `~/Library/Application Support/RoomSuite`.
- The release workflow builds and checks the Windows installer and both Mac installers before publishing them with SHA-256 checksums. Linux source installs remain available.

## Installation

On macOS, download `RoomSuite-macOS-arm64.dmg` for Apple silicon or `RoomSuite-macOS-x64.dmg` for Intel, open it and drag RoomSuite into Applications. The Mac app is **unsigned and not notarized**. After attempting to open it, approve it under **System Settings → Privacy & Security**. Camera, microphone and screen capture also need the usual browser and macOS permissions.

On Windows, download `RoomSuite-Setup.exe`. Choose the MCP option to include agent tools and headless rendering. Close RoomSuite before updating and select the MCP component again if you use it. The Windows installer is unsigned.

The checksums detect download corruption; they are not publisher signatures. See the README and platform guides for setup, data storage and backups.
