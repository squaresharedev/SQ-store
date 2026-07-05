import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  // Set a viewport to match typical desktop
  await page.setViewportSize({ width: 1280, height: 800 });

  console.log('Loading products page...');

  // Try to navigate - might be redirected to login
  const response = await page.goto('http://localhost:3000/products', {
    waitUntil: 'networkidle',
    timeout: 15000
  });

  console.log(`Status: ${response?.status()}`);
  console.log(`URL after navigation: ${page.url()}`);

  // Wait for content to load
  await page.waitForTimeout(2000);

  // Check page content
  const content = await page.content();

  // Search for images
  const picsumCount = (content.match(/picsum\.photos/g) || []).length;
  const imgTags = (content.match(/<img/g) || []).length;

  console.log(`\nPage Analysis:`);
  console.log(`- picsum.photos URLs found: ${picsumCount}`);
  console.log(`- <img> tags found: ${imgTags}`);

  // Extract sample URLs
  const urls = content.match(/https:\/\/picsum\.photos\/[^\s"<]+/g) || [];
  if (urls.length > 0) {
    console.log(`\nSample image URLs:`);
    urls.slice(0, 5).forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  }

  // Take screenshot
  const screenshotPath = 'c:\\Users\\edwar\\AppData\\Local\\Temp\\claude\\c--Squareshare-Store\\cd387756-0bec-4da8-bd55-890816eae972\\scratchpad\\products-page.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\nScreenshot saved to scratchpad/products-page.png`);

} catch (e) {
  console.error('Error:', e.message);
} finally {
  await browser.close();
}
