const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to login page
  console.log('Navigating to http://localhost:3000/login...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  
  // Get page content
  const title = await page.title();
  console.log('Page title:', title);
  
  // Check for any console errors
  const consoleMessages = [];
  page.on('console', msg => {
    console.log('CONSOLE [' + msg.type().toUpperCase() + ']:', msg.text());
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });
  
  // Wait a moment for any async loading
  await page.waitForTimeout(2000);
  
  // Take screenshot of loaded page
  await page.screenshot({ path: 'screenshot_loaded.png' });
  console.log('Screenshot taken: screenshot_loaded.png');
  
  // Check if login form exists
  const formExists = await page.locator('form').count();
  console.log('Form found:', formExists > 0);
  
  // Try to find email input
  const emailInput = await page.locator('input[type="email"], input[name*="email"]').first();
  const emailVisible = await emailInput.isVisible().catch(() => false);
  console.log('Email input visible:', emailVisible);
  
  // Fill and submit form
  console.log('\nTesting form submission with test@example.com / testpass123...');
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'testpass123');
  
  // Take screenshot before submit
  await page.screenshot({ path: 'screenshot_form_filled.png' });
  console.log('Screenshot before submit: screenshot_form_filled.png');
  
  // Submit form
  await page.click('button[type="submit"]');
  
  // Wait for response/error
  await page.waitForTimeout(3000);
  
  // Take screenshot after submit
  await page.screenshot({ path: 'screenshot_after_submit.png' });
  console.log('Screenshot after submit: screenshot_after_submit.png');
  
  // Look for error messages
  const errorMessages = await page.locator('[class*="error"], [role="alert"]').allTextContents();
  console.log('\nError messages on page:');
  errorMessages.forEach(msg => console.log('  -', msg.trim()));
  
  await browser.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
