import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // Navigate to the dashboard
    await page.goto('http://localhost:3000/dashboard/stores', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    
    // Try to find and click on a storefront
    const storeLink = await page.$('[href*="/designer"]');
    if (storeLink) {
      await storeLink.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('No storefront designer link found');
    }
    
    // Take a screenshot of the right panel area
    await page.screenshot({ path: 'storefront-panel.png', fullPage: false });
    console.log('Screenshot saved');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
