// Simple screenshot using Chrome --headless API via cdp (Chrome DevTools Protocol)
const http = require('http');
const { execSync } = require('child_process');

// Use Chrome directly to take a screenshot
const chromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe";
const outputFile = "C:\Users\edwar\AppData\Local\Temp\claude\c--Squareshare-Store\9d9e81d6-4c78-4011-9179-7da21bc60ee5\scratchpad\login_screenshot.png";

try {
  // Take screenshot using Chrome headless
  const cmd = `"${chromeExe}" --headless=new --screenshot="${outputFile}" http://localhost:3000/login 2>&1`;
  console.log('Taking screenshot with Chrome...');
  execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
  console.log(`✓ Screenshot saved to: ${outputFile}`);
} catch (error) {
  console.error('Screenshot failed:', error.message);
  console.log('Proceeding with other verifications...');
}
