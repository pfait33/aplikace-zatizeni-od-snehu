import unittest, tempfile, os, stat
from pathlib import Path
from unittest.mock import patch
import migrate

class EnvironmentTests(unittest.TestCase):
    def test_exact_single_line_preserves_every_other_byte(self):
        raw = b'# untouched\r\nTOKEN="secret # = value"\nLUCERN_SNOW_LOAD_API=https://old.onrender.com/api/snow-load\r\nOTHER=x'
        updated = migrate.replace_setting(raw)
        self.assertEqual(updated, raw.replace(b'https://old.onrender.com/api/snow-load', migrate.URL.encode()))
        for bad in (b'TOKEN=x\n', raw + b'\nLUCERN_SNOW_LOAD_API=x\n', b'LUCERN_SNOW_LOAD_API="unclosed\n', b'LUCERN_SNOW_LOAD_API=x\\\nnext\n'):
            with self.assertRaises(ValueError): migrate.replace_setting(bad)

class TransactionTests(unittest.TestCase):
    def test_atomic_preserves_mode_owner_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'env'; p.write_bytes(b'private'); p.chmod(0o640)
            before = p.stat()
            migrate.atomic(p, b'replaced', before)
            self.assertEqual(p.read_bytes(), b'replaced')
            after = p.stat()
            self.assertEqual((after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)), (before.st_uid, before.st_gid, 0o640))
            p.unlink(); p.symlink_to(Path(d)/'target')
            with self.assertRaises((ValueError,OSError)): migrate.read_regular(p, trusted=False)

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
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as d, ExitStack() as stack:
                root=Path(d); env=root/'backend.env'; unit=root/'snow.service'
                raw=b'TOKEN="fixture-only # secret"\nLUCERN_SNOW_LOAD_API=https://old.onrender.com/api/snow-load\n'
                env.write_bytes(raw); env.chmod(0o600); unit.write_text('fixture')
                (root/'current').symlink_to(root/'runtime')
                stack.enter_context(patch.object(migrate,'BASE',root))
                stack.enter_context(patch.object(migrate,'ENV',env))
                stack.enter_context(patch.object(migrate,'UNIT',unit))
                real_read=migrate.read_regular
                stack.enter_context(patch.object(migrate,'read_regular',lambda p: real_read(p,trusted=False)))
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

    def test_unit_protects_runtime_and_loopback(self):
        unit=Path(__file__).with_name('semapp-snow.service').read_text()
        for text in ('DynamicUser=yes','ProtectHome=true','ProtectSystem=strict','Environment=HOST=127.0.0.1','Environment=PORT=8096','NoNewPrivileges=true','UMask=0077','TimeoutStopSec=15'):
            self.assertIn(text,unit)
        self.assertNotIn('/home/',unit)

if __name__ == '__main__': unittest.main()
