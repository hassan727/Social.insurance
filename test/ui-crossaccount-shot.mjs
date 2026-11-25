// UI verification: cross-account blocked rows visible in smart-import result
// card on the RUNNING sim stack (port 3101), desktop + mobile.
import { chromium } from 'playwright-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
let failures = 0;
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  try {
    await page.goto('http://localhost:3101/smart-import', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    await page.locator('button:has-text("مودرن")').first().click({ timeout: 20000 });
    await page.setInputFiles('#file-input', '/tmp/mg-known-case.xlsx');
    await sleep(800);
    await page.locator('button:has-text("تحليل الملف")').first().click({ timeout: 15000 });
    await page.waitForSelector('text=/استيراد \\d+ ورقة/', { timeout: 45000 });
    await page.locator('button:has-text("استيراد")').last().click({ timeout: 15000 });
    await page.waitForSelector('text=تحذيرات تحتاج مراجعة', { timeout: 60000 });
    for (let i = 0; i < 4; i++) {
      const n = await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').count();
      if (!n) break;
      await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').first().click().catch(() => {});
      await sleep(400);
    }
    const body = await page.locator('main').innerText().catch(() => '');
    const hasCross = body.includes('حساب آخر');
    const hasPartial = body.includes('لم تُعتبر لقطة كاملة');
    console.log(`${tag}: cross-account warning visible=${hasCross} partial-sync warning visible=${hasPartial}`);
    await page.screenshot({ path: `/downloads/e2e-crossaccount-blocked-${tag}.png`, fullPage: true });
    if (!hasCross || !hasPartial) failures++;
  } catch (e) {
    failures++;
    await page.screenshot({ path: `/downloads/e2e-crossaccount-blocked-FAIL-${tag}.png`, fullPage: true }).catch(() => {});
    const txt = await page.locator('main').innerText().catch(() => '');
    console.log(`FAIL ${tag}: ${String(e).split('\n')[0]} | tail: ${txt.slice(-400).replace(/\n/g, ' | ')}`);
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'UI_CHECK_PASS' : 'UI_CHECK_FAIL');
process.exit(failures === 0 ? 0 : 1);
