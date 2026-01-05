#!/usr/bin/env node

/**
 * Test security alert system via admin endpoint
 */

import fetch from 'node-fetch';

async function testSecurityAlert() {
  console.log('🚨 Testing security alert system...');
  
  try {
    // Use the built-in test endpoint
    const response = await fetch('http://localhost:3002/api/admin/security/test-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('✅ Test alert sent successfully');
      console.log('📊 Results:', data.results);
      console.log('📱 Check your Telegram for the test alert!');
    } else {
      console.error('❌ Failed to send test alert:', data.error || response.status);
      if (data.results) {
        console.log('📊 Results:', data.results);
      }
    }

  } catch (error) {
    console.error('❌ Error testing alert:', error.message);
    console.log('💡 Make sure your server is running on port 3002');
  }
}

testSecurityAlert();