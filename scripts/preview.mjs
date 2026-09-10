import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../server/app.js';
import { saveBackendConfig } from '../server/key-store.js';
import { validateProviderConfig } from '../server/ai-provider.js';

let key = process.env.GEMINI_API_KEY?.trim() || '';
delete process.env.GEMINI_API_KEY;
let providerConfig = null;
if (process.platform === 'win32') {
  let filename = 'provider-config.dpapi';
  try { await access(new URL('../server/.secrets/provider-config.dpapi', import.meta.url)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; filename = 'google-key.dpapi'; }
  const path = fileURLToPath(new URL(`../server/.secrets/${filename}`, import.meta.url));
  try {
    await access(path);
    const serverDirectory = fileURLToPath(new URL('../server/', import.meta.url));
    const loader = (await readFile(new URL('../server/read-secret.ps1', import.meta.url), 'utf8')).replaceAll('$PSScriptRoot', `'${serverDirectory.replaceAll("'", "''")}'`).replace('google-key.dpapi', filename);
    // A fixed, local decryption command contains only the encrypted-file path, never the key.
    const env = { ...process.env };
    // Windows PowerShell must resolve its own modules when launched from PowerShell 7.
    for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name];
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', loader], { env, windowsHide: true, timeout: 10000, maxBuffer: 32768 });
    if (filename === 'provider-config.dpapi') providerConfig = validateProviderConfig(JSON.parse(result.stdout.trim()));
    else if (!key) key = result.stdout.trim();
  } catch (error) { if (error.code !== 'ENOENT') { console.error('Cannot unlock backend key. Run server/set-key.ps1 under this Windows account.'); process.exit(1); } }
}
if (key && !/^AIza[\w-]{35}$/.test(key)) { console.error('Invalid backend Google key format.'); process.exit(1); }
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('PORT must be 1024–65535.'); process.exit(1); }
const server = createBackend({ key, providerConfig, saveConfig: saveBackendConfig }); key = ''; providerConfig = null;
server.on('error', () => { console.error('Backend failed to start. Check whether the port is already in use.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`ClipBrief backend: http://127.0.0.1:${port}/panel.html?demo=1`);
  console.log('API credentials stay in the backend.');
  console.log(`Set your own API key: http://127.0.0.1:${port}/setup.html`);
});
