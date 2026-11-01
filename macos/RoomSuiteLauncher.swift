import Cocoa
import Foundation

private struct SuiteError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct Settings {
    let resources: URL
    let data: URL
    let port: Int

    init() throws {
        guard let resources = Bundle.main.resourceURL else { throw SuiteError(message: "RoomSuite's application files could not be found.") }
        self.resources = resources.standardizedFileURL
        let env = ProcessInfo.processInfo.environment
        let portString = env["CLIPROOM_PORT"] ?? "8090"
        guard let port = Int(portString), (1...65535).contains(port) else { throw SuiteError(message: "CLIPROOM_PORT must be between 1 and 65535.") }
        self.port = port
        if let override = env["ROOMSUITE_APP_DATA"], !override.isEmpty {
            data = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        } else {
            data = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/RoomSuite", isDirectory: true)
        }
    }

    var app: URL { resources.appendingPathComponent("app", isDirectory: true) }
    var node: URL { resources.appendingPathComponent("runtime/node") }
    var browsers: URL { resources.appendingPathComponent("browsers", isDirectory: true) }
    var workspace: URL { data.appendingPathComponent("agent-workspace", isDirectory: true) }
    var origin: String { "http://127.0.0.1:\(port)" }
    var url: URL { URL(string: origin + "/")! }

    func environment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["CLIPROOM_PORT"] = String(port)
        env["CLIPROOM_DATA"] = data.appendingPathComponent("data/cliproom").path
        env["ROOMSUITE_DATA"] = data.appendingPathComponent("data/workspace").path
        env["ROOMSUITE_MCP_WORKSPACE"] = workspace.path
        env["ROOMSUITE_MCP_URL"] = origin
        env["PLAYWRIGHT_BROWSERS_PATH"] = browsers.path
        return env
    }

    func jsonConfig() throws -> String {
        let config: [String: Any] = ["mcpServers": ["roomsuite": [
            "command": node.path,
            "args": [app.appendingPathComponent("mcp/server.mjs").path],
            "env": ["ROOMSUITE_MCP_WORKSPACE": workspace.path, "ROOMSUITE_MCP_URL": origin, "PLAYWRIGHT_BROWSERS_PATH": browsers.path]
        ]]]
        let bytes = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        return String(decoding: bytes, as: UTF8.self) + "\n"
    }

    func tomlConfig() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        func quote(_ value: String) throws -> String { String(decoding: try encoder.encode(value), as: UTF8.self) }
        return try """
        [mcp_servers.roomsuite]
        command = \(quote(node.path))
        args = [\(quote(app.appendingPathComponent("mcp/server.mjs").path))]
        tool_timeout_sec = 600

        [mcp_servers.roomsuite.env]
        ROOMSUITE_MCP_WORKSPACE = \(quote(workspace.path))
        ROOMSUITE_MCP_URL = \(quote(origin))
        PLAYWRIGHT_BROWSERS_PATH = \(quote(browsers.path))

        """
    }
}

private final class SuiteServer {
    private let settings: Settings
    private let process = Process()
    private let lock = NSLock()
    private var stopped = false
    private var output = ""
    private var sawStartup = false
    private let ready = DispatchSemaphore(value: 0)

    init(settings: Settings) { self.settings = settings }
    var isRunning: Bool { process.isRunning }

    func start() throws {
        let fm = FileManager.default
        guard fm.isExecutableFile(atPath: settings.node.path), fm.fileExists(atPath: settings.app.appendingPathComponent("server.js").path), fm.fileExists(atPath: settings.app.appendingPathComponent("mcp/node_modules/playwright/package.json").path) else {
            throw SuiteError(message: "RoomSuite's bundled files are missing. Install the application again.")
        }
        for folder in [settings.data.appendingPathComponent("data/cliproom"), settings.data.appendingPathComponent("data/workspace"), settings.workspace] {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        let stdout = Pipe(), stderr = Pipe()
        process.executableURL = settings.node
        process.arguments = [settings.app.appendingPathComponent("server.js").path]
        process.currentDirectoryURL = settings.app
        process.environment = settings.environment()
        process.standardOutput = stdout
        process.standardError = stderr
        for handle in [stdout.fileHandleForReading, stderr.fileHandleForReading] {
            handle.readabilityHandler = { [weak self] h in
                let bytes = h.availableData
                guard !bytes.isEmpty else { h.readabilityHandler = nil; return }
                guard let self = self else { return }
                self.lock.lock()
                if self.output.count < 8000 { self.output += String(decoding: bytes, as: UTF8.self) }
                if !self.sawStartup && self.output.contains("RoomSuite is running at " + self.settings.origin) {
                    self.sawStartup = true
                    self.ready.signal()
                }
                self.lock.unlock()
            }
        }
        process.terminationHandler = { [weak self] _ in self?.ready.signal() }
        lock.lock()
        if stopped { lock.unlock(); throw SuiteError(message: "RoomSuite was closed while starting.") }
        do { try process.run() } catch { lock.unlock(); throw error }
        lock.unlock()
        guard ready.wait(timeout: .now() + 30) == .success else { stop(); throw SuiteError(message: "RoomSuite did not start in time.") }
        lock.lock(); let started = sawStartup; let details = output; lock.unlock()
        guard started && process.isRunning else {
            stop()
            throw SuiteError(message: "RoomSuite could not start. Port \(settings.port) may already be in use.\n\(details)")
        }
        do { try checkDeployment() } catch { stop(); throw error }
        guard process.isRunning else { throw SuiteError(message: "RoomSuite stopped while starting.") }
    }

    private func checkDeployment() throws {
        let check = Process(), done = DispatchSemaphore(value: 0)
        check.executableURL = settings.node
        check.arguments = [settings.app.appendingPathComponent("mcp/check-deployment.mjs").path]
        check.currentDirectoryURL = settings.app
        check.environment = settings.environment()
        check.standardOutput = FileHandle.nullDevice
        check.standardError = FileHandle.nullDevice
        check.terminationHandler = { _ in done.signal() }
        try check.run()
        guard done.wait(timeout: .now() + 120) == .success else {
            if check.isRunning { check.terminate() }
            throw SuiteError(message: "RoomSuite's deployment check timed out.")
        }
        guard check.terminationStatus == 0 else { throw SuiteError(message: "RoomSuite's backend, frontend and MCP files did not pass the deployment check. Install the application again.") }
    }

    func stop() {
        lock.lock(); stopped = true; let running = process.isRunning; lock.unlock()
        if running { process.terminate(); process.waitUntilExit() }
    }
}

private func selfTest(settings: Settings) throws {
    let server = SuiteServer(settings: settings)
    defer { server.stop() }
    try server.start()
    let done = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: settings.url) { _, response, _ in
        ok = (response as? HTTPURLResponse)?.statusCode == 200
        done.signal()
    }.resume()
    guard done.wait(timeout: .now() + 10) == .success, ok else { throw SuiteError(message: "The RoomSuite home page did not respond.") }
}

