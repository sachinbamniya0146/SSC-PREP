/* Checks the student left-menu decision logic (session 19): the script that runs in <head> before the first paint must
 * agree with isSidebarRoute(), must never fire on exam / quiz / admin / login screens, and must pick the right width.
 *   node scripts/audit/sidebar-boot-test.cjs [repo-root]        (needs a TypeScript install: /opt/npm-tools or node_modules)
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[2] || ".");
let ts;
for (const p of ["typescript", "/opt/npm-tools/node_modules/typescript", path.join(root, "frontend/node_modules/typescript")]) {
  try { ts = require(p); break; } catch (e) { /* try next */ }
}
if (!ts) { console.error("TypeScript not found"); process.exit(2); }
const src = fs.readFileSync(path.join(root, "frontend/src/lib/student-nav.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const m = { exports: {} };
new Function("module", "exports", js)(m, m.exports);
const { SIDEBAR_BOOT_SCRIPT, isSidebarRoute, STUDENT_NAV, isNavItemActive, SIDEBAR_ROUTES } = m.exports;

function run(p, store, width) {
  const cls = new Set();
  const doc = { documentElement: { classList: { add: (c) => cls.add(c) } } };
  new Function("location", "localStorage", "document", "window", SIDEBAR_BOOT_SCRIPT)(
    { pathname: p }, { getItem: (k) => (k in store ? store[k] : null) }, doc, { innerWidth: width });
  return [...cls].sort().join(" ") || "(none)";
}
const T = { ssc_access_token: "x" };
const cases = [
  ["/dashboard", T, 1280, "has-sidebar"],
  ["/dashboard", T, 820, "has-sidebar sidebar-rail"],
  ["/dashboard", { ...T, ssc_sidebar: "rail" }, 1280, "has-sidebar sidebar-rail"],
  ["/dashboard", { ...T, ssc_sidebar: "full" }, 820, "has-sidebar"],
  ["/dashboard", {}, 1280, "(none)"],
  ["/test", T, 1280, "(none)"], ["/test/abc", T, 1280, "(none)"], ["/cgl-test", T, 1280, "(none)"], ["/quiz", T, 1280, "(none)"],
  ["/weak-practice", T, 1280, "(none)"], ["/results", T, 1280, "(none)"], ["/verification", T, 1280, "(none)"],
  ["/admin", T, 1280, "(none)"], ["/admin/questions/review", T, 1280, "(none)"],
  ["/login", T, 1280, "(none)"], ["/signup", T, 1280, "(none)"], ["/", T, 1280, "(none)"], ["/pricing", T, 1280, "(none)"],
  ["/review", T, 1280, "has-sidebar"], ["/question-bank-practice", T, 1280, "has-sidebar"], ["/question-bank/xyz", T, 1280, "has-sidebar"],
  ["/mocks/", T, 1280, "has-sidebar"], ["/sectional", T, 1280, "has-sidebar"], ["/year-wise", T, 1280, "has-sidebar"],
];
let bad = 0;
for (const [p, s, w, exp] of cases) {
  const got = run(p, s, w);
  const ok = got === exp;
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", p, JSON.stringify(s), w, "->", got, ok ? "" : "(expected " + exp + ")");
  if ((exp !== "(none)") && !(("ssc_access_token" in s) && isSidebarRoute(p))) { bad++; console.log("PARITY FAIL", p); }
  if (("ssc_access_token" in s) && isSidebarRoute(p) !== (got !== "(none)")) { bad++; console.log("PARITY FAIL", p); }
}
// every menu link must itself be a sidebar route (no dead end where the menu vanishes), and exactly one item is active
const items = STUDENT_NAV.flatMap((g) => g.items);
for (const it of items) if (!isSidebarRoute(it.href)) { bad++; console.log("FAIL menu link outside SIDEBAR_ROUTES:", it.href); }
for (const r of SIDEBAR_ROUTES) {
  const n = items.filter((i) => isNavItemActive(i, r)).length;
  if (n > 1) { bad++; console.log("FAIL two active items on", r); }
}
const hrefs = items.map((i) => i.href);
if (new Set(hrefs).size !== hrefs.length) { bad++; console.log("FAIL duplicate hrefs"); }
console.log(bad ? `${bad} FAILED` : `ALL OK (${cases.length} cases, ${items.length} menu items)`);
process.exit(bad ? 1 : 0);
