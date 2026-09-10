// Manual Windows integration check. Uses synthetic credentials in an isolated temporary directory.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { saveBackendKey, saveBackendConfig } from '../server/key-store.js';

if (process.platform !== 'win32') throw new Error('Windows only');
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const directory = await mkdtemp(join(artifacts, 'key-store-check-'));
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name];
try {
  for (const suffix of ['k', 'm']) {
    const key = 'AIza' + suffix.repeat(35);
    assert.equal((await saveBackendKey(key, { directory })).storage, 'windows-encrypted');
    const path = join(directory, 'google-key.dpapi');
    assert.ok(!(await readFile(path, 'utf8')).includes(key));
    const loader = `$secure=(Get-Content -LiteralPath '${path.replaceAll("'", "''")}' -Raw).Trim() | ConvertTo-SecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose()}`;
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', loader], { env, windowsHide: true });
    if (stdout !== key) throw new Error('Key round trip failed');
  }
  const config = { provider: 'openai', endpoint: 'https://provider.example/v1', model: 'test/model', key: 'synthetic-provider-key', jsonMode: false };
  await saveBackendConfig(config, { directory });
  const configPath = join(directory, 'provider-config.dpapi');
  assert.ok(!(await readFile(configPath, 'utf8')).includes(config.key));
  const configLoader = `$secure=(Get-Content -LiteralPath '${configPath.replaceAll("'", "''")}' -Raw).Trim() | ConvertTo-SecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose()}`;
  const decrypted = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', configLoader], { env, windowsHide: true });
  assert.deepEqual(JSON.parse(decrypted.stdout), config);
  console.log('PASS: Windows key encryption, atomic update and decryption; no plaintext file or key argument.');
} finally {
  // mkdtemp result is verified to remain under this project's artifacts directory.
  if (!directory.startsWith(join(artifacts, 'key-store-check-'))) throw new Error('Unexpected temporary path');
  await rm(directory, { recursive: true, force: true });
}
