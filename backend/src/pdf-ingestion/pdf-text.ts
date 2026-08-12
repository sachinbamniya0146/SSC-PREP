/**
 * Text-layer extraction via pdfjs-dist legacy build (pure JS — no canvas
 * native deps, works on alpine). pdf-parse v2 pulls @napi-rs/canvas which
 * fails to load in the container; pdfjs legacy itself needs a global
 * DOMMatrix at import time (Node has none) — we polyfill a minimal 2D
 * implementation first.
 */

class SimpleDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: any) {
    if (init === undefined || init === null) return;
    if (typeof init === 'string') {
      this.setMatrixValue(init);
    } else if (Array.isArray(init)) {
      this.setMatrixValue(init);
    } else if (typeof init === 'object') {
      this.a = init.a ?? 1;
      this.b = init.b ?? 0;
      this.c = init.c ?? 0;
      this.d = init.d ?? 1;
      this.e = init.e ?? 0;
      this.f = init.f ?? 0;
    } else {
      throw new TypeError('SimpleDOMMatrix: unsupported init');
    }
  }

  setMatrixValue(v: any): any {
    if (typeof v === 'string') {
      const m = v.match(
        /matrix\(\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*\)/i,
      );
      if (!m) throw new TypeError('SimpleDOMMatrix: bad matrix string');
      [this.a, this.b, this.c, this.d, this.e, this.f] = m.slice(1).map(Number);
      return this;
    }
    if (Array.isArray(v) && v.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = v.slice(0, 6).map(Number);
      return this;
    }
    throw new TypeError('SimpleDOMMatrix: bad init value');
  }

  get m11() { return this.a; } set m11(v: number) { this.a = v; }
  get m12() { return this.b; } set m12(v: number) { this.b = v; }
  get m21() { return this.c; } set m21(v: number) { this.c = v; }
  get m22() { return this.d; } set m22(v: number) { this.d = v; }
  get m41() { return this.e; } set m41(v: number) { this.e = v; }
  get m42() { return this.f; } set m42(v: number) { this.f = v; }

  multiply(other: any) {
    const a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f;
    const o = other;
    return new SimpleDOMMatrix([
      a * o.a + c * o.b,
      b * o.a + d * o.b,
      a * o.c + c * o.d,
      b * o.c + d * o.d,
      a * o.e + c * o.f + e,
      b * o.e + d * o.f + f,
    ]);
  }
  translate(tx = 0, ty = 0) {
    return this.multiply(new SimpleDOMMatrix([1, 0, 0, 1, tx, ty]));
  }
  scale(sx = 1, sy = sx) {
    return this.multiply(new SimpleDOMMatrix([sx, 0, 0, sy, 0, 0]));
  }
  rotate(angle = 0) {
    const r = (angle * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return this.multiply(new SimpleDOMMatrix([cos, sin, -sin, cos, 0, 0]));
  }
  inverse() {
    const a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f;
    const det = a * d - b * c;
    if (!det) throw new TypeError('SimpleDOMMatrix: non-invertible matrix');
    return new SimpleDOMMatrix([
      d / det, -b / det, -c / det, a / det,
      (c * f - d * e) / det,
      (b * e - a * f) / det,
    ]);
  }
  transformPoint(p: any) {
    return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f, z: 0, w: 1 };
  }
  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
  static fromMatrix(m: any) {
    return new SimpleDOMMatrix(m);
  }
  static fromFloat32Array(arr: any) {
    return new SimpleDOMMatrix(Array.from(arr as any));
  }
  static fromFloat64Array(arr: any) {
    return new SimpleDOMMatrix(Array.from(arr as any));
  }
}

if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = SimpleDOMMatrix;
}

export async function extractPdfText(buf: Buffer): Promise<{ text: string; numpages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc: any = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // Preserve line structure: pdfjs marks line ends with hasEOL.
      let line = '';
      for (const item of tc.items as any[]) {
        const str = typeof item?.str === 'string' ? item.str : '';
        line += str;
        if (item.hasEOL) {
          text += line.replace(/\s+/g, ' ').trimEnd() + '\n';
          line = '';
        } else if (str) {
          line += ' ';
        }
      }
      if (line.trim()) text += line.trimEnd() + '\n';
    }
    return { text, numpages: doc.numPages };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* noop */
    }
  }
}