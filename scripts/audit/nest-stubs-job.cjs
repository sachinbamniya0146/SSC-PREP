// Preload for specs / scripts that import real Nest services in a sandbox without node_modules: stubs @nestjs/common, @prisma/client and heavy services.
// Use: cd backend && tsx --require ../scripts/audit/nest-stubs.cjs ../scripts/audit/runspecs.cjs src/tests/tests.marking.spec.ts
const Module = require('module');
class E extends Error {}
const noop = () => () => {};
const nestStub = new Proxy({ BadRequestException: class extends E {}, NotFoundException: class extends E {}, ForbiddenException: class extends E {}, ConflictException: class extends E {}, Logger: class { log() {} warn() {} error() {} } }, { get: (t, k) => (k in t ? t[k] : noop) });
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Prisma: {}, AttemptStatus: { SUBMITTED: 'SUBMITTED', IN_PROGRESS: 'IN_PROGRESS' } };
  if (/study-plan-progress\.util$/.test(req)) return { applyAttemptToChapters: async () => undefined };
  if (/pyq-paper-builder$/.test(req)) return { legacyPaperCeiling: () => 0 };
  if (/\.spec(\.ts)?$/.test(req) || (/(bank-(upload-job|admin)|question-bank-practice)\.service$/.test(req) && !/\.\.\//.test(req))) return origLoad.call(this, req, parent, ...rest);
  if (/(weak-topic|prisma|gamification|telegram|question-bank-practice|features|search|admin|upload|bank-upload|monetization|referral)\.service$/.test(req) || /bank-upload|question-edit|meili/.test(req)) {
    return new Proxy({}, { get: (t, k) => (k === '__esModule' ? false : class {}) });
  }
  return origLoad.call(this, req, parent, ...rest);
};
