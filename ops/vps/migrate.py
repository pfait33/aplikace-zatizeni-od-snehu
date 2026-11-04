#!/usr/bin/python3
"""Scoped operator-only migration; no imports from application code."""
import os, re, stat
from pathlib import Path
URL = 'http://127.0.0.1:8096/api/snow-load'

def replace_setting(raw):
    lines = raw.splitlines(keepends=True)
    import shlex
    # Do not mistake a key embedded in a continued/quoted secret for a setting.
    for line in lines:
        if line.lstrip().startswith(b'#') or not line.strip(): continue
        if line.rstrip(b'\r\n').endswith(b'\\'): raise ValueError('continued env is unsupported')
        shlex.split(line.decode('utf8'), comments=False, posix=True)
    matches = [i for i, line in enumerate(lines) if re.match(rb'[ \t]*LUCERN_SNOW_LOAD_API[ \t]*=', line)]
    if len(matches) != 1: raise ValueError('expected exactly one snow API setting')
    i = matches[0]
    line = lines[i]
    ending = b'\r\n' if line.endswith(b'\r\n') else b'\n' if line.endswith(b'\n') else b''
    value = line.split(b'=', 1)[1].strip()
    if len(value) >= 2 and value[:1] == value[-1:] and value[:1] in (b'"', b"'"):
        value = value[1:-1]
    if not re.fullmatch(rb'https://[A-Za-z0-9.-]+\.onrender\.com/api/snow-load', value):
        raise ValueError('snow setting is not the expected single-line Render URL')
    lines[i] = b'LUCERN_SNOW_LOAD_API=' + URL.encode() + ending
    return b''.join(lines)

import fcntl, hashlib, json, signal, socket, subprocess, sys, time, urllib.request, urllib.error
BASE = Path('/opt/semapp-snow')
ENV = Path('/etc/semapp/backend.env')
UNIT = Path('/etc/systemd/system/semapp-snow.service')
BASELINE = '/opt/semapp/releases/9ddd3482302c3a37aa464025c563ebdc04b944d7-scoped'
SERVICE = 'semapp-snow.service'

from contextlib import contextmanager
import secrets

def require_root_owner(s):
    if s.st_uid != 0: raise ValueError('untrusted owner')

def open_root():
    return os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

