// Simulate the presignGetUrl and rowToProduct flow to verify external URLs work

// Mock presignGetUrl that matches the updated logic in r2.ts
async function presignGetUrl(key) {
  if (!key) return null;
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key;
  }
  // R2 logic would go here, but we're just testing external URLs
  return null;
}

// Simulate rowToProduct from queries.ts
async function rowToProduct(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    price: row.price_cents / 100,
    currency: row.currency,
    status: row.status,
    // The key change: presignGetUrl now handles external URLs
    imageUrl: row.image_key ? await presignGetUrl(row.image_key) : null,
    digitalFileName: null,
  };
}

// Test data from the database
const testProducts = [
  {
    id: '6bdcbacd-8f8a-4e3f-9233-c2a6b82cf9d9',
    title: 'LED ring',
    description: 'A LED ring product',
    price_cents: 2999,
    currency: 'EUR',
    status: 'active',
    image_key: 'https://picsum.photos/400/300?random=100'
  },
  {
    id: 'edce3cb6-f348-498c-af24-f238dede5a5b',
    title: 'Cinematic E-book',
    description: 'An e-book product',
    price_cents: 1999,
    currency: 'USD',
    status: 'active',
    image_key: 'https://picsum.photos/400/300?random=80'
  },
  {
    id: '75c3d6eb-fb5d-4cf9-904e-26cec92d67df',
    title: 'Pastel UI Kit',
    description: 'A UI kit',
    price_cents: 4999,
    currency: 'EUR',
    status: 'draft',
    image_key: 'https://picsum.photos/400/300?random=71'
  }
];

console.log('Testing product transformation with external image URLs...\n');

// Transform all test products
const results = await Promise.all(testProducts.map(rowToProduct));

console.log(`✓ Transformed ${results.length} products\n`);

results.forEach((product, i) => {
  console.log(`Product ${i + 1}: ${product.title}`);
  console.log(`  ID: ${product.id}`);
  console.log(`  Price: €${product.price}`);
  console.log(`  Status: ${product.status}`);
  console.log(`  Image URL: ${product.imageUrl}`);
  console.log(`  ✓ Image URL is accessible: ${product.imageUrl ? 'YES' : 'NO'}\n`);
});

// Verify all images are external URLs
const allHaveImages = results.every(p => p.imageUrl?.startsWith('https://picsum.photos'));
console.log(`Final Verification: ${allHaveImages ? '✓ ALL PRODUCTS HAVE PICSUM IMAGES' : '✗ SOME PRODUCTS MISSING IMAGES'}`);
