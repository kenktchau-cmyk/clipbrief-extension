import { execFile } from 'node:child_process';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProviderConfig } from './ai-provider.js';

export async function saveBackendConfig(config, options = {}) {
  return saveEncryptedSecret(JSON.stringify(validateProviderConfig(config)), { ...options, filename: 'provider-config.dpapi' });
}

export async function saveBackendKey(key, { directory = fileURLToPath(new URL('./.secrets/', import.meta.url)), platform = process.platform } = {}) {
  if (!/^AIza[\w-]{35}$/.test(key)) throw new Error('Invalid Google key format');
  return saveEncryptedSecret(key, { directory, platform, filename: 'google-key.dpapi' });
}

async function saveEncryptedSecret(key, { directory = fileURLToPath(new URL('./.secrets/', import.meta.url)), platform = process.platform, filename } = {}) {
  if (platform !== 'win32') return { storage: 'memory' };
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath' || name === 'GEMINI_API_KEY') delete env[name];
  // The key travels over stdin, never in a command argument, temporary plaintext file or log.
  const command = "$ErrorActionPreference='Stop'; $secret=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $secret -AsPlainText -Force; $secret=$null; try { [Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure)) } finally { $secure.Dispose() }";
  const encrypted = await new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env, windowsHide: true, timeout: 10000, maxBuffer: 32768 }, (error, stdout) => {
      if (error || !/^[a-f0-9]{100,32768}$/i.test(stdout.trim())) reject(new Error('Windows key encryption failed'));
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(key);
  });
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, filename));
  } finally { await rm(temporary, { force: true }); }
  return { storage: 'windows-encrypted' };
}
