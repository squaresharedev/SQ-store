const http = require('http');

// Test 1: Load the login page
console.log('Test 1: Loading login page...');
http.get('http://localhost:3000/login', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✓ Page loaded successfully (status 200)');
      if (data.includes('LoginForm') || data.includes('Sign in') || data.includes('email')) {
        console.log('✓ Login form found in HTML');
      } else {
        console.log('✗ Login form not found');
      }
    } else {
      console.log('✗ Unexpected status:', res.statusCode);
    }
  });
}).on('error', (err) => {
  console.error('✗ Error loading page:', err.message);
});
