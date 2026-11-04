import unittest, tempfile, os, stat
from pathlib import Path
from unittest.mock import patch
import migrate
from contextlib import contextmanager, ExitStack
import errno, io
from contextlib import redirect_stdout

@contextmanager
def isolated_filesystem():
    """Real FD operations confined to a disposable, unprivileged fixture.

    Only the filesystem root and root-owner policy are mocked; directory modes,
    no-follow traversal, regular-file checks and atomic writes remain real.
    Never run Migration.preflight/main or an actual service command here.
    """
    if os.geteuid() == 0: raise RuntimeError('tests require an unprivileged user')
    with tempfile.TemporaryDirectory(prefix='snow-test-') as directory, ExitStack() as stack:
        root = Path(directory)
        real_parent = migrate.trusted_parent
        def fixture_parent(path):
            relative = Path(path).relative_to(root)  # refuse any outside target
            return real_parent(Path('/') / relative)
        def fixture_owner(s):
            if s.st_uid != os.geteuid(): raise ValueError('foreign fixture owner')
        stack.enter_context(patch.object(migrate, 'open_root', lambda: os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)))
        stack.enter_context(patch.object(migrate, 'trusted_parent', fixture_parent))
        stack.enter_context(patch.object(migrate, 'require_root_owner', fixture_owner))
        mask = os.umask(0o077)
        try: yield root
        finally: os.umask(mask)

class EnvironmentTests(unittest.TestCase):
    def test_exact_single_line_preserves_every_other_byte(self):
        raw = b'# untouched\r\nTOKEN="secret # = value"\nLUCERN_SNOW_LOAD_API=https://old.onrender.com/api/snow-load\r\nOTHER=x'
        updated = migrate.replace_setting(raw)
        self.assertEqual(updated, raw.replace(b'https://old.onrender.com/api/snow-load', migrate.URL.encode()))
        for bad in (b'TOKEN=x\n', raw + b'\nLUCERN_SNOW_LOAD_API=x\n', b'LUCERN_SNOW_LOAD_API="unclosed\n', b'LUCERN_SNOW_LOAD_API=x\\\nnext\n'):
            with self.assertRaises(ValueError): migrate.replace_setting(bad)

