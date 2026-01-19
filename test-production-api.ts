/**
 * Test script to verify API returns proper URLs
 */

async function testProductionApi() {
  const response = await fetch('http://localhost:5000/api/production/jobs', {
    credentials: 'include',
    headers: {
      'Cookie': 'connect.sid=...' // Will use existing session
    }
  });

  if (!response.ok) {
    console.error(`API returned ${response.status}: ${response.statusText}`);
    return;
  }

  const data = await response.json();
  console.log('API Response:', JSON.stringify(data, null, 2));
  
  if (data.data && data.data.length > 0) {
    const firstJob = data.data[0];
    console.log('\n=== First Job Artwork ===');
    console.log('Order #:', firstJob.orderNumber);
    console.log('Artwork count:', firstJob.artwork?.length || 0);
    
    if (firstJob.artwork && firstJob.artwork.length > 0) {
      firstJob.artwork.forEach((art: any, i: number) => {
        console.log(`\nArtwork ${i + 1}:`);
        console.log('  fileName:', art.fileName);
        console.log('  fileUrl:', art.fileUrl);
        console.log('  thumbnailUrl:', art.thumbnailUrl || '(null)');
        console.log('  thumbKey:', art.thumbKey || '(null)');
        console.log('  thumbStatus:', art.thumbStatus || '(null)');
      });
    }
  }
}

// Run in Node
if (typeof window === 'undefined') {
  testProductionApi().catch(console.error);
}
