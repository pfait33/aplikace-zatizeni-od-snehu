#!/usr/bin/python3
"""Runs only as root with PAYLOAD passed by a hash-pinned stdin launcher."""
import hashlib, io, json, os, stat, subprocess, tarfile
from pathlib import Path, PurePosixPath

def unpack(data):
    files={}
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as archive:
        for member in archive:
            name=member.name
            parts=PurePosixPath(name).parts
            if (not member.isfile() or name in files or not parts or name.startswith('/')
                    or any(p in ('.','..') for p in name.split('/')) or member.size > 150_000_000):
                raise ValueError('unsafe payload member')
            files[name]=archive.extractfile(member).read()
    manifest=json.loads(files.pop('MANIFEST.json'))
    expected=manifest['files']
    if set(files)!=set(expected): raise ValueError('payload allowlist mismatch')
    for name, content in files.items():
        spec=expected[name]
        if hashlib.sha256(content).hexdigest()!=spec['sha256'] or spec['mode'] not in (0o644,0o755):
            raise ValueError('payload hash/mode mismatch')
    revision=manifest['revision']
    if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision): raise ValueError('bad revision')
    if not {'migrate.py','semapp-snow.service','runtime/node','runtime/app/dist/server.js'} <= files.keys():
        raise ValueError('required runtime missing')
    return manifest,files

def trusted_dir(path):
    if not path.exists(): path.mkdir(mode=0o755); path.chmod(0o755)
    s=path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise ValueError('untrusted staging directory')

def main(payload):
    if os.geteuid()!=0: raise RuntimeError('operator sudo required')
    os.umask(0o077)
    manifest,files=unpack(payload)
    for path in ('/opt','/opt/semapp-snow','/opt/semapp-snow/releases'): trusted_dir(Path(path))
    target=Path('/opt/semapp-snow/releases')/manifest['revision']
    target.mkdir(mode=0o755); target.chmod(0o755)
    for name,content in files.items():
        path=target/name
        for ancestor in reversed(path.parent.parents):
            if ancestor==target or target in ancestor.parents: trusted_dir(ancestor)
        trusted_dir(path.parent)
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,manifest['files'][name]['mode'])
        with os.fdopen(fd,'wb') as stream:
            stream.write(content); os.fchmod(stream.fileno(),manifest['files'][name]['mode']); stream.flush(); os.fsync(stream.fileno())
    (target/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)); (target/'MANIFEST.json').chmod(0o644)
    # Payload has no install hooks, npm, archives with links, or home runtime.
    subprocess.run(['/usr/bin/python3','-I',str(target/'migrate.py')],check=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'})

if __name__=='__main__': main(PAYLOAD)
