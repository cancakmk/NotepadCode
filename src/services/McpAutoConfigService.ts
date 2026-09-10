import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface McpConfigResult {
  antigravityUpdated: boolean;
  cursorUpdated: boolean;
  windsurfUpdated: boolean;
  claudeUpdated: boolean;
  workspaceCursorUpdated: boolean;
  serverPath: string;
}

/**
 * Service that automatically configures Notepad Code's MCP server across all
 * supported IDEs and AI tools (Antigravity, Cursor, Windsurf, Claude Desktop, VS Code)
 * so the user never has to perform any manual setup or JSON editing.
 */
export class McpAutoConfigService {
  /**
   * Run the full auto-configuration process.
   * Silently detects installed IDEs and registers Notepad Code in their MCP configurations.
   */
  public static async autoConfigureAll(context: vscode.ExtensionContext): Promise<McpConfigResult> {
    const serverPath = path.join(context.extensionPath, 'mcp', 'server.js');

    // Ensure server script has executable permissions on unix-like systems
    try {
      if (fs.existsSync(serverPath) && process.platform !== 'win32') {
        fs.chmodSync(serverPath, 0o755);
      }
    } catch {
      // Non-fatal if permission cannot be altered
    }

    const result: McpConfigResult = {
      antigravityUpdated: false,
      cursorUpdated: false,
      windsurfUpdated: false,
      claudeUpdated: false,
      workspaceCursorUpdated: false,
      serverPath,
    };

    try {
      result.antigravityUpdated = this.configureAntigravity(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Antigravity:', e);
    }

    try {
      result.cursorUpdated = this.configureCursorGlobal(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Cursor global:', e);
    }

    try {
      result.workspaceCursorUpdated = this.configureCursorWorkspace(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Cursor workspace:', e);
    }

    try {
      result.windsurfUpdated = this.configureWindsurf(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Windsurf:', e);
    }

    try {
      result.claudeUpdated = this.configureClaudeDesktop(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Claude Desktop:', e);
    }

    return result;
  }

  /**
   * Helper to merge or update an MCP server configuration into a target JSON file.
   */
  private static updateMcpConfigFile(
    configPath: string,
    serverName: string,
    serverDef: { command: string; args: string[]; env?: Record<string, string> }
  ): boolean {
    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let config: any = {};
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8');
          config = JSON.parse(content) || {};
        } catch {
          config = {};
        }
      }

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        config.mcpServers = {};
      }

      const existing = config.mcpServers[serverName];
      const isAlreadyUpToDate =
        existing &&
        existing.command === serverDef.command &&
        Array.isArray(existing.args) &&
        existing.args[0] === serverDef.args[0];

      if (isAlreadyUpToDate) {
        return false;
      }

      config.mcpServers[serverName] = serverDef;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      return true;
    } catch (err) {
      console.error(`[NotepadCode] Error updating ${configPath}:`, err);
      return false;
    }
  }

  /**
   * Automatically configures Google Antigravity globally at ~/.gemini/config/mcp_config.json
   */
  private static configureAntigravity(serverPath: string): boolean {
    const geminiDir = path.join(os.homedir(), '.gemini', 'config');
    const configPath = path.join(geminiDir, 'mcp_config.json');

    // Only update if ~/.gemini/ exists or if gemini directory exists
    if (!fs.existsSync(path.join(os.homedir(), '.gemini'))) {
      return false;
    }

    return this.updateMcpConfigFile(configPath, 'notepad-code', {
      command: 'node',
      args: [serverPath],
    });
  }

  /**
   * Automatically configures Cursor globally at ~/.cursor/mcp.json
   */
  private static configureCursorGlobal(serverPath: string): boolean {
    const cursorDir = path.join(os.homedir(), '.cursor');
    const configPath = path.join(cursorDir, 'mcp.json');

    // If ~/.cursor exists, configure it
    if (fs.existsSync(cursorDir)) {
      return this.updateMcpConfigFile(configPath, 'notepad-code', {
        command: 'node',
        args: [serverPath],
      });
    }

    return false;
  }

  /**
   * Automatically configures the open workspace's .cursor/mcp.json if workspace is active
   */
  private static configureCursorWorkspace(serverPath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    let updated = false;
    for (const folder of workspaceFolders) {
      const cursorDir = path.join(folder.uri.fsPath, '.cursor');
      if (fs.existsSync(cursorDir)) {
        const configPath = path.join(cursorDir, 'mcp.json');
        if (
          this.updateMcpConfigFile(configPath, 'notepad-code', {
            command: 'node',
            args: [serverPath],
          })
        ) {
          updated = true;
        }
      }
    }
    return updated;
  }

  /**
   * Automatically configures Windsurf at ~/.codeium/windsurf/mcp_config.json if Windsurf exists
   */
  private static configureWindsurf(serverPath: string): boolean {
    const windsurfDir = path.join(os.homedir(), '.codeium', 'windsurf');
    if (!fs.existsSync(windsurfDir)) {
      return false;
    }

    const configPath = path.join(windsurfDir, 'mcp_config.json');
    return this.updateMcpConfigFile(configPath, 'notepad-code', {
      command: 'node',
      args: [serverPath],
    });
  }

  /**
   * Automatically configures Claude Desktop if installed
   */
  private static configureClaudeDesktop(serverPath: string): boolean {
    let claudeDir: string;
    if (process.platform === 'darwin') {
      claudeDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      claudeDir = path.join(appData, 'Claude');
    } else {
      claudeDir = path.join(os.homedir(), '.config', 'Claude');
    }

    if (!fs.existsSync(claudeDir)) {
      return false;
    }

    const configPath = path.join(claudeDir, 'claude_desktop_config.json');
    return this.updateMcpConfigFile(configPath, 'notepad-code', {
      command: 'node',
      args: [serverPath],
    });
  }
}
