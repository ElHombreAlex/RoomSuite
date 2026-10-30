using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RoomSuiteWindows {
  internal static class Settings {
    internal static readonly string App = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    internal static readonly string Data = Environment.GetEnvironmentVariable("ROOMSUITE_APP_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RoomSuite");
    internal static readonly string Workspace = Path.Combine(Data, "agent-workspace");
    internal static readonly string Browser = Path.Combine(App, "browsers");
    internal static readonly string Node = Path.Combine(App, "runtime", "node.exe");
    internal static readonly string Server = Path.Combine(App, "server.js");
    internal static readonly string Mcp = Path.Combine(App, "mcp", "server.mjs");
    internal static int Port {
      get { int port; string value = Environment.GetEnvironmentVariable("CLIPROOM_PORT"); if (String.IsNullOrEmpty(value)) return 8090; if (!Int32.TryParse(value, out port) || port < 1 || port > 65535) throw new InvalidOperationException("CLIPROOM_PORT must be between 1 and 65535."); return port; }
    }
    internal static string Url { get { return "http://127.0.0.1:" + Port + "/"; } }
    internal static bool HasMcp { get { return File.Exists(Mcp) && File.Exists(Path.Combine(App, "mcp", "node_modules", "playwright", "package.json")) && Directory.Exists(Browser); } }
    internal static string Quote(string value) {
      StringBuilder result = new StringBuilder("\"");
      foreach (char c in value) { if (c == '\\' || c == '"') result.Append('\\').Append(c); else if (c < 32) result.Append("\\u").Append(((int)c).ToString("x4")); else result.Append(c); }
      return result.Append('"').ToString();
    }
    internal static string JsonConfig() {
      return "{\r\n  \"mcpServers\": {\r\n    \"roomsuite\": {\r\n      \"command\": " + Quote(Node) + ",\r\n      \"args\": [" + Quote(Mcp) + "],\r\n      \"env\": {\r\n        \"ROOMSUITE_MCP_WORKSPACE\": " + Quote(Workspace) + ",\r\n        \"ROOMSUITE_MCP_URL\": " + Quote(Url.TrimEnd('/')) + ",\r\n        \"PLAYWRIGHT_BROWSERS_PATH\": " + Quote(Browser) + "\r\n      }\r\n    }\r\n  }\r\n}";
    }
    internal static string TomlConfig() {
      return "[mcp_servers.roomsuite]\r\ncommand = " + Quote(Node) + "\r\nargs = [" + Quote(Mcp) + "]\r\ntool_timeout_sec = 600\r\n\r\n[mcp_servers.roomsuite.env]\r\nROOMSUITE_MCP_WORKSPACE = " + Quote(Workspace) + "\r\nROOMSUITE_MCP_URL = " + Quote(Url.TrimEnd('/')) + "\r\nPLAYWRIGHT_BROWSERS_PATH = " + Quote(Browser) + "\r\n";
    }
  }

  internal sealed class SuiteServer : IDisposable {
    private Process process;
    private readonly StringBuilder errors = new StringBuilder();
    private bool stopping;
    internal event Action<string> StoppedUnexpectedly;
    internal async Task Start() {
      Directory.CreateDirectory(DataPath("cliproom")); Directory.CreateDirectory(DataPath("workspace")); Directory.CreateDirectory(Settings.Workspace);
      if (!File.Exists(Settings.Node) || !File.Exists(Settings.Server)) throw new IOException("RoomSuite's installed files are missing. Run the installer again.");
      var started = new TaskCompletionSource<bool>();
      process = new Process(); process.StartInfo = new ProcessStartInfo(Settings.Node, "\"" + Settings.Server + "\"") { WorkingDirectory = Settings.App, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
      process.StartInfo.EnvironmentVariables["CLIPROOM_PORT"] = Settings.Port.ToString();
      process.StartInfo.EnvironmentVariables["CLIPROOM_DATA"] = DataPath("cliproom");
      process.StartInfo.EnvironmentVariables["ROOMSUITE_DATA"] = DataPath("workspace");
      process.StartInfo.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = Settings.Browser;
      process.EnableRaisingEvents = true;
      process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null && e.Data.Contains("RoomSuite is running at " + Settings.Url.TrimEnd('/'))) started.TrySetResult(true); };
      process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (errors) { if (errors.Length < 4000) errors.AppendLine(e.Data); } };
      process.Exited += delegate { string message; lock (errors) message = errors.ToString(); bool wasReady = started.Task.Status == TaskStatus.RanToCompletion; started.TrySetException(new InvalidOperationException("RoomSuite could not start. Port " + Settings.Port + " may already be in use. " + message)); if (wasReady && !stopping && StoppedUnexpectedly != null) StoppedUnexpectedly(message); };
      if (!process.Start()) throw new InvalidOperationException("Could not start the RoomSuite server.");
      process.BeginOutputReadLine(); process.BeginErrorReadLine();
      if (await Task.WhenAny(started.Task, Task.Delay(20000)) != started.Task) { Stop(); throw new TimeoutException("RoomSuite did not start in time."); }
      await started.Task;
      if (process.HasExited) throw new InvalidOperationException("RoomSuite stopped while starting.");
    }
    private static string DataPath(string name) { return Path.Combine(Settings.Data, "data", name); }
    internal void Stop() { stopping = true; if (process == null) return; try { if (!process.HasExited) { process.Kill(); process.WaitForExit(5000); } } catch (InvalidOperationException) { } }
    public void Dispose() { Stop(); if (process != null) process.Dispose(); }
  }

  internal sealed class MainWindow : Form {
    private readonly SuiteServer server = new SuiteServer();
    private readonly Label status = new Label();
    private readonly Button open = new Button();
    internal MainWindow(bool openOnStart) {
      Text = "RoomSuite"; StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(470, 240); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
      var title = new Label { Text = "RoomSuite", Font = new Font("Segoe UI", 18, FontStyle.Bold), AutoSize = true, Left = 22, Top = 17 };
      status.Text = "Starting your local workspace…"; status.Left = 24; status.Top = 60; status.Width = 420; status.Height = 45;
      open.Text = "Open RoomSuite"; open.Left = 24; open.Top = 115; open.Width = 135; open.Height = 34; open.Enabled = false; open.Click += delegate { try { Process.Start(Settings.Url); } catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not open browser"); } };
      var mcp = new Button { Text = "MCP setup", Left = 168, Top = 115, Width = 115, Height = 34 };
      mcp.Click += delegate { if (!Settings.HasMcp) { MessageBox.Show(this, "The MCP component is not installed. Run the installer again and select 'RoomSuite with MCP'.", "MCP setup"); return; } using (var dialog = new McpWindow()) dialog.ShowDialog(this); };
      var folder = new Button { Text = "Open data folder", Left = 292, Top = 115, Width = 140, Height = 34 };
      folder.Click += delegate { try { Directory.CreateDirectory(Settings.Data); Process.Start(Settings.Data); } catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not open folder"); } };
      var hint = new Label { Text = "Keep this window open while using RoomSuite. Closing it stops the local server.", Left = 24, Top = 166, Width = 415, Height = 40 };
      Controls.AddRange(new Control[] { title, status, open, mcp, folder, hint });
      Shown += async delegate { try { await server.Start(); if (IsDisposed) return; status.Text = "Ready at " + Settings.Url; open.Enabled = true; if (openOnStart) open.PerformClick(); } catch (Exception ex) { if (IsDisposed) return; status.Text = "RoomSuite could not start. See the error message."; MessageBox.Show(this, ex.Message, "RoomSuite", MessageBoxButtons.OK, MessageBoxIcon.Error); } };
      server.StoppedUnexpectedly += delegate(string detail) { if (!IsDisposed && IsHandleCreated) try { BeginInvoke((Action)delegate { if (!IsDisposed) { open.Enabled = false; status.Text = "The local server stopped. Close and reopen RoomSuite."; if (!String.IsNullOrWhiteSpace(detail)) MessageBox.Show(this, detail, "RoomSuite stopped"); } }); } catch (InvalidOperationException) { } };
      FormClosing += delegate { server.Dispose(); };
    }
  }

  internal sealed class McpWindow : Form {
    internal McpWindow() {
      Text = "Connect an agent to RoomSuite"; StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(680, 450); MinimizeBox = false;
      var intro = new Label { Text = "Copy the configuration for your agent. Add it to that agent's MCP settings, then restart the agent. Keep RoomSuite running.", Left = 15, Top = 12, Width = 645, Height = 38 };
      var tabs = new TabControl { Left = 15, Top = 55, Width = 650, Height = 315, Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right };
      var json = CreateTab("MCP JSON", Settings.JsonConfig()); var toml = CreateTab("Codex TOML", Settings.TomlConfig()); tabs.TabPages.Add(json); tabs.TabPages.Add(toml);
      var copy = new Button { Text = "Copy selected configuration", Left = 15, Top = 385, Width = 205, Height = 32, Anchor = AnchorStyles.Bottom | AnchorStyles.Left };
      copy.Click += delegate { try { Clipboard.SetText(((TextBox)tabs.SelectedTab.Controls[0]).Text); copy.Text = "Copied"; } catch (Exception ex) { MessageBox.Show(this, ex.Message, "Clipboard"); } };
      var close = new Button { Text = "Close", Left = 575, Top = 385, Width = 90, Height = 32, Anchor = AnchorStyles.Bottom | AnchorStyles.Right }; close.Click += delegate { Close(); };
      Controls.AddRange(new Control[] { intro, tabs, copy, close });
    }
    private static TabPage CreateTab(string title, string value) { var page = new TabPage(title); page.Controls.Add(new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 9), Text = value }); return page; }
  }

  internal static class Program {
    [STAThread] private static int Main(string[] args) {
      if (args.Length == 2 && args[0] == "--export-mcp-config") {
        try { if (!Settings.HasMcp) return 2; using (var writer = new StreamWriter(new FileStream(args[1], FileMode.CreateNew, FileAccess.Write), new UTF8Encoding(false))) writer.Write(Settings.JsonConfig()); return 0; } catch { return 1; }
      }
      if (args.Length == 1 && args[0] == "--self-test") {
        try { using (var server = new SuiteServer()) { server.Start().GetAwaiter().GetResult(); var request = (HttpWebRequest)WebRequest.Create(Settings.Url); request.Timeout = 10000; using (var response = (HttpWebResponse)request.GetResponse()) if (response.StatusCode != HttpStatusCode.OK) return 1; } return 0; } catch { return 1; }
      }
      Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      bool created; using (var mutex = new Mutex(true, "Local\\RoomSuite-Launcher", out created)) {
        if (!created) { MessageBox.Show("RoomSuite is already running. Use its Open RoomSuite button to open another window.", "RoomSuite"); return 0; }
        Application.Run(new MainWindow(!(args.Length == 1 && args[0] == "--no-open")));
      }
      return 0;
    }
  }
}
