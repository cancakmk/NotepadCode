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

function updateMcpConfigFile(configPath, serverName, serverDef) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(content) || {};
      } catch (err) {
        config = {};
      }
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }

    config.mcpServers[serverName] = serverDef;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
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

// 4. VS Code Workspace .vscode/mcp.json
const workspaceVsCodeDir = path.join(process.cwd(), '.vscode');
if (fs.existsSync(workspaceVsCodeDir)) {
  const wsVsCodeMcp = path.join(workspaceVsCodeDir, 'mcp.json');
  if (updateMcpConfigFile(wsVsCodeMcp, 'notepad-code', { command: 'node', args: [serverPath] })) {
    results.push(`Workspace VS Code MCP (${wsVsCodeMcp})`);
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
      zedConfig = JSON.parse(fs.readFileSync(zedSettingsPath, 'utf8')) || {};
    }
    if (!zedConfig.context_servers || typeof zedConfig.context_servers !== 'object') {
      zedConfig.context_servers = {};
    }
    zedConfig.context_servers['notepad-code'] = {
      command: { path: 'node', args: [serverPath] },
    };
    fs.writeFileSync(zedSettingsPath, JSON.stringify(zedConfig, null, 2) + '\n', 'utf8');
    results.push(`Zed (${zedSettingsPath})`);
  } catch (err) {
    // Non-fatal
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
