#!/usr/bin/env python3
"""Run art acceptance checks and preserve exact exits/logs; restore dist on build failure."""
from pathlib import Path
import subprocess
import shutil
import tempfile
import os
import json
import hashlib
import datetime

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT.parent / 'agent-office-ledger/tycoon-canvas-milestone/spacing-quality'
PROOF.mkdir(parents=True, exist_ok=True)
BUN = '/home/tyler/.bun/bin/bun'
results = []

def run(name, command, cwd=ROOT):
    r = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (PROOF / (name + '.log')).write_text(r.stdout)
    results.append({'name': name, 'command': command, 'cwd': str(cwd), 'exit': r.returncode})
    (PROOF / 'verification-exits.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, 'EXIT', r.returncode, flush=True)
    if r.returncode:
        print(r.stdout)
    return r.returncode

assert run('export', ['python3', 'assets_src/vector/own_tycoon_sample/export_assets.py']) == 0
for pose, name in [('miro_typing_01', 'corrected_offline'), ('miro_typing_02', 'corrected_typing02'), ('miro_idle', 'corrected_idle')]:
    assert run('composite_' + pose, ['python3', 'artifacts/reproduce_layout.py', '--pose', pose, '--output', str(ROOT / 'artifacts' / (name + '.png'))]) == 0
checks = [
    run('verify_assets', ['python3', 'assets_src/vector/own_tycoon_sample/verify_assets.py']),
    run('bun-test', [BUN, 'test'], ROOT / 'web'),
    run('tsc', [BUN, 'x', 'tsc', '-p', 'tsconfig.json', '--noEmit'], ROOT / 'web'),
]
assert not any(checks), 'Prebuild checks failed; LIVE dist left untouched'
backup = Path(tempfile.mkdtemp(prefix='ao01-dist-', dir=os.environ['TMPDIR'])) / 'dist'
shutil.copytree(ROOT / 'web/dist', backup)
if run('build', [BUN, 'run', 'build'], ROOT / 'web'):
    shutil.rmtree(ROOT / 'web/dist')
    shutil.copytree(backup, ROOT / 'web/dist')
    raise SystemExit('Build failed, previous LIVE dist restored')
shutil.rmtree(backup.parent)
for name in ['current_repro.png', 'iteration1_offline.png', 'iteration1_offline_detail.png', 'iteration2_offline.png', 'iteration2_offline_detail.png', 'corrected_offline.png', 'corrected_offline_detail.png', 'corrected_offline.json', 'corrected_typing02.png', 'corrected_typing02_detail.png', 'corrected_idle.png', 'corrected_idle_detail.png']:
    shutil.copy2(ROOT / 'artifacts' / name, PROOF / name)
sync = {}
for src in (ROOT / 'web/public/assets/sample').iterdir():
    if src.is_file():
        dst = ROOT / 'web/dist/assets/sample' / src.name
        digest = hashlib.sha256(src.read_bytes()).hexdigest()
        assert hashlib.sha256(dst.read_bytes()).hexdigest() == digest, src.name
        sync[src.name] = digest
(PROOF / 'dist-sync.json').write_text(json.dumps({'checkedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'publicEqualsDist': sync}, indent=2) + '\n')
print('DIST SYNC PASS; proof:', PROOF)
