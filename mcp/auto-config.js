#!/usr/bin/env node
/**
 * Standalone auto-configuration script for Notepad Code MCP server.
 * Can be executed directly via Node.js or during build/postinstall.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const serverPath = path.resolve(__dirname, 'server.js');

// Ensure executable permissions on server.js
try {
  if (fs.existsSync(serverPath) && process.platform !== 'win32') {
    fs.chmodSync(serverPath, 0o755);
  }
} catch (e) {
  // Ignore
}

/**
 * Parses JSON with comments and trailing commas (VS Code and Zed config files
 * are JSONC, and users frequently annotate them).
 */
function parseJsonc(text) {
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
        out += next === undefined ? '' : next;
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

function updateMcpConfigFile(configPath, serverName, serverDef, rootKey = 'mcpServers') {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let config = {};
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      if (content.trim().length > 0) {
        try {
          config = parseJsonc(content) || {};
        } catch (err) {
          // Never replace a config we do not understand — that would silently
          // delete every other MCP server the user has configured.
          console.error(`Notepad Code: ${configPath} is not valid JSON/JSONC; leaving it untouched.`);
          return false;
        }
      }
    }

    if (!config[rootKey] || typeof config[rootKey] !== 'object') {
      config[rootKey] = {};
    }

    config[rootKey][serverName] = serverDef;

    // Atomic replace so an interrupted write cannot corrupt the user's config.
    const tmpPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, configPath);
    return true;
  } catch (err) {
    console.error(`Error writing ${configPath}:`, err);
    return false;
  }
}

const results = [];

// 1. Antigravity Global (~/.gemini/config/mcp_config.json)
const geminiConfigDir = path.join(os.homedir(), '.gemini', 'config');
if (fs.existsSync(path.join(os.homedir(), '.gemini'))) {
  const geminiMcp = path.join(geminiConfigDir, 'mcp_config.json');
  if (updateMcpConfigFile(geminiMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Antigravity Global (${geminiMcp})`);
  }
}

// 2. Cursor Global (~/.cursor/mcp.json)
const cursorDir = path.join(os.homedir(), '.cursor');
if (fs.existsSync(cursorDir)) {
  const cursorMcp = path.join(cursorDir, 'mcp.json');
  if (updateMcpConfigFile(cursorMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Cursor Global (${cursorMcp})`);
  }
}

// 3. Workspace .cursor/mcp.json (if exists in cwd)
const workspaceCursorDir = path.join(process.cwd(), '.cursor');
if (fs.existsSync(workspaceCursorDir)) {
  const wsCursorMcp = path.join(workspaceCursorDir, 'mcp.json');
  if (updateMcpConfigFile(wsCursorMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Workspace Cursor (${wsCursorMcp})`);
  }
}

// 4. VS Code User Profile (<User folder>/mcp.json) - global across all workspaces
let vsCodeBase;
if (process.platform === 'darwin') {
  vsCodeBase = path.join(os.homedir(), 'Library', 'Application Support');
} else if (process.platform === 'win32') {
  vsCodeBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
} else {
  vsCodeBase = path.join(os.homedir(), '.config');
}
for (const appName of ['Code', 'Code - Insiders']) {
  const userDir = path.join(vsCodeBase, appName, 'User');
  if (fs.existsSync(userDir)) {
    const vsCodeUserMcp = path.join(userDir, 'mcp.json');
    if (
      updateMcpConfigFile(
        vsCodeUserMcp,
        'notepad-code',
        { type: 'stdio', command: 'node', args: [serverPath] },
        'servers'
      )
    ) {
      results.push(`VS Code User Profile (${vsCodeUserMcp})`);
    }
  }
}

// 5. Cline & Roo Code
let baseStorage;
if (process.platform === 'darwin') {
  baseStorage = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
} else if (process.platform === 'win32') {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  baseStorage = path.join(appData, 'Code', 'User', 'globalStorage');
} else {
  baseStorage = path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage');
}

if (baseStorage) {
  const clineConfig = path.join(baseStorage, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  if (fs.existsSync(path.dirname(clineConfig))) {
    if (updateMcpConfigFile(clineConfig, 'notepad-code', { command: 'node', args: [serverPath] })) {
      results.push(`Cline (${clineConfig})`);
    }
  }

  const rooConfig = path.join(baseStorage, 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  if (fs.existsSync(path.dirname(rooConfig))) {
    if (updateMcpConfigFile(rooConfig, 'notepad-code', { command: 'node', args: [serverPath] })) {
      results.push(`Roo Code (${rooConfig})`);
    }
  }
}

// 6. Zed Editor
const zedSettingsPath = path.join(os.homedir(), '.config', 'zed', 'settings.json');
if (fs.existsSync(path.dirname(zedSettingsPath))) {
  try {
    let zedConfig = {};
    if (fs.existsSync(zedSettingsPath)) {
      const raw = fs.readFileSync(zedSettingsPath, 'utf8');
      if (raw.trim().length > 0) {
        zedConfig = parseJsonc(raw) || {};
      }
    }
    if (!zedConfig.context_servers || typeof zedConfig.context_servers !== 'object') {
      zedConfig.context_servers = {};
    }
    zedConfig.context_servers['notepad-code'] = {
      command: { path: 'node', args: [serverPath] },
    };
    const zedTmpPath = `${zedSettingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(zedTmpPath, JSON.stringify(zedConfig, null, 2) + '\n', 'utf8');
    fs.renameSync(zedTmpPath, zedSettingsPath);
    results.push(`Zed (${zedSettingsPath})`);
  } catch (err) {
    // Leave the settings file untouched if it cannot be parsed.
    console.error(`Notepad Code: Zed settings could not be updated (${err.message}).`);
  }
}

// 7. Windsurf (~/.codeium/windsurf/mcp_config.json)
const windsurfDir = path.join(os.homedir(), '.codeium', 'windsurf');
if (fs.existsSync(windsurfDir)) {
  const windsurfMcp = path.join(windsurfDir, 'mcp_config.json');
  if (updateMcpConfigFile(windsurfMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Windsurf (${windsurfMcp})`);
  }
}

// 8. Claude Desktop
let claudeDir;
if (process.platform === 'darwin') {
  claudeDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
} else if (process.platform === 'win32') {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  claudeDir = path.join(appData, 'Claude');
} else {
  claudeDir = path.join(os.homedir(), '.config', 'Claude');
}
if (fs.existsSync(claudeDir)) {
  const claudeMcp = path.join(claudeDir, 'claude_desktop_config.json');
  if (updateMcpConfigFile(claudeMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Claude Desktop (${claudeMcp})`);
  }
}

console.log('Notepad Code MCP auto-configuration completed.');
if (results.length > 0) {
  console.log('Configured in:', results.join(', '));
} else {
  console.log('All IDE configs are already up-to-date.');
}
