const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3002");
  
  // Take screenshot to see the app
  await page.screenshot({ path: "app-screenshot.png" });
  console.log("Navigated to app, looking for import button...");
  
  // Try to find any buttons with text "import" or "Import"
  const buttons = await page.locator("button").all();
  console.log(`Found ${buttons.length} buttons on the page`);
  
  for (let i = 0; i < Math.min(5, buttons.length); i++) {
    const text = await buttons[i].textContent();
    console.log(`Button ${i}: ${text}`);
  }
  
  await browser.close();
})();
