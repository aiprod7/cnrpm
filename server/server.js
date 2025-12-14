const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Configure strict CORS in production
app.use(express.json());

// Environment Variables
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const SHARED_SECRET = process.env.APP_SECRET || 'your-shared-secret-key';

// Security Middleware
const validateToken = (req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== SHARED_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

// Proxy Endpoint
app.post('/api/chat', validateToken, async (req, res) => {
  try {
    const { userId, query, sessionId, platform } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Call n8n Webhook
    const n8nResponse = await axios.post(N8N_WEBHOOK_URL, {
      userId,
      query,
      sessionId,
      platform
    });

    // Expecting n8n to return { aiResponse: "...", meta: { ... } }
    // If n8n returns simple text, wrap it.
    const data = n8nResponse.data;
    
    const responsePayload = {
        aiResponse: data.aiResponse || (typeof data === 'string' ? data : "No text response"),
        meta: data.meta || { shouldSpeak: true }
    };

    res.json(responsePayload);

  } catch (error) {
    console.error('Error proxying to n8n:', error.message);
    res.status(500).json({ 
        aiResponse: "Извините, произошла ошибка связи с сервером.",
        meta: { shouldSpeak: true }
    });
  }
});

app.listen(PORT, () => {
  console.log(`VoxLux Proxy Server running on port ${PORT}`);
});
