import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

try {
  console.log('Opening dev server...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });

  console.log('Page loaded. Screenshot saved.');
  await page.screenshot({ path: 'test-screenshot.png', fullPage: true });

  // Get page content to check for images
  const content = await page.content();

  // Look for picsum URLs
  const matches = content.match(/https:\/\/picsum\.photos\/[^\s"<]+/g) || [];
  console.log(`Found ${matches.length} picsum.photos URLs in page`);
  matches.slice(0, 3).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });

  // Wait a moment to see the browser
  await page.waitForTimeout(3000);

} catch (e) {
  console.error('Error:', e.message);
} finally {
  await browser.close();
}
