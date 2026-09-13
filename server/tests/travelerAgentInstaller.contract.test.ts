import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent installer contract", () => {
  const setup = read("windows-print-agent/setup-agent.ps1");
  const project = read("windows-print-agent/PrintersHero.PrintAgent.csproj");
  const publishProfile = read("windows-print-agent/Properties/PublishProfiles/Shop-win-x64.pubxml");
  const agent = read("windows-print-agent/Program.cs");

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
    expect(setup).toContain("PRINTERSHERO_AGENT_TOKEN");
    expect(setup).toContain("Get-PlainSecureString");
    expect(setup).toContain("$AgentToken = $null");
    expect(setup).toContain("/api/local-bridge/direct-print/configuration");
    expect(agent).toContain("PRINTERSHERO_TRAVELER_PRINTER");
    expect(agent).toContain("configured Traveler printer unavailable or mismatched");
  });

  test("uses the existing task manager for install, diagnostics, and uninstall", () => {
    expect(setup).toContain("manage-agent-task.ps1");
    expect(setup).toContain("-Action install");
    expect(setup).toContain("-Action start");
    expect(setup).toContain("if ($Check)");
    expect(setup).toContain("if ($Uninstall)");
    expect(setup).toContain("Remove-AgentConfiguration");
  });

  test("publishes a self-contained win-x64 package with installer assets", () => {
    expect(publishProfile).toContain("<RuntimeIdentifier>win-x64</RuntimeIdentifier>");
    expect(publishProfile).toContain("<SelfContained>true</SelfContained>");
    expect(publishProfile).toContain("<PublishTrimmed>false</PublishTrimmed>");
    expect(project).toContain('None Update="setup-agent.ps1" CopyToPublishDirectory="PreserveNewest"');
    expect(project).toContain('None Update="scripts\\manage-agent-task.ps1" CopyToPublishDirectory="PreserveNewest"');
    expect(project).toContain('None Update="README.txt" CopyToPublishDirectory="PreserveNewest"');
  });
});
