// v6 §7 — Chromium PDF renderer (puppeteer-core). Uses system/container Chrome.
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PdfRenderer {
  // Resolve Chrome executable: env override → container chromium → macOS app
  private resolveChrome(): string {
    const env = process.env.CHROME_PATH;
    if (env && fs.existsSync(env)) return env;
    const container = '/usr/bin/chromium-browser';
    if (fs.existsSync(container)) return container;
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(mac)) return mac;
    const linux = '/usr/bin/chromium';
    if (fs.existsSync(linux)) return linux;
    throw new Error('No Chrome/Chromium executable found — set CHROME_PATH');
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: this.resolveChrome(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: 'new' as any,
    });
    try {
      const page = await browser.newPage();
      // Inject Devanagari font as base64 (file:// blocked in setContent)
      const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansDevanagari-Regular.ttf');
      const fontB64 = fs.existsSync(fontPath)
        ? fs.readFileSync(fontPath).toString('base64')
        : '';
      if (fontB64) {
        html = html.replace(
          '</head>',
          `<style>@font-face{font-family:'deva';src:url(data:font/ttf;base64,${fontB64})}</style></head>`,
        );
      }
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}
