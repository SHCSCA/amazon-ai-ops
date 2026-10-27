const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function loadWithAccessiblePort(file) {
  const absolute = path.resolve('scripts', file), module = { exports: {} };
  const hostRequire = require('node:module').createRequire(absolute);
  const port = hostRequire('./v16-ui-accessible-node-test-port.cjs');
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(absolute, 'utf8') + '\n})', { filename: absolute })(
    request => request === './v16-ui-accessible-node' ? port : hostRequire(request), module, module.exports);
  return module.exports;
}
module.exports = { loadWithAccessiblePort };
