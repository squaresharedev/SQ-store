const http = require('http');

// Step 1: Load the login page and check if it renders without errors
console.log('=== Testing Login Page ===\n');
console.log('Step 1: Loading http://localhost:3000/login...');
http.get('http://localhost:3000/login', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✓ Page loaded successfully (HTTP 200)');
      
      // Check for key form elements
      const checks = [
        { pattern: /type="email"/, name: 'Email input' },
        { pattern: /type="password"/, name: 'Password input' },
        { pattern: /type="submit"/, name: 'Submit button' },
        { pattern: /LoginForm/, name: 'LoginForm component' },
        { pattern: /Sign in/, name: 'Sign in button text' },
      ];
      
      checks.forEach(check => {
        if (check.pattern.test(data)) {
          console.log(`✓ ${check.name} found in page`);
        } else {
          console.log(`✗ ${check.name} NOT found in page`);
        }
      });
      
      // Check for error handling UI elements
      if (data.includes('role="alert"')) {
        console.log('✓ Error alert UI element found');
      }
      
      if (data.includes('aria-live="polite"')) {
        console.log('✓ Live region for status messages found');
      }
      
      console.log('\nStep 2: Simulating form submission...');
      // Simulate form submission
      const postData = new URLSearchParams();
      postData.append('email', 'test@example.com');
      postData.append('password', 'testpass123');
      postData.append('intent', 'signin');
      postData.append('next', '/');
      
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData.toString()),
        },
      };
      
      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          console.log('✓ Form submission responded');
          console.log(`  Status: ${res.statusCode}`);
          if (res.statusCode === 307 || res.statusCode === 302) {
            console.log('✓ Received redirect (expected for successful auth attempt)');
            if (res.headers.location) {
              console.log(`  Location header: ${res.headers.location}`);
            }
          } else {
            console.log(`  Response length: ${responseData.length} bytes`);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('✗ Form submission error:', error.message);
      });
      
      req.write(postData.toString());
      req.end();
      
    } else {
      console.log(`✗ Unexpected status code: ${res.statusCode}`);
    }
  });
}).on('error', (err) => {
  console.error('✗ Failed to load page:', err.message);
});
