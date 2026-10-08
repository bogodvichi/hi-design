'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

describe('test/config/config_default.test.js', () => {
  it('uses one stable listen port for every cluster worker', () => {
    const configPath = require.resolve('../../config/config.default.js');
    const cachedConfig = require.cache[configPath];
    const originalExecSync = childProcess.execSync;

    delete require.cache[configPath];
    childProcess.execSync = () => {
      throw new Error('port probe must not affect cluster config');
    };

    try {
      const createConfig = require(configPath);
      const config = createConfig({
        name: 'hidesign-web',
        baseDir: path.resolve(__dirname, '../..'),
      });
      assert.strictEqual(config.cluster.listen.port, 7002);
    } finally {
      childProcess.execSync = originalExecSync;
      if (cachedConfig) require.cache[configPath] = cachedConfig;
      else delete require.cache[configPath];
    }
  });
});