class TransactionTests(unittest.TestCase):
    def test_atomic_preserves_mode_owner_and_refuses_symlink(self):
        with isolated_filesystem() as root:
            p = root/'env'; p.write_bytes(b'private'); p.chmod(0o640)
            before = p.stat()
            migrate.atomic(p, b'replaced', before)
            self.assertEqual(p.read_bytes(), b'replaced')
            after = p.stat()
            self.assertEqual((after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)), (before.st_uid, before.st_gid, 0o640))
            p.unlink(); p.symlink_to(root/'target')
            with self.assertRaises((ValueError,OSError)): migrate.read_regular(p)
            with self.assertRaises((ValueError,OSError)): migrate.atomic(p, b'unsafe', before)

    def test_failure_at_each_cutover_step_restores_env_and_stops_new_service(self):
        for failure in ('start', 'business', 'switch', 'restart', 'verify', 'enable'):
            with self.subTest(failure=failure):
                calls=[]
                def operation(name):
                    calls.append(name)
                    if name == failure: raise RuntimeError('injected')
                with self.assertRaises(RuntimeError): migrate.transaction(operation)
                self.assertEqual(calls[-1], 'rollback')

    def test_success_has_explicit_order_and_no_rollback(self):
        calls=[]; migrate.transaction(calls.append)
        self.assertEqual(calls, ['start','business','switch','restart','verify','enable'])

    def test_real_rollback_restores_private_bytes_after_partial_switch(self):
        from contextlib import ExitStack
        for failure in ('switch','restart','verify','enable'):
            with self.subTest(failure=failure), isolated_filesystem() as root, ExitStack() as stack:
                env=root/'backend.env'; unit=root/'snow.service'
                raw=b'TOKEN="fixture-only # secret"\nLUCERN_SNOW_LOAD_API=https://old.onrender.com/api/snow-load\n'
                env.write_bytes(raw); env.chmod(0o600); unit.write_text('fixture')
                (root/'current').symlink_to(root/'runtime')
                stack.enter_context(patch.object(migrate,'BASE',root))
                stack.enter_context(patch.object(migrate,'ENV',env))
                stack.enter_context(patch.object(migrate,'UNIT',unit))
                calls=[]
                stack.enter_context(patch.object(migrate,'ctl',lambda *a: calls.append(a) or ('inactive' if a[0]=='show' else 'active')))
                stack.enter_context(patch.object(migrate,'anonymous_denied',lambda: None))
                m=migrate.Migration(root); m.before=raw; m.meta=env.stat(); m.after=migrate.replace_setting(raw); m.installed=True
                def operation(step):
                    if step in ('start','business'): return
                    if step=='switch': m.operation(step)
                    if step==failure: raise RuntimeError('failure after boundary')
                    if step=='rollback': m.operation(step)
                with self.assertRaises(RuntimeError): migrate.transaction(operation)
                self.assertEqual(env.read_bytes(),raw)
                self.assertEqual(stat.S_IMODE(env.stat().st_mode),0o600)
                self.assertIn(('reset-failed','semapp.service'),calls)
                self.assertIn(('restart','semapp.service'),calls)
                self.assertIn(('disable','--now','semapp-snow.service'),calls)
                self.assertFalse(unit.exists()); self.assertFalse((root/'current').exists())

    def test_root_ownership_policy_rejects_unprivileged_owner(self):
        from types import SimpleNamespace
        with self.assertRaises(ValueError): migrate.require_root_owner(SimpleNamespace(st_uid=os.geteuid()))
        migrate.require_root_owner(SimpleNamespace(st_uid=0))

    def test_symlink_and_writable_ancestors_refused_for_reads_and_writes(self):
        for unsafe in ('symlink', 'group', 'world'):
            with self.subTest(unsafe=unsafe), isolated_filesystem() as root:
                parent=root/'parent'; parent.mkdir(mode=0o700)
                env=parent/'env'; env.write_bytes(b'unchanged'); env.chmod(0o600)
                meta=env.stat()
                if unsafe=='symlink':
                    parent.rename(root/'real'); parent.symlink_to(root/'real', target_is_directory=True)
                else: parent.chmod(0o720 if unsafe=='group' else 0o702)
                with self.assertRaises((ValueError,OSError)): migrate.read_regular(env)
                with self.assertRaises((ValueError,OSError)): migrate.atomic(env,b'unsafe',meta)
                actual=(root/'real'/'env') if unsafe=='symlink' else env
                self.assertEqual(actual.read_bytes(),b'unchanged')
                self.assertEqual(list(actual.parent.glob('.snow-*')),[])

    def test_atomic_replace_remains_anchored_during_parent_swap(self):
        with isolated_filesystem() as root:
            parent=root/'parent'; parent.mkdir(mode=0o700)
            env=parent/'env'; env.write_bytes(b'original'); env.chmod(0o600)
            other=root/'other'; other.mkdir(mode=0o700); (other/'env').write_bytes(b'do not change')
            replace=os.replace
            def swap_then_replace(src,dst,**kwargs):
                parent.rename(root/'held'); parent.symlink_to(other,target_is_directory=True)
                return replace(src,dst,**kwargs)
            with patch.object(migrate.os,'replace',swap_then_replace):
                migrate.atomic(env,b'replaced',env.stat())
            self.assertEqual((root/'held'/'env').read_bytes(),b'replaced')
            self.assertEqual((other/'env').read_bytes(),b'do not change')
            self.assertEqual(list((root/'held').glob('.snow-*')),[])

    def test_xattr_roundtrip_if_supported(self):
        with isolated_filesystem() as root:
            env=root/'env'; env.write_bytes(b'before'); env.chmod(0o640)
            try: os.setxattr(env,'user.snow-fixture',b'fixture value\x00')
            except OSError as error:
                if error.errno in (errno.ENOTSUP,errno.EOPNOTSUPP): self.skipTest('fixture filesystem has no user xattrs')
                raise
            meta=env.stat()
            attrs={key: os.getxattr(env,key) for key in os.listxattr(env)}
            migrate.atomic(env,b'after',meta)
            self.assertEqual({key: os.getxattr(env,key) for key in os.listxattr(env)},attrs)
            migrate.atomic(env,b'before',meta)
            self.assertEqual({key: os.getxattr(env,key) for key in os.listxattr(env)},attrs)
            self.assertEqual(os.getxattr(env,'user.snow-fixture'),b'fixture value\x00')
            self.assertEqual(env.read_bytes(),b'before')
            self.assertEqual(stat.S_IMODE(env.stat().st_mode),0o640)

    def test_rollback_restart_failure_keeps_upstream_and_evidence_without_success(self):
        with isolated_filesystem() as root, ExitStack() as stack:
            env=root/'backend.env'; unit=root/'snow.service'
            raw=b'LUCERN_SNOW_LOAD_API=https://old.onrender.com/api/snow-load\n'
            env.write_bytes(raw); env.chmod(0o600); unit.write_text('fixture')
            (root/'current').symlink_to(root/'runtime')
            evidence=root/'evidence'; evidence.mkdir(mode=0o700)
            (evidence/'backend.env.before').write_bytes(raw)
            for name,value in (('BASE',root),('ENV',env),('UNIT',unit)):
                stack.enter_context(patch.object(migrate,name,value))
            calls=[]
            def ctl(*args):
                calls.append(args)
                if args==('restart','semapp.service'): raise RuntimeError('fixture restart failure')
                return 'active'
            stack.enter_context(patch.object(migrate,'ctl',ctl))
            denied=stack.enter_context(patch.object(migrate,'anonymous_denied'))
            m=migrate.Migration(root); m.before=raw; m.meta=env.stat(); m.after=migrate.replace_setting(raw)
            m.changed=True; m.installed=True; migrate.atomic(env,m.after,m.meta)
            output=io.StringIO()
            with redirect_stdout(output), self.assertRaisesRegex(RuntimeError,'fixture restart failure'):
                migrate.transaction(lambda step: m.rollback() if step=='rollback' else (_ for _ in ()).throw(RuntimeError('cutover failed')))
            self.assertEqual(env.read_bytes(),raw)
            self.assertEqual(calls,[('reset-failed','semapp.service'),('restart','semapp.service')])
            denied.assert_not_called()
            self.assertTrue(unit.exists()); self.assertTrue((root/'current').is_symlink())
            self.assertEqual((evidence/'backend.env.before').read_bytes(),raw)
            self.assertNotIn('ROLLBACK_OK',output.getvalue()); self.assertNotIn('SNOW_MIGRATION_OK',output.getvalue())

    def test_partial_preparation_retains_recovery_evidence(self):
        for failure in ('state', 'reload'):
            with self.subTest(failure=failure), isolated_filesystem() as root, ExitStack() as stack:
                base=root/'base'; base.mkdir(mode=0o700); stage=root/'stage'; stage.mkdir(mode=0o700)
                (stage/'semapp-snow.service').write_text('fixture'); (stage/'semapp-snow.service').chmod(0o600)
                unit=root/'snow.service'; env=root/'env'; env.write_bytes(b'fixture'); env.chmod(0o600)
                for name,value in (('BASE',base),('ENV',env),('UNIT',unit)):
                    stack.enter_context(patch.object(migrate,name,value))
                def ctl(*args):
                    if failure=='reload' and args==('daemon-reload',): raise RuntimeError('fixture reload failure')
                    raise AssertionError('unexpected service call: '+str(args))
                stack.enter_context(patch.object(migrate,'ctl',ctl))
                m=migrate.Migration(stage); m.before=b'fixture'; m.after=b'after'; m.meta=env.stat()
                if failure=='state':
                    real_write=Path.write_text
                    def fail_state(path,*args,**kwargs):
                        if path.name=='state.json': raise RuntimeError('fixture state failure')
                        return real_write(path,*args,**kwargs)
                    stack.enter_context(patch.object(Path,'write_text',fail_state))
                with self.assertRaises(RuntimeError): m.prepare()
                if failure=='state': m.rollback()
                else:
                    # Isolate the cleanup boundary; the evidence itself is real.
                    stack.enter_context(patch.object(migrate,'ctl',lambda *a: 'inactive' if a[0]=='show' else None))
                    m.rollback()
                self.assertEqual(m.backup.read_bytes(),b'fixture')
                self.assertTrue((base/'evidence').is_dir())
                self.assertEqual(env.read_bytes(),b'fixture')
                self.assertEqual((base/'evidence'/'state.json').exists(),failure=='reload')

    def test_unit_protects_runtime_and_loopback(self):
        unit=Path(__file__).with_name('semapp-snow.service').read_text()
        for text in ('DynamicUser=yes','ProtectHome=true','ProtectSystem=strict','Environment=HOST=127.0.0.1','Environment=PORT=8096','NoNewPrivileges=true','UMask=0077','TimeoutStopSec=15'):
            self.assertIn(text,unit)
        self.assertNotIn('/home/',unit)

if __name__ == '__main__': unittest.main()