private final class Launcher: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private let status = NSTextField(wrappingLabelWithString: "Starting your local workspace…")
    private let openButton = NSButton(title: "Open RoomSuite", target: nil, action: nil)
    private var settings: Settings?
    private var server: SuiteServer?
    private var monitor: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit RoomSuite", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem); NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 230), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "RoomSuite"; window.center(); window.delegate = self
        let title = NSTextField(labelWithString: "RoomSuite")
        title.font = NSFont.boldSystemFont(ofSize: 24); title.frame = NSRect(x: 24, y: 176, width: 450, height: 32)
        status.frame = NSRect(x: 24, y: 120, width: 450, height: 45)
        openButton.frame = NSRect(x: 20, y: 73, width: 150, height: 32); openButton.target = self; openButton.action = #selector(openSuite); openButton.isEnabled = false
        let mcp = NSButton(title: "MCP setup", target: self, action: #selector(showMCP)); mcp.frame = NSRect(x: 175, y: 73, width: 115, height: 32)
        let folder = NSButton(title: "Open data folder", target: self, action: #selector(openData)); folder.frame = NSRect(x: 295, y: 73, width: 155, height: 32)
        let hint = NSTextField(wrappingLabelWithString: "Keep this window open while using RoomSuite. Closing it stops the local server.")
        hint.frame = NSRect(x: 24, y: 19, width: 450, height: 42)
        for view in [title, status, openButton, mcp, folder, hint] { window.contentView?.addSubview(view) }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        do {
            let settings = try Settings(), server = SuiteServer(settings: settings)
            self.settings = settings; self.server = server
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try server.start()
                    DispatchQueue.main.async {
                        self.status.stringValue = "Ready at \(settings.origin)"
                        self.openButton.isEnabled = true
                        if !ProcessInfo.processInfo.arguments.contains("--no-open") { self.openSuite() }
                        self.monitor = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
                            if !server.isRunning { self.monitor?.invalidate(); self.openButton.isEnabled = false; self.status.stringValue = "The local server stopped. Close and reopen RoomSuite." }
                        }
                    }
                } catch { DispatchQueue.main.async { self.status.stringValue = "RoomSuite could not start: \(error.localizedDescription)" } }
            }
        } catch { status.stringValue = "RoomSuite could not start: \(error.localizedDescription)" }
    }

    @objc private func openSuite() { if let settings = settings { NSWorkspace.shared.open(settings.url) } }
    @objc private func openData() {
        guard let settings = settings else { return }
        do { try FileManager.default.createDirectory(at: settings.data, withIntermediateDirectories: true); NSWorkspace.shared.open(settings.data) }
        catch { status.stringValue = error.localizedDescription }
    }
    @objc private func showMCP() {
        guard let settings = settings else { return }
        let dialog = NSAlert(); dialog.messageText = "Connect an agent to RoomSuite"
        dialog.informativeText = "Copy the configuration into your agent's MCP settings and restart the agent. Keep RoomSuite running. Moving the app changes its paths."
        dialog.addButton(withTitle: "Copy Codex TOML"); dialog.addButton(withTitle: "Copy MCP JSON"); dialog.addButton(withTitle: "Cancel")
        let choice = dialog.runModal()
        do {
            let config: String
            if choice == .alertFirstButtonReturn { config = try settings.tomlConfig() }
            else if choice == .alertSecondButtonReturn { config = try settings.jsonConfig() }
            else { return }
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(config, forType: .string)
            status.stringValue = "MCP configuration copied."
        } catch { status.stringValue = error.localizedDescription }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { monitor?.invalidate(); server?.stop() }
}

let arguments = CommandLine.arguments
if arguments.count == 3 && arguments[1] == "--export-mcp-config" {
    do { let settings = try Settings(); try Data(settings.jsonConfig().utf8).write(to: URL(fileURLWithPath: arguments[2]), options: .withoutOverwriting); exit(0) }
    catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
} else if arguments.count == 2 && arguments[1] == "--self-test" {
    do { try selfTest(settings: Settings()); print("RoomSuite self-test passed."); exit(0) }
    catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
} else {
    let app = NSApplication.shared, delegate = Launcher()
    app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
}
