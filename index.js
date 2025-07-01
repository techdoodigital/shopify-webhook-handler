const express = require('express');
const crypto = require('crypto');
const app = express();

// Middleware to capture raw body for webhook verification
app.use('/webhook/shopify', express.raw({type: 'application/json'}));
app.use(express.json()); // For other routes

// Your Shopify webhook secret (set this in your environment variables)
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Function to verify Shopify webhook authenticity
function verifyShopifyWebhook(data, hmacHeader) {
  if (!SHOPIFY_WEBHOOK_SECRET) {
    console.warn('SHOPIFY_WEBHOOK_SECRET not set - skipping verification');
    return true; // Allow for testing, but set secret in production
  }
  
  const calculated_hmac = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(data, 'utf8')
    .digest('base64');
  
  return calculated_hmac === hmacHeader;
}

// Function to send data to client's API
async function sendToClientAPI(customerData) {
  try {
    console.log('Sending to client API:', customerData);
    
    const response = await fetch('https://husband.fly.dev/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(customerData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Client API response:', result);
    return result;
    
  } catch (error) {
    console.error('Error calling client API:', error);
    throw error;
  }
}

// Shopify Order Created Webhook Handler
app.post('/webhook/shopify/order/created', async (req, res) => {
  try {
    // Verify webhook authenticity
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    
    if (!verifyShopifyWebhook(body, hmacHeader)) {
      console.error('Webhook verification failed');
      return res.status(401).send('Unauthorized');
    }

    // Parse the order data
    const order = JSON.parse(body.toString());
    console.log('Received order:', order.id, order.order_number);

    // Extract customer information
    const customerData = {
      first_name: order.billing_address?.first_name || 
                 order.shipping_address?.first_name || 
                 order.customer?.first_name || '',
      last_name: order.billing_address?.last_name || 
                order.shipping_address?.last_name || 
                order.customer?.last_name || '',
      email: order.email || order.customer?.email || ''
    };

    // Add optional phone if available
    const phone = order.billing_address?.phone || 
                 order.shipping_address?.phone || 
                 order.customer?.phone;
    if (phone) {
      customerData.phone = phone;
    }

    // Validate required fields
    if (!customerData.first_name || !customerData.last_name || !customerData.email) {
      console.error('Missing required customer data:', customerData);
      return res.status(400).send('Missing required customer data');
    }

    // Send to client's API
    await sendToClientAPI(customerData);
    
    // Log successful processing
    console.log(`Successfully processed order ${order.order_number} for ${customerData.email}`);
    
    res.status(200).send('Webhook processed successfully');
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Test endpoint to simulate webhook (for development)
app.post('/test-webhook', async (req, res) => {
  try {
    const testOrder = {
      id: 12345,
      order_number: 'TEST-001',
      email: 'wyldvn@gmail.com', // Use approved email for testing
      billing_address: {
        first_name: 'Test',
        last_name: 'Customer',
        phone: '+1-555-123-4567'
      },
      customer: {
        first_name: 'Test',
        last_name: 'Customer',
        email: 'wyldvn@gmail.com'
      }
    };

    // Process as if it's a real webhook
    const customerData = {
      first_name: testOrder.billing_address.first_name,
      last_name: testOrder.billing_address.last_name,
      email: testOrder.email,
      phone: testOrder.billing_address.phone
    };

    await sendToClientAPI(customerData);
    
    res.json({ 
      success: true, 
      message: 'Test webhook processed',
      data: customerData 
    });
    
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/shopify/order/created`);
  console.log(`Test URL: http://localhost:${PORT}/test-webhook`);
});

module.exports = app;
