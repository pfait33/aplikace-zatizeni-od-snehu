import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listenConfig } from '../listenConfig.js';
test('explicit host binds only loopback while Render default stays compatible', () => {
  assert.deepEqual(listenConfig({ HOST: '127.0.0.1', PORT: '8096' }), { host: '127.0.0.1', port: 8096 });
  assert.deepEqual(listenConfig({}), { host: '0.0.0.0', port: 3001 });
  assert.throws(() => listenConfig({ PORT: 'NaN' }));
});
