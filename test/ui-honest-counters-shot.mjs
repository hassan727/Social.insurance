// UI verification: honest partial/conflict counters in the smart-import
// result card on the RUNNING UI stack (port 3101), desktop + mobile.
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
    await page.waitForSelector('text=نتيجة الاستيراد', { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 4; i++) {
      const n = await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').count();
      if (!n) break;
      await page.locator('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="lose"]').first().click().catch(() => {});
      await sleep(400);
    }
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const hasCounterCard = body.includes('خطأ/تعارض يحتاج مراجعة');
    const hasErrBlock = body.includes('صفوف لم تُستورد وتحتاج مراجعة');
    const hasConflict = body.includes('تعارض حسابات');
    const hasPartialMsg = body.includes('اكتمل الاستيراد جزئيًا') || body.includes('لم تُعتمد اللقطة كاملة');
    const noFalseSuccess = !body.includes('تم استيراد 1 ورقة بنجاح');
    console.log(`${tag}: counterCard=${hasCounterCard} errBlock=${hasErrBlock} conflict=${hasConflict} partialMsg=${hasPartialMsg} noFalseSuccess=${noFalseSuccess}`);
    await page.screenshot({ path: `/downloads/e2e-honest-counters-${tag}.png`, fullPage: true });
    if (!hasCounterCard || !hasErrBlock || !hasConflict || !hasPartialMsg || !noFalseSuccess) failures++;
  } catch (e) {
    failures++;
    await page.screenshot({ path: `/downloads/e2e-honest-counters-FAIL-${tag}.png`, fullPage: true }).catch(() => {});
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`FAIL ${tag}: ${String(e).split('\n')[0]} | tail: ${txt.slice(-400).replace(/\n/g, ' | ')}`);
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'UI_CHECK_PASS' : 'UI_CHECK_FAIL');
process.exit(failures === 0 ? 0 : 1);
