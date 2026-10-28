// Mini linter: approximates the error-level typescript-eslint v8 "recommended" + react-hooks/rules-of-hooks rules.
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/npm-tools/node_modules/typescript'); } })();
const fs = require('fs'), path = require('path');
const root = process.argv[2]; const mode = process.argv[3] || 'frontend';
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.next' || e.name==='dist') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p); } return out; }
const res = [];
for (const f of walk(root)) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rep = (n, rule, msg) => { const { line } = sf.getLineAndCharacterOfPosition(n.getStart()); res.push(`${f}:${line + 1} ${rule} ${msg || ''}`); };
  // ban-ts-comment
  const re = /\/\/\s*@ts-(ignore|nocheck|expect-error)(?!.*\S{3,}.*\S{3,})/g; let m;
  const lines = src.split('\n'); lines.forEach((l, i) => { if (/\/\/\s*@ts-(ignore|nocheck)/.test(l)) res.push(`${f}:${i + 1} ban-ts-comment`); if (/\/\/\s*@ts-expect-error\s*$/.test(l)) res.push(`${f}:${i + 1} ban-ts-comment(expect-error w/o desc)`); });
  // collect assigned names for prefer-const
  const assigned = new Map(); // name -> count of reassignments
  const mark = (id) => { if (ts.isIdentifier(id)) assigned.set(id.text, (assigned.get(id.text) || 0) + 1); };
  const markPat = (p) => { if (ts.isIdentifier(p)) mark(p); else if (ts.isArrayLiteralExpression(p)) p.elements.forEach(e => markPat(ts.isSpreadElement(e) ? e.expression : e)); else if (ts.isObjectLiteralExpression(p)) p.properties.forEach(pr => { if (ts.isShorthandPropertyAssignment(pr)) mark(pr.name); else if (ts.isPropertyAssignment(pr)) markPat(pr.initializer); else if (ts.isSpreadAssignment(pr)) markPat(pr.expression); }); else if (ts.isParenthesizedExpression(p)) markPat(p.expression); };
  (function pre(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) markPat(n.left);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) markPat(n.operand);
    if ((ts.isForInStatement(n) || ts.isForOfStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) markPat(n.initializer);
    ts.forEachChild(n, pre);
  })(sf);
  const hookName = (e) => { let name = null; if (ts.isIdentifier(e)) name = e.text; else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'React') name = e.name.text; return name && /^use[A-Z0-9]/.test(name) ? name : null; };
  function visit(n) {
    // no-unused-expressions
    if (ts.isExpressionStatement(n)) {
      let e = n.expression; while (ts.isParenthesizedExpression(e)) e = e.expression;
      const ok = ts.isCallExpression(e) || ts.isNewExpression(e) || ts.isAwaitExpression(e) || ts.isYieldExpression(e) || ts.isDeleteExpression(e) || ts.isVoidExpression(e) || ts.isTaggedTemplateExpression(e) || (ts.isBinaryExpression(e) && e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && e.operatorToken.kind <= ts.SyntaxKind.LastAssignment) || ((ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) && (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) || (ts.isStringLiteral(e)) || ts.isNonNullExpression(e) && ts.isCallExpression(e.expression) || (ts.isCallChain && ts.isCallExpression(e));
      if (!ok) rep(n, 'no-unused-expressions', n.getText().slice(0, 70).replace(/\n/g, ' '));
    }
    // prefer-const
    if (mode === 'frontend' && ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Let)) {
      if (!(ts.isForStatement(n.parent) || ts.isForInStatement(n.parent) || ts.isForOfStatement(n.parent))) {
        for (const d of n.declarations) if (ts.isIdentifier(d.name) && d.initializer && !assigned.has(d.name.text)) rep(d, 'prefer-const', d.name.text);
      }
    }
    // types
    if (ts.isTypeLiteralNode(n) && n.members.length === 0 && !(ts.isIntersectionTypeNode(n.parent) )) rep(n, 'no-empty-object-type');
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && ['Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt'].includes(n.typeName.text)) rep(n, 'no-unsafe-function-type/wrapper', n.typeName.text);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && !ts.isImportEqualsDeclaration(n.parent)) rep(n, 'no-require-imports');
    if (ts.isModuleDeclaration(n) && !(n.flags & ts.NodeFlags.GlobalAugmentation) && ts.isIdentifier(n.name) && !n.getText().startsWith('declare global') && !(n.modifiers||[]).some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) rep(n, 'no-namespace');
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isThis && n.initializer.kind === ts.SyntaxKind.ThisKeyword) rep(n, 'no-this-alias');
    // rules-of-hooks (function-level)
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body)) {
      let nm = null; if (ts.isFunctionDeclaration(n) && n.name) nm = n.name.text; else if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) nm = n.parent.name.text; else if (ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) && /^(memo|forwardRef)$/.test(n.parent.expression.text)) nm = 'Component';
      if (nm && /^(use[A-Z]|[A-Z])/.test(nm)) checkHooks(n, nm);
    }
    ts.forEachChild(n, visit);
  }
  function checkHooks(fn, nm) {
    let sawReturn = false; const stmts = fn.body.statements;
    function scan(n, ctx) { // ctx: conditional depth flag
      if (ts.isFunctionLike(n) && n !== fn) return; // nested fn: hooks inside callbacks are another rule
      if (ts.isCallExpression(n)) { const h = hookName(n.expression); if (h) { if (ctx.cond) rep(n, 'rules-of-hooks', `${h} called conditionally in ${nm}`); else if (ctx.afterReturn) rep(n, 'rules-of-hooks', `${h} after early return in ${nm}`); } }
      if (ts.isIfStatement(n)) { scan(n.expression, ctx); scan(n.thenStatement, { ...ctx, cond: true }); if (n.elseStatement) scan(n.elseStatement, { ...ctx, cond: true }); return; }
      if (ts.isConditionalExpression(n)) { scan(n.condition, ctx); scan(n.whenTrue, { ...ctx, cond: true }); scan(n.whenFalse, { ...ctx, cond: true }); return; }
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) { scan(n.left, ctx); scan(n.right, { ...ctx, cond: true }); return; }
      if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isSwitchStatement(n) || ts.isTryStatement(n)) { ts.forEachChild(n, c => scan(c, { ...ctx, cond: true })); return; }
      ts.forEachChild(n, c => scan(c, ctx));
    }
    const ctx = { cond: false, afterReturn: false };
    for (const s of stmts) {
      scan(s, ctx);
      // top-level conditional early return: `if (...) return ...;` => everything after is "after early return"
      if (ts.isIfStatement(s) && containsReturn(s)) ctx.afterReturn = true;
      if (ts.isReturnStatement(s)) break;
    }
  }
  function containsReturn(n) { let f = false; (function w(x) { if (ts.isFunctionLike(x)) return; if (ts.isReturnStatement(x)) f = true; ts.forEachChild(x, w); })(n); return f; }
  visit(sf);
}
console.log(res.join('\n')); console.log('TOTAL', res.length);
