import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent installer contract", () => {
  const setup = read("windows-print-agent/setup-agent.ps1");
  const project = read("windows-print-agent/PrintersHero.PrintAgent.csproj");
  const publishProfile = read("windows-print-agent/Properties/PublishProfiles/Shop-win-x64.pubxml");
  const agent = read("windows-print-agent/Program.cs");
  const taskScript = read("windows-print-agent/scripts/manage-agent-task.ps1");
  const launcherScript = read("windows-print-agent/scripts/start-agent.ps1");
  const routes = read("server/routes/localBridge.routes.ts");
  const localBridgeSettings = read("client/src/pages/settings/LocalBridgeSettings.tsx");

  test("uses Microsoft's documented WebView2 runtime registration, not a browser executable", () => {
    expect(setup).toContain("{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}");
    expect(setup).toContain("EdgeUpdate\\Clients");
    expect(setup).toContain("Microsoft WebView2 Runtime: Installed");
    expect(setup).toContain("https://developer.microsoft.com/microsoft-edge/webview2/");
    expect(setup).toContain("Open Microsoft's WebView2 installer page now? [Y/N]");
    expect(setup).toContain("Start-Process $script:WebView2DownloadUrl");
  });

  test("rejects missing WebView2 and invalid local printer selection safely", () => {
    expect(setup).toContain("Install Microsoft Edge WebView2 Runtime, then run setup-agent.ps1 again.");
    expect(setup).toContain("Get-CimInstance -ClassName Win32_Printer");
    expect(setup).toContain("The selected Traveler printer was not found");
    expect(setup).toContain("Select Traveler printer");
  });

  test("stores credentials without logging them and configures only the paired agent", () => {
    expect(setup).toContain("[string]$ApiBaseUrl = 'https://api.printershero.com'");
    expect(setup).not.toContain("[string]$ApiBaseUrl = 'https://www.printershero.com'");
    expect(setup).toContain("PRINTERSHERO_AGENT_TOKEN");
    expect(setup).toContain("Get-Clipboard -Raw -ErrorAction Stop");
    expect(setup).toContain("$AgentToken = $null");
    expect(setup).toContain("/api/local-bridge/direct-print/configuration");
    expect(setup).toContain('The pairing token is invalid or revoked');
    expect(setup).toContain('Test-SuccessStatus');
    expect(setup).toContain('System.Net.HttpWebRequest');
    expect(setup).toContain('$request.GetRequestStream()');
    expect(setup).toContain("$script:SetupVersion = '1.0.15'");
    expect(setup).toContain('PrintersHero returned HTTP {0} ({1})');
    expect(setup).toContain("[regex]::Replace($AgentToken, '[^A-Za-z0-9_-]', '')");
    expect(setup).toContain("'^[A-Za-z0-9_-]{43}$'");
    expect(setup).toContain('Use the saved PrintersHero pairing token for this retry? [Y/n]');
    expect(setup).toContain("Get-Clipboard -Raw -ErrorAction Stop");
    expect(setup).toContain('Press Enter to read the pairing token from the clipboard');
    expect(setup).toContain("[Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'User')");
    expect(agent).toContain("PRINTERSHERO_TRAVELER_PRINTER");
    expect(agent).toContain("configured Traveler printer unavailable or mismatched");
    expect(agent).toContain("JsonNumberHandling.AllowReadingFromString");
    expect(agent).toContain("Deserialize<T>(JsonOptions)");
    expect(agent).toContain("[STAThread] static void Main");
    expect(agent).toContain("Start only after the WinForms message loop establishes its STA sync");
    expect(agent).toContain("AddScriptToExecuteOnDocumentCreatedAsync");
    expect(agent).toContain("source request status");
  });

  test("uses the existing task manager for install, diagnostics, and uninstall", () => {
    expect(setup).toContain("manage-agent-task.ps1");
    expect(setup).toContain("& $script:TaskScript -Action stop");
    expect(setup).toContain("-Action install");
    expect(setup).toContain("-Action start");
    expect(setup).toContain("if ($Check)");
    expect(setup).toContain("if ($Uninstall)");
    expect(setup).toContain("Remove-AgentConfiguration");
    expect(setup).toContain("Start-Process -FilePath 'powershell.exe' -Verb RunAs");
    expect(setup).toContain('Restart-ElevatedSetup');
    expect(setup).toContain('Administrator setup window');
    expect(setup).toContain('Error: {0}');
    expect(taskScript).toContain("Invoke-TaskScheduler");
    expect(taskScript).toContain("Windows Task Scheduler command failed");
    expect(taskScript).toContain("Get-AgentTaskCommand");
    expect(taskScript).toContain("scripts\\start-agent.ps1");
    expect(taskScript).toContain("CommonApplicationData");
    expect(taskScript).toContain("Copy-Item -LiteralPath $launcherSourcePath -Destination $taskLauncherPath -Force");
    expect(taskScript).toContain("-File $taskLauncherPath");
    expect(launcherScript).toContain("GetEnvironmentVariable($name, 'User')");
    expect(launcherScript).toContain("GetEnvironmentVariable('PRINTERSHERO_AGENT_PATH', 'User')");
    expect(launcherScript).toContain("SetEnvironmentVariable($name, $value, 'Process')");
    expect(launcherScript).not.toContain("PRINTERSHERO_AGENT_TOKEN=");
  });

  test("publishes a self-contained win-x64 package with installer assets", () => {
    expect(publishProfile).toContain("<RuntimeIdentifier>win-x64</RuntimeIdentifier>");
    expect(publishProfile).toContain("<SelfContained>true</SelfContained>");
    expect(publishProfile).toContain("<PublishTrimmed>false</PublishTrimmed>");
    expect(project).toContain('None Update="setup-agent.ps1" CopyToPublishDirectory="PreserveNewest"');
    expect(project).toContain('None Update="scripts\\manage-agent-task.ps1" CopyToPublishDirectory="PreserveNewest"');
    expect(project).toContain('None Update="scripts\\start-agent.ps1" CopyToPublishDirectory="PreserveNewest"');
    expect(project).toContain('None Update="README.txt" CopyToPublishDirectory="PreserveNewest"');
  });

  test("serves the Traveler package separately from the legacy file-copy agent", () => {
    expect(routes).toContain('/api/local-bridge/admin/traveler-print-agent-package');
    expect(routes).toContain('PrintersHero-Traveler-Print-Agent-win-x64.zip');
    expect(localBridgeSettings).toContain('Download Traveler Print Agent');
    expect(localBridgeSettings).toContain('Download Legacy Local Bridge Agent');
    expect(localBridgeSettings).toContain('navigator.clipboard.writeText(token)');
    expect(localBridgeSettings).toContain('Copy token');
    expect(localBridgeSettings).toContain('dark:bg-amber-950/40');
    expect(localBridgeSettings).toContain('dark:text-amber-100');
    expect(localBridgeSettings).toContain('Traveler printer:');
    expect(localBridgeSettings).toContain('Awaiting setup');
    expect(routes).toContain('eq(localBridgeAgents.status, "active")');
  });

  test("pairs an unpaired Traveler profile with the exact selected Windows queue", () => {
    expect(routes).toContain("isNull(printerProfiles.printAgentId)");
    expect(routes).toContain("eq(printerProfiles.windowsQueueName, queueName)");
    expect(routes).toContain("printAgentId: agent.id");
    expect(routes).toContain("Profiles paired to another agent");
  });
});
