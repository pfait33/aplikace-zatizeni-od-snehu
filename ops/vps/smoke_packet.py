#!/usr/bin/python3
"""Exercise exact packaged runtime as current unprivileged user; never systemd."""
import json, os, subprocess, tempfile, time
from pathlib import Path
import bootstrap, migrate
OUT=Path('/home/falka/semapp-snow-vps-migration')

def main():
    assert os.geteuid()!=0
    manifest,files=bootstrap.unpack((OUT/'payload.tar').read_bytes())
    with tempfile.TemporaryDirectory(prefix='snow-runtime-') as directory:
        root=Path(directory)
        for name,content in files.items():
            target=root/name; target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(content); target.chmod(manifest['files'][name]['mode'])
        node=root/'runtime/node'; app=root/'runtime/app'
        version=subprocess.check_output([str(node),'--version'],text=True).strip()
        linked=subprocess.check_output(['/usr/bin/ldd',str(node)],text=True)
        assert 'not found' not in linked
        log=open(OUT/'daemon.log','w')
        p=subprocess.Popen([str(node),str(app/'dist/server.js')],cwd=app,stdout=log,stderr=log,
            env={'PATH':'/usr/bin:/bin','HOST':'127.0.0.1','PORT':'8096','NODE_ENV':'production'})
        try:
            for _ in range(40):
                if p.poll() is not None: raise RuntimeError('daemon exited')
                try:
                    health=migrate.request('http://127.0.0.1:8096/health')
                    if health=={'ok':True,'service':'snow-load-api'}: break
                except OSError: pass
                time.sleep(.1)
            else: raise RuntimeError('daemon not ready')
            listener=subprocess.check_output(['/usr/bin/ss','-ltnp','( sport = :8096 )'],text=True)
            assert '127.0.0.1:8096' in listener and '0.0.0.0:8096' not in listener and '[::]:8096' not in listener
            result=migrate.verify_business()
            migrate.anonymous_denied()
            # Validate actual live business body against the unchanged SEMAPP model.
            body=migrate.request('http://127.0.0.1:8096/api/snow-load?ku=B%C5%99asy&parcel=309%2F2',44)
            check="import sys,json; from backend.modules.snow_map.router import SnowMapResponse; r=SnowMapResponse.model_validate(json.load(sys.stdin)); assert r.snowLoad.sk and r.snowLoad.sk>0; print('SEMAPP_SCHEMA_OK')"
            schema=subprocess.run(['/opt/semapp/current/backend/.venv/bin/python','-c',check],cwd='/opt/semapp/current/backend',
                input=json.dumps(body),text=True,capture_output=True,check=True,env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'})
            evidence={'revision':manifest['revision'],'node':version,'health':health,'listener':listener,'brasy':result,
                      'secondResponse':body,'semappSchema':schema.stdout.strip(),'anonymousSnow':401,'ldd':linked}
            (OUT/'runtime-smoke.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
            print(json.dumps(evidence,ensure_ascii=False,indent=2))
        finally:
            p.terminate()
            try: p.wait(timeout=10)
            except subprocess.TimeoutExpired: p.kill(); p.wait(timeout=5)
            log.close()
    print('PACKAGED_RUNTIME_SMOKE_OK (unprivileged; production unchanged)')

if __name__=='__main__': main()
