import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  console.log('Navigating to products page...');
  const response = await page.goto('http://localhost:3000/products', {
    waitUntil: 'networkidle',
    timeout: 10000
  });

  console.log(`Response status: ${response?.status()}`);

  // Wait for images to load
  await page.waitForTimeout(2000);

  // Get the page content
  const content = await page.content();

  // Check for picsum images
  const picsumMatches = content.match(/https:\/\/picsum\.photos\/[^\s"<]+/g) || [];
  console.log(`Found ${picsumMatches.length} picsum.photos URLs`);
  picsumMatches.slice(0, 5).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });

  // Count all img tags
  const imgMatches = content.match(/<img[^>]*>/g) || [];
  console.log(`Total <img> tags: ${imgMatches.length}`);

  // Take screenshot
  await page.screenshot({
    path: 'products-screenshot.png',
    fullPage: true
  });
  console.log('Screenshot saved to products-screenshot.png');

} catch (e) {
  console.error(`Error: ${e.message}`);
  console.error(e.stack);
} finally {
  await browser.close();
}
