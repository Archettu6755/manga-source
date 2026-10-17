from pathlib import Path
import hashlib
import os
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
compiled, release = map(Path, sys.argv[1:])
with zipfile.ZipFile(compiled) as expected, zipfile.ZipFile(release) as published:
    names = {name for name in expected.namelist() if name.endswith('.dex') or name in ('AndroidManifest.xml', 'resources.arsc') or name.startswith(('res/', 'assets/'))}
    for name in names:
        if expected.read(name) != published.read(name):
            raise SystemExit('Signed APK does not match this source build: ' + name)
sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or '')
signer = sdk / 'build-tools' / '35.0.0' / ('apksigner.bat' if os.name == 'nt' else 'apksigner')
check = subprocess.run([str(signer), 'verify', '--print-certs', str(release)], text=True, capture_output=True, shell=os.name == 'nt')
if check.returncode:
    raise SystemExit('APK signature verification failed: ' + check.stderr)
fingerprint = (root / 'signing-fingerprint.txt').read_text().strip()
if fingerprint not in check.stdout:
    raise SystemExit('APK signer does not match the repository signing key')
print('Verified signed APK, source bytecode and resources. SHA-256:', hashlib.sha256(release.read_bytes()).hexdigest())
