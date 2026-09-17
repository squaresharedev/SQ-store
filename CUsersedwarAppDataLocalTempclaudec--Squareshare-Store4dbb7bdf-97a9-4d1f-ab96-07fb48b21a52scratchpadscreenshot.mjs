import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Navigate to the page - trying the settings page where the button would appear
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => console.log('Initial load:', e.message));

// Take a screenshot of the full page
await page.screenshot({ path: 'screenshot.png', fullPage: true });
console.log('Screenshot saved to screenshot.png');

// Try to find the "Add seller details" button and get its computed styles
const button = await page.$('text=/Add seller details/i').catch(() => null);
if (button) {
  const styles = await button.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      borderColor: computed.borderColor,
    };
  });
  console.log('Button styles:', styles);
} else {
  console.log('Button not found on this page');
}

await browser.close();
