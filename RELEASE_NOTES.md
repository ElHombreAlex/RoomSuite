## RoomSuite 2.1.3

- MCP connections now advertise a focused set of common tools plus discovery by default, reducing schema overhead. Set `ROOMSUITE_MCP_MODE=full` for the previous complete direct-tool list, or `compact` for the smallest list.
- Cliproom exports silent H.264 MP4 without requiring an audio encoder. When a browser can record H.264/Opus but lacks native AAC, the optional MCP component converts audio locally to AAC while retaining video. It reports failure instead of silently discarding audio. Offline export remains WebM-only.
- DeckSuite adds per-slide title and body typography controls, clipping warnings, and supported typography in PDF and PowerPoint export. VectorRoom adds more fonts, bold and italic, alignment, line height, letter spacing and multiline SVG text. Fonts depend on the recipient's system.
- Includes explicit silent and audible MP4 checks on Linux Chromium and the bundled Windows installer.

## Windows installation

Download **RoomSuite-Setup.exe** and run it. Choose the MCP option to include agent tools, the AAC fallback and headless rendering. Close RoomSuite before updating and select the MCP component again if you use it. Your RoomSuite data is stored separately from the installed program.

The installer includes Node.js and is unsigned, so Windows may display an unfamiliar-publisher warning. **SHA256SUMS.txt** contains the installer's checksum; it is not a publisher signature. See the README and MCP guide for setup, compatibility notes, data storage and backups.
