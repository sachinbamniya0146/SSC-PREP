// Preload for sandboxes WITHOUT node_modules (S37, 29 Oct 2026): a tiny stand-in for the two packages the upload / template code needs.
//   - 'xlsx'  : utils.{book_new, aoa_to_sheet, book_append_sheet, encode_cell, sheet_to_json}, read(), write() - REAL .xlsx files
//               (stored zip + inline strings), so the output opens in Excel / openpyxl and can be inspected in a test.
//   - 'jszip' : the real package when it is found on this machine (it is only used on the generated file).
// It is an aid for the sandbox, NOT a replacement for the real packages and NOT used by the build or by CI.
// Use:  cd backend && tsx --require ../scripts/audit/xlsx-lite.cjs ../scripts/audit/runspecs.cjs src/bank/practice-template.service.spec.ts
const Module = require('module');
const zlib = require('zlib');
const fs = require('fs');

// ---------- minimal zip (store only) ----------
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameB, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += lh.length + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
function unzipStore(buf) {
  // walk the local headers (works for files written by zipStore; real deflated zips are handled through zlib)
  const out = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const elen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nlen);
    const start = p + 30 + nlen + elen;
    const raw = buf.subarray(start, start + csize);
    out[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    p = start + csize;
  }
  return out;
}

// ---------- xlsx ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
function colLetter(i) { let n = i, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }
function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
const utils = {
  book_new: () => ({ SheetNames: [], Sheets: {} }),
  encode_cell: ({ r, c }) => `${colLetter(c)}${r + 1}`,
  aoa_to_sheet: (aoa) => {
    const ws = {};
    let maxC = 0;
    aoa.forEach((row, r) => row.forEach((v, c) => {
      if (v === undefined || v === null || v === '') return;
      ws[`${colLetter(c)}${r + 1}`] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
      if (c > maxC) maxC = c;
    }));
    ws['!ref'] = `A1:${colLetter(maxC)}${Math.max(aoa.length, 1)}`;
    ws['!aoaRows'] = aoa.length;
    return ws;
  },
  book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  sheet_to_json: (ws, opt = {}) => {
    const rows = [];
    const keys = Object.keys(ws).filter((k) => !k.startsWith('!'));
    let maxR = ws['!aoaRows'] || 0;
    for (const k of keys) { const m = /^([A-Z]+)(\d+)$/.exec(k); if (m) maxR = Math.max(maxR, Number(m[2])); }
    const maxC = ws['!ref'] ? colIndex(/:([A-Z]+)/.exec(ws['!ref'])[1]) : 0;
    for (let r = 1; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) { const cell = ws[`${colLetter(c)}${r}`]; row.push(cell ? cell.v : opt.defval !== undefined ? opt.defval : undefined); }
      if (opt.blankrows === false && row.every((x) => x === '' || x === undefined)) continue;
      rows.push(row);
    }
    return opt.header === 1 ? rows : rows;
  },
  decode_range: () => ({}),
};
function write(wb) {
  const files = [];
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.SheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wb.SheetNames.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.SheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`]);
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const byRow = new Map();
    for (const k of Object.keys(ws)) { const m = /^([A-Z]+)(\d+)$/.exec(k); if (!m) continue; const r = Number(m[2]); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push([colIndex(m[1]), k, ws[k]]); }
    const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((r) => `<row r="${r}">${byRow.get(r).sort((a, b) => a[0] - b[0]).map(([, k, cell]) => (cell.t === 'n' ? `<c r="${k}"><v>${cell.v}</v></c>` : `<c r="${k}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v).replace(/\n/g, '&#10;')}</t></is></c>`)).join('')}</row>`).join('');
    const cols = ws['!cols'] ? `<cols>${ws['!cols'].map((c, n) => `<col min="${n + 1}" max="${n + 1}" width="${c.wch || 10}" customWidth="1"/>`).join('')}</cols>` : '';
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${ws['!ref'] || 'A1'}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`]);
  });
  return zipStore(files);
}
function read(buf) {
  const z = unzipStore(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const wbXml = z['xl/workbook.xml'] || '';
  const names = [...wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((m) => unesc(m[1]));
  const wb = { SheetNames: names, Sheets: {} };
  // S43: shared strings too (files written by Excel / openpyxl), so a real workbook can be read in a sandbox test
  const shared = [...(z['xl/sharedStrings.xml'] || '').matchAll(/<si>(.*?)<\/si>/gs)].map((m) => [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((x) => unesc(x[1])).join(''));
  names.forEach((n, i) => {
    const xml = z[`xl/worksheets/sheet${i + 1}.xml`] || '';
    const ws = {};
    let maxC = 0, maxR = 0;
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const body = m[4] || '';
      const t = /<t[^>]*>(.*?)<\/t>/s.exec(body);
      const v = /<v>(.*?)<\/v>/s.exec(body);
      if (!t && !v) continue;
      const isShared = /\bt="s"/.test(m[3]);
      ws[`${m[1]}${m[2]}`] = t ? { t: 's', v: unesc(t[1]) } : isShared ? { t: 's', v: shared[Number(v[1])] ?? '' } : { t: 'n', v: v ? Number(v[1]) : '' };
      maxC = Math.max(maxC, colIndex(m[1])); maxR = Math.max(maxR, Number(m[2]));
    }
    ws['!ref'] = `A1:${colLetter(maxC)}${Math.max(maxR, 1)}`;
    ws['!aoaRows'] = maxR;
    wb.Sheets[n] = ws;
  });
  return wb;
}
const XLSX = { utils, write, read, version: 'lite' };

let realJsZip = null;
for (const p of ['/opt/npm-tools/node_modules/jszip', '/opt/node-tools/node_modules/jszip']) { try { if (fs.existsSync(p)) { realJsZip = require(p); break; } } catch { /* next */ } }

const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'xlsx') return XLSX;
  if (req === 'jszip' && realJsZip) return realJsZip;
  return origLoad.call(this, req, parent, ...rest);
};
module.exports = { XLSX, zipStore, unzipStore };
