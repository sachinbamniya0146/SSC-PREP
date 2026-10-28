require('./jestshim.cjs');
const path = require('path');
for (const f of process.argv.slice(2)) require(path.resolve(f));
globalThis.__run();
