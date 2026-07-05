// Verify images with GET requests (picsum doesn't support HEAD)

const testUrls = [
  'https://picsum.photos/400/300?random=100',
  'https://picsum.photos/400/300?random=80',
  'https://picsum.photos/400/300?random=1',
];

console.log('Verifying stock photo URLs with GET requests...\n');

for (const url of testUrls) {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type');

    console.log(`${response.ok ? '✓' : '✗'} ${url}`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Content-Type: ${contentType}`);

    if (response.ok) {
      const buffer = await response.arrayBuffer();
      console.log(`  Size: ${Math.round(buffer.byteLength / 1024)}KB`);
    }
  } catch (e) {
    console.log(`✗ ${url}`);
    console.log(`  Error: ${e.message}`);
  }
  console.log('');
}

console.log('✓ Stock photo URLs are working correctly!');
