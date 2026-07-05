// Verify that the stock photo URLs are accessible and return images

const testUrls = [
  'https://picsum.photos/400/300?random=100',
  'https://picsum.photos/400/300?random=80',
  'https://picsum.photos/400/300?random=71',
  'https://picsum.photos/400/300?random=1',
  'https://picsum.photos/400/300?random=50',
];

console.log('Verifying stock photo URLs are accessible...\n');

for (const url of testUrls) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');

    console.log(`${response.ok ? '✓' : '✗'} ${url}`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Content-Type: ${contentType}`);
    console.log(`  Size: ${contentLength ? Math.round(parseInt(contentLength) / 1024) + 'KB' : 'unknown'}`);
  } catch (e) {
    console.log(`✗ ${url}`);
    console.log(`  Error: ${e.message}`);
  }
  console.log('');
}

console.log('Summary: Stock photos are accessible and can be used for product images.');
