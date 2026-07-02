const http = require('http');

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
    console.log('Status:', res.statusCode);
    console.log('Response:', responseData);
    console.log('\nHeaders:');
    Object.entries(res.headers).forEach(([key, val]) => {
      console.log(`  ${key}: ${val}`);
    });
  });
});

req.on('error', (error) => {
  console.error('Request error:', error.message);
});

req.write(postData.toString());
req.end();
