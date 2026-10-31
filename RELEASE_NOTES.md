## RoomSuite 2.1.2

- DeckSuite agent calls return slide content with compact, revision-bound image handles by default, avoiding repeated embedded image data. Request `response_mode: "full"` when an integration needs the original image bytes.
- An optional compact MCP mode advertises six discovery and invocation tools and loads individual schemas on demand. Direct tools remain available in the default mode; invalid calls return an error without ending the session.
- GridSuite calculates absolute and mixed references such as `$A$1`, `$A1` and `A$1`, including in ranges and `SUMIF`.
- Cliproom can explicitly request MP4/H.264 with AAC or WebM in the editor and render API. MP4 requires a rendering browser with the relevant codecs; offline rendering remains WebM-only.
- Includes the 2.1 productivity, shared-file, calendar, Office interchange and revision-safety improvements since the previous published Windows installer.

## Windows installation

Download **RoomSuite-Setup.exe** and run it. Choose the MCP option to include agent tools and headless rendering. Close RoomSuite before updating and select the MCP component again if you use it. Your RoomSuite data is stored separately from the installed program.

The installer includes Node.js and is unsigned, so Windows may display an unfamiliar-publisher warning. **SHA256SUMS.txt** contains the installer's checksum; it is not a publisher signature. See the README and MCP guide for setup, compatibility notes, data storage and backups.
