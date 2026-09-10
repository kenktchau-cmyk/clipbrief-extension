"""Package explicit public files only; fail closed if a Google credential is found."""
from pathlib import Path
import json
import re
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))['version']
client = ['manifest.json', 'background.js', 'panel.html', 'panel.css', 'panel.js', 'api.js', 'providers.js', 'core.js', 'extractor.js', 'demo.js', 'action-button.js', 'video-button-bridge.js', 'README.md'] + [f'icons/{size}.png' for size in (16, 32, 48, 128)]
client.append('inline-summary.js')
backend = client + ['setup.html', 'setup.css', 'setup.js', 'action-bars-preview.html', 'action-bars-preview.css', 'action-bars-preview.js', 'package.json', '.gitignore', 'server/app.js', 'server/key-store.js', 'server/summarizer.js', 'server/ai-provider.js', 'server/read-secret.ps1', 'server/set-key.ps1', 'scripts/preview.mjs', 'scripts/package.py', 'scripts/check-key-store.mjs'] + sorted(p.relative_to(root).as_posix() for p in (root / 'tests').glob('*.test.js'))
backend += ['comments-preview.html', 'comments-preview.css', 'comments-preview.js']
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
for name, files in [('extension', client), ('backend', backend)]:
    contents = {}
    for filename in files:
        source = root / filename
        if source.is_symlink() or not source.resolve().is_relative_to(root):
            raise RuntimeError('Unexpected package path')
        data = source.read_bytes()
        if re.search(rb'AIza[\w-]{35}', data):
            raise RuntimeError(f'Credential detected in {filename}; package aborted')
        contents[filename] = data
    target = artifacts / f'clipbrief-{name}-{version}.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for filename, data in contents.items():
            archive.writestr(filename, data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert not any('.secrets' in f or f.endswith('.dpapi') for f in archive.namelist())
        if name == 'extension':
            assert not any(f.startswith('server/') for f in archive.namelist())
    print(f'{target.name}: {len(contents)} files, {target.stat().st_size} bytes; credential scan passed')
