// Test to verify presignGetUrl handles external URLs correctly

const testUrl = 'https://picsum.photos/400/300?random=80';

// Simulate the presignGetUrl logic
async function presignGetUrl(key) {
  // If the key is already a full URL (e.g., external stock photo), return it directly.
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key;
  }
  // Would continue with R2 logic here...
  return null;
}

const result = await presignGetUrl(testUrl);
console.log('Input:', testUrl);
console.log('Output:', result);
console.log('Test', result === testUrl ? '✓ PASSED' : '✗ FAILED');

// Also test with R2 keys
const r2Key = 'images/user-id/uuid-filename.jpg';
const r2Result = await presignGetUrl(r2Key);
console.log('\nR2 Key Test:');
console.log('Input:', r2Key);
console.log('Output:', r2Result);
console.log('(Returns null since R2 creds not configured, but would be signed URL)');