@contextmanager
def trusted_parent(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or path == Path('/'):
        raise ValueError('absolute non-traversing file path required')
    directory = open_root()
    try:
        for component in (*path.parts[1:-1], None):
            s = os.fstat(directory)
            require_root_owner(s)
            if not stat.S_ISDIR(s.st_mode) or s.st_mode & 0o022:
                raise ValueError('untrusted ancestor')
            if component is not None:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                os.close(directory); directory = child
        yield directory, path.name
    finally:
        os.close(directory)

def checked_regular(fd):
    s = os.fstat(fd)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1: raise ValueError('unsafe file')
    require_root_owner(s)
    if s.st_mode & 0o022: raise ValueError('untrusted file')
    return s

def read_regular(path):
    with trusted_parent(path) as (directory, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            s = checked_regular(stream.fileno())
            return stream.read(), s

def atomic(path, data, metadata):
    # Read metadata and replace through the SAME validated, held directory FD.
    with trusted_parent(path) as (directory, name):
        source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            current = checked_regular(source)
            if (current.st_uid, current.st_gid, stat.S_IMODE(current.st_mode)) != (
                    metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)):
                raise ValueError('env metadata drift')
            attributes = {key: os.getxattr(source, key) for key in os.listxattr(source)}
        finally: os.close(source)
        tmp = '.snow-' + secrets.token_hex(16)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
                os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
                for key in os.listxattr(stream.fileno()):
                    if key not in attributes: os.removexattr(stream.fileno(),key)
                for key,value in attributes.items(): os.setxattr(stream.fileno(),key,value)
                os.fsync(stream.fileno())
            os.replace(tmp, name, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try: os.unlink(tmp, dir_fd=directory)
            except FileNotFoundError: pass

def transaction(operation):
    try:
        for step in ('start','business','switch','restart','verify','enable'): operation(step)
    except BaseException:
        operation('rollback')
        raise

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=150,
        env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','HOME':'/root'}).stdout.strip()

def ctl(*args): return run('/usr/bin/systemctl', *args)

def restart_semapp():
    ctl('reset-failed','semapp.service')
    ctl('restart','semapp.service')
    if ctl('is-active','semapp.service') != 'active': raise RuntimeError('SEMAPP not active')

def request(url, timeout=5):
    with urllib.request.urlopen(url,timeout=timeout) as response: return json.load(response)

def verify_business(base='http://127.0.0.1:8096'):
    started = time.monotonic()
    response = request(base+'/api/snow-load?ku=B%C5%99asy&parcel=309%2F2',44)
    elapsed = time.monotonic()-started
    parcel=response['parcel']; snow=response['snowLoad']; loc=response['location']
    cell=(2307-int((loc['lat']-48.4784934355)//0.0011467188)-1)*6228+int((loc['lon']-11.9284707974)//0.0011467188)
    if not (parcel['kuCode']=='613517' and parcel['parcelId']=='CPX.91830333010' and parcel['parcelNumber']=='309/2' and cell==7032856
            and isinstance(snow['sk'],(float,int)) and snow['sk']==0.85
            and response['snowArea']['code']=='II' and response['snowArea']['limit']==1
            and snow['unit']=='kPa' and 'clima-maps' in snow['source'] and response['warnings'] and elapsed < 45):
        raise RuntimeError('Brasy acceptance failed')
    return {'seconds':round(elapsed,3),'snowLoad':snow,'parcel':parcel,'cell':cell,'warnings':response['warnings']}

def anonymous_denied():
    url='http://127.0.0.1:8094/api/snow-map/lookup?cadastralArea=Brasy&parcelNumber=309%2F2'
    try: request(url)
    except urllib.error.HTTPError as error:
        if error.code==401: return
    raise RuntimeError('anonymous snow route must return 401')

class Migration:
    def __init__(self, stage):
        self.stage=stage; self.changed=False; self.started=False; self.installed=False
        self.before=None; self.meta=None
        self.backup=BASE/'evidence'/'backend.env.before'

    def preflight(self):
        if os.geteuid()!=0: raise RuntimeError('root operator required')
        if str(Path('/opt/semapp/current').resolve()) != BASELINE: raise RuntimeError('SEMAPP baseline changed')
        for path,pin in ((Path('/etc/systemd/system/semapp.service'),'b8c9cad5a45455fdc47499f114f327b7735f541df4383f13d28bc6c76b2916fe'),
                         (Path(BASELINE)/'ops/modulon/check.py','9b4fc33fcef1a4b9bbf0eec6ed1e345b07db50f64bf4fcdf706a17eaa7ca9e57')):
            if hashlib.sha256(read_regular(path)[0]).hexdigest()!=pin: raise RuntimeError('SEMAPP unit/readiness changed')
        if ctl('show','semapp.service','-p','DropInPaths','--value'): raise RuntimeError('unreviewed SEMAPP drop-ins')
        if ctl('is-active','semapp.service')!='active': raise RuntimeError('SEMAPP inactive')
        anonymous_denied()
        for p in (UNIT, BASE/'current', BASE/'evidence'):
            if os.path.lexists(p): raise RuntimeError('migration already exists; do not overwrite')
        if ctl('show', SERVICE, '-p','LoadState','--value') != 'not-found': raise RuntimeError('snow unit already exists')
        with socket.socket() as s: s.bind(('127.0.0.1',8096))
        self.before,self.meta=read_regular(ENV)
        if self.meta.st_mode & 0o007: raise RuntimeError('secret env is world-accessible')
        self.after=replace_setting(self.before)
        self.pid=ctl('show','semapp.service','-p','MainPID','--value')

    def prepare(self):
        evidence=BASE/'evidence'; evidence.mkdir(mode=0o700)
        self.backup.write_bytes(self.before); self.backup.chmod(0o600)
        state={'env_hash':hashlib.sha256(self.before).hexdigest(), 'after_hash':hashlib.sha256(self.after).hexdigest(),
               'uid':self.meta.st_uid,'gid':self.meta.st_gid,'mode':stat.S_IMODE(self.meta.st_mode),
               'baseline':BASELINE,'stage':str(self.stage)}
        (evidence/'state.json').write_text(json.dumps(state,indent=2)); (evidence/'state.json').chmod(0o600)
        self.installed=True
        (BASE/'current').symlink_to(self.stage/'runtime')
        UNIT.write_bytes(read_regular(self.stage/'semapp-snow.service')[0]); UNIT.chmod(0o644)
        ctl('daemon-reload')

    def rollback(self):
        # Restore SEMAPP before removing its upstream; fail closed on config drift.
        if self.changed:
            current,_=read_regular(ENV)
            if current not in (self.before,self.after): raise RuntimeError('env drift: manual recovery required')
            atomic(ENV,self.before,self.meta)
            restart_semapp(); anonymous_denied()
            if read_regular(ENV)[0]!=self.before: raise RuntimeError('rollback readback mismatch')
        if self.installed:
            if UNIT.exists():
                ctl('disable','--now',SERVICE)
                if ctl('show',SERVICE,'-p','ActiveState','--value') not in ('inactive','failed'):
                    raise RuntimeError('snow did not stop')
                UNIT.unlink()
            ctl('daemon-reload')
            if os.path.lexists(BASE/'current'): (BASE/'current').unlink()
        if self.changed:
            print('ROLLBACK_OK: original Render env and service restored; retained private evidence')
        else:
            print('PREPARATION_RECOVERY: env cutover not attempted; retained evidence/releases require manual inspection and cleanup')

    def operation(self, step):
        if step=='rollback': return self.rollback()
        if step=='start':
            self.started=True; ctl('start',SERVICE)
            for attempt in range(30):
                try:
                    if request('http://127.0.0.1:8096/health')=={'ok':True,'service':'snow-load-api'}: break
                except (OSError,ValueError): pass
                time.sleep(0.3)
            else: raise RuntimeError('snow readiness timeout')
            pid=ctl('show',SERVICE,'-p','MainPID','--value')
            if Path('/proc/'+pid+'/exe').resolve()!=self.stage/'runtime'/'node': raise RuntimeError('wrong snow runtime')
        elif step=='business':
            result=verify_business()
            (BASE/'evidence'/'brasy.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        elif step=='switch':
            if read_regular(ENV)[0]!=self.before: raise RuntimeError('env changed before switch')
            self.changed=True; atomic(ENV,self.after,self.meta)
            if read_regular(ENV)[0]!=self.after: raise RuntimeError('env switch readback mismatch')
        elif step=='restart': restart_semapp()
        elif step=='verify':
            anonymous_denied()
            if ctl('show','semapp.service','-p','MainPID','--value')==self.pid: raise RuntimeError('SEMAPP did not restart')
            if str(Path('/opt/semapp/current').resolve())!=BASELINE: raise RuntimeError('SEMAPP code changed')
            if request('http://127.0.0.1:8096/health')['ok'] is not True: raise RuntimeError('snow unhealthy')
        elif step=='enable':
            ctl('enable',SERVICE)
            if ctl('is-enabled',SERVICE)!='enabled': raise RuntimeError('snow not enabled')
            (BASE/'evidence'/'SUCCESS').write_text('SNOW_MIGRATION_OK\n')

def main():
    os.umask(0o077)
    os.environ.clear(); os.environ['PATH']='/usr/sbin:/usr/bin:/sbin:/bin'
    if os.geteuid()!=0: raise RuntimeError('root required')
    lock=os.open('/run/semapp-snow-migration.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    def interrupted(*_): raise KeyboardInterrupt('migration interrupted')
    signal.signal(signal.SIGTERM,interrupted); signal.signal(signal.SIGINT,interrupted)
    if sys.argv[1:]==['--rollback']:
        state=json.loads(read_regular(BASE/'evidence'/'state.json')[0])
        migration=Migration(Path(state['stage']))
        migration.before,_=read_regular(migration.backup)
        if hashlib.sha256(migration.before).hexdigest()!=state['env_hash']: raise RuntimeError('backup hash mismatch')
        migration.after=replace_setting(migration.before)
        from types import SimpleNamespace
        migration.meta=SimpleNamespace(st_uid=state['uid'],st_gid=state['gid'],st_mode=state['mode'])
        migration.changed=True; migration.installed=True; migration.rollback()
        return
    if sys.argv[1:]: raise RuntimeError('unsupported arguments')
    migration=Migration(Path(__file__).resolve().parent)
    migration.preflight()
    try:
        migration.prepare()
        transaction(migration.operation)
    except BaseException:
        if not migration.started: migration.rollback()
        raise
    print('SNOW_MIGRATION_OK: loopback upstream checked; SEMAPP restarted; anonymous=401')
    print('Authenticated SEMAPP browser acceptance remains required; no auth bypass was used.')

if __name__=='__main__':
    try: main()
    except BaseException as error:
        print('MIGRATION_FAILED: '+type(error).__name__+' (details intentionally not logged)',file=sys.stderr)
        sys.exit(1)
