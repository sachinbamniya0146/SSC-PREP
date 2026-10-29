// Preload: jest.mock('../search/search.service') stand-in for the sandbox shim (no jest here).
const Module = require('module');
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (/search[\\/]search\.service$/.test(req) || req === '../search/search.service') return { SearchService: class {} };
  return orig.call(this, req, parent, ...rest);
};

