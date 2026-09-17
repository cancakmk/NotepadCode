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
  vscodeUserUpdated: boolean;
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
      vscodeUserUpdated: false,
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
      result.vscodeUserUpdated = this.configureVsCodeUser(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure VS Code user profile MCP:', e);
    }

    try {
      this.configureClineAndRoo(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Cline/Roo Code:', e);
    }

    try {
      this.configureZed(serverPath);
    } catch (e) {
      console.warn('[NotepadCode] Failed to auto-configure Zed:', e);
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
   * Parses JSON with comments and trailing commas (VS Code and Zed config files
   * are JSONC, and users frequently annotate them).
   */
  private static parseJsonc(text: string): any {
    let out = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inLineComment) {
        if (ch === '\n') {
          inLineComment = false;
          out += ch;
        }
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inString) {
        out += ch;
        if (ch === '\\') {
          out += next ?? '';
          i++;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        out += ch;
        continue;
      }
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      out += ch;
    }

    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }

  /**
   * Helper to merge or update an MCP server configuration into a target JSON file.
   * VS Code uses the `servers` root key with an explicit `type`, while Cursor/Claude/Windsurf
   * use the `mcpServers` root key.
   * A file that exists but cannot be read or parsed is left completely untouched.
   */
  private static updateMcpConfigFile(
    configPath: string,
    serverName: string,
    serverDef: { command: string; args: string[]; type?: string; env?: Record<string, string> },
    rootKey: string = 'mcpServers'
  ): boolean {
    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let config: any = {};
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        if (content.trim().length > 0) {
          try {
            config = this.parseJsonc(content) || {};
          } catch (err) {
            // Never replace a user's config we do not understand — doing so would
            // silently delete every other MCP server they have configured.
            console.warn(`[NotepadCode] ${configPath} is not valid JSON/JSONC; leaving it untouched.`);
            return false;
          }
        }
      }

      if (!config[rootKey] || typeof config[rootKey] !== 'object') {
        config[rootKey] = {};
      }

      const existing = config[rootKey][serverName];
      const isAlreadyUpToDate =
        existing &&
        existing.command === serverDef.command &&
        Array.isArray(existing.args) &&
        existing.args[0] === serverDef.args[0] &&
        (!serverDef.type || existing.type === serverDef.type);

      if (isAlreadyUpToDate) {
        return false;
      }

      config[rootKey][serverName] = serverDef;

      // Atomic replace so an interrupted write cannot corrupt the user's config.
      const tmpPath = `${configPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, configPath);
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

  /**
   * Automatically configures VS Code's user-level (global) MCP configuration at
   * `<VS Code User profile folder>/mcp.json`, so Notepad Code is available as an MCP
   * server in every workspace without touching `.vscode/mcp.json`.
   * VS Code expects the `servers` schema with an explicit `"type": "stdio"`.
   */
  private static configureVsCodeUser(serverPath: string): boolean {
    let updated = false;

    for (const userDir of this.getVsCodeUserDirs()) {
      const configPath = path.join(userDir, 'mcp.json');
      if (
        this.updateMcpConfigFile(
          configPath,
          'notepad-code',
          { type: 'stdio', command: 'node', args: [serverPath] },
          'servers'
        )
      ) {
        updated = true;
      }
    }

    return updated;
  }

  /**
   * Resolves existing VS Code user profile directories (Stable + Insiders) for the current platform.
   */
  private static getVsCodeUserDirs(): string[] {
    let base: string;
    if (process.platform === 'darwin') {
      base = path.join(os.homedir(), 'Library', 'Application Support');
    } else if (process.platform === 'win32') {
      base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else {
      base = path.join(os.homedir(), '.config');
    }

    return ['Code', 'Code - Insiders']
      .map((appName) => path.join(base, appName, 'User'))
      .filter((userDir) => fs.existsSync(userDir));
  }

  /**
   * Automatically configures Cline & Roo Code extensions
   */
  private static configureClineAndRoo(serverPath: string): boolean {
    let baseStorage: string;
    if (process.platform === 'darwin') {
      baseStorage = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      baseStorage = path.join(appData, 'Code', 'User', 'globalStorage');
    } else {
      baseStorage = path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage');
    }

    let updated = false;
    // Cline
    const clineConfig = path.join(baseStorage, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
    if (fs.existsSync(path.dirname(clineConfig))) {
      if (this.updateMcpConfigFile(clineConfig, 'notepad-code', { command: 'node', args: [serverPath] })) {
        updated = true;
      }
    }

    // Roo Code
    const rooConfig = path.join(baseStorage, 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
    if (fs.existsSync(path.dirname(rooConfig))) {
      if (this.updateMcpConfigFile(rooConfig, 'notepad-code', { command: 'node', args: [serverPath] })) {
        updated = true;
      }
    }

    return updated;
  }

  /**
   * Automatically configures Zed Editor at ~/.config/zed/settings.json
   */
  private static configureZed(serverPath: string): boolean {
    const zedSettingsPath = path.join(os.homedir(), '.config', 'zed', 'settings.json');
    if (!fs.existsSync(path.dirname(zedSettingsPath))) {
      return false;
    }

    try {
      let config: any = {};
      if (fs.existsSync(zedSettingsPath)) {
        config = JSON.parse(fs.readFileSync(zedSettingsPath, 'utf8')) || {};
      }

      if (!config.context_servers || typeof config.context_servers !== 'object') {
        config.context_servers = {};
      }

      config.context_servers['notepad-code'] = {
        command: {
          path: 'node',
          args: [serverPath],
        },
      };

      fs.writeFileSync(zedSettingsPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}
