#!/usr/bin/python3
"""Unprivileged build only. Requires clean committed source; no production writes."""
import hashlib, io, json, os, shutil, stat, subprocess, tarfile, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/home/falka/semapp-snow-vps-migration')
NODE=Path('/home/falka/.hermes/node/bin/node')

def sha(data): return hashlib.sha256(data).hexdigest()

def build():
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT): raise RuntimeError('commit reviewed source first')
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    OUT.mkdir(mode=0o700,exist_ok=True)
    env=dict(os.environ,PATH=str(NODE.parent)+':'+os.environ['PATH'])
    files={}
    with tempfile.TemporaryDirectory(prefix='snow-build-') as d:
        temp=Path(d); app=temp/'app'; app.mkdir()
        for name in ('package.json','package-lock.json','tsconfig.json'):
            shutil.copy2(ROOT/'backend'/name,app/name)
        shutil.copytree(ROOT/'backend'/'src',app/'src')
        shutil.copytree(ROOT/'backend'/'data',app/'data')
        log=[]
        for command in (['npm','ci','--ignore-scripts'],['npm','test'],['npm','run','build'],['npm','prune','--omit=dev','--ignore-scripts'],['npm','audit','--omit=dev']):
            result=subprocess.run(command,cwd=app,env=env,capture_output=True,text=True)
            log.append('$ '+' '.join(command)+'\n'+result.stdout+result.stderr)
            if result.returncode:
                (OUT/'build.log').write_text('\n'.join(log)); raise RuntimeError('build command failed')
        (OUT/'build.log').write_text('\n'.join(log))
        # Only production compiled modules, data, package metadata, and pinned prod dependencies.
        for relative in ('dist','data','node_modules','package.json','package-lock.json'):
            path=app/relative
            paths=sorted(path.rglob('*')) if path.is_dir() else [path]
            for p in paths:
                if p.is_symlink():
                    # npm's .bin links are unused by direct Node runtime: skip only those.
                    if p.parent.name=='.bin': continue
                    raise RuntimeError('unexpected package symlink: '+str(p.relative_to(app)))
                if p.is_dir(): continue
                if not p.is_file() or p.stat().st_nlink!=1: raise RuntimeError('nonregular dependency')
                if p.name.endswith('.test.js'): continue
                files['runtime/app/'+str(p.relative_to(app))]=(p.read_bytes(),0o644)
        files['runtime/node']=(NODE.read_bytes(),0o755)
    for name in ('migrate.py','semapp-snow.service'):
        files[name]=((ROOT/'ops'/'vps'/name).read_bytes(),0o644)
    manifest={'revision':revision,'nodeVersion':subprocess.check_output([str(NODE),'--version'],text=True).strip(),
              'files':{n:{'sha256':sha(b),'size':len(b),'mode':m} for n,(b,m) in sorted(files.items())}}
    manifest_bytes=json.dumps(manifest,indent=2,sort_keys=True).encode()
    (OUT/'MANIFEST.json').write_bytes(manifest_bytes)
    files['MANIFEST.json']=(manifest_bytes,0o644)
    with tarfile.open(OUT/'payload.tar','w') as archive:
        for name,(content,mode) in sorted(files.items()):
            info=tarfile.TarInfo(name); info.size=len(content); info.mode=mode
            archive.addfile(info,io.BytesIO(content))
    bootstrap=(ROOT/'ops'/'vps'/'bootstrap.py').read_bytes()
    (OUT/'bootstrap.py').write_bytes(bootstrap)
    bpin=sha(bootstrap); ppin=sha((OUT/'payload.tar').read_bytes())
    rootcode=(f"import hashlib,sys; d=sys.stdin.buffer.read(); b,p=d[:{len(bootstrap)}],d[{len(bootstrap)}:]; "
              f"assert hashlib.sha256(b).hexdigest()=={bpin!r}; assert hashlib.sha256(p).hexdigest()=={ppin!r}; "
              "exec(compile(b,'<pinned-snow-bootstrap>','exec'),{'__name__':'__main__','PAYLOAD':p})")
    operator="""#!/usr/bin/python3
import hashlib,os,stat,subprocess,sys
from pathlib import Path
ROOT=Path('/home/falka/semapp-snow-vps-migration')
def capture(name,pin):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in ROOT.parts[1:]:
            n=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd); os.close(fd); fd=n
        f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
        with os.fdopen(f,'rb') as stream:
            s=os.fstat(stream.fileno()); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1
            data=stream.read()
        assert hashlib.sha256(data).hexdigest()==pin,'pin mismatch'
        return data
    finally: os.close(fd)
"""
    operator+=f'b=capture("bootstrap.py",{bpin!r}); p=capture("payload.tar",{ppin!r})\n'
    operator+="if sys.argv[1:]==['--verify-only']: print('PINNED_ARTIFACT_VERIFIED'); sys.exit(0)\nassert not sys.argv[1:]\n"
    operator+=f"sys.exit(subprocess.run(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-c',{rootcode!r}],input=b+p,env={{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/home/falka','LANG':'C'}}).returncode)\n"
    (OUT/'operator.py').write_text(operator)
    opin=sha(operator.encode())
    outer=f"import hashlib; p='/home/falka/semapp-snow-vps-migration/operator.py'; b=open(p,'rb').read(); assert hashlib.sha256(b).hexdigest()=={opin!r}; exec(compile(b,p,'exec'))"
    import shlex
    (OUT/'COMMAND.txt').write_text('sudo -v && /usr/bin/python3 -I -c '+shlex.quote(outer)+'\n')
    (OUT/'ROLLBACK.txt').write_text('sudo /usr/bin/python3 -I /opt/semapp-snow/releases/'+revision+'/migrate.py --rollback\n')
    for name in ('migrate.py','semapp-snow.service','bootstrap.py','build_packet.py','test_migrate.py','test_bootstrap.py','smoke_packet.py'):
        if name!='bootstrap.py': shutil.copy2(ROOT/'ops'/'vps'/name,OUT/name)
    print(json.dumps({'revision':revision,'files':len(manifest['files']),'bootstrap':bpin,'payload':ppin,'operator':opin},indent=2))

if __name__=='__main__': build()
