const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firestore
const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

// Use the NEW Google Gen AI SDK
const { GoogleAuth } = require('google-auth-library');

// Function to call Gemini using REST API (no deprecated SDK)
async function getGeminiResponse(question, language = 'en') {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;

  const prompt = `You are an educational tutor for students in rural areas. 
  Answer the following question in ${language === 'hi' ? 'Hindi' : 'simple English'}:
  
  Question: ${question}
  
  Provide a step-by-step explanation that is easy to understand for a 10th-grade student.`;

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-1.5-pro:generateContent`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  };

  try {
    const token = await client.getAccessToken();
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini API error:', error.response?.data || error.message);
    return "Sorry, I'm having trouble answering right now. Please try again later.";
  }
}

// Store conversation in Firestore
async function storeConversation(userPhone, question, answer) {
  try {
    const conversationRef = db.collection('conversations').doc();
    await conversationRef.set({
      userPhone,
      question,
      answer,
      timestamp: new Date().toISOString(),
      modelUsed: 'gemini-1.5-pro',
    });
    return conversationRef.id;
  } catch (error) {
    console.error('Firestore error:', error);
    return null;
  }
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, message) {
  // Check if we have real WhatsApp credentials
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // If using dummy/test values, just log the message
  if (accessToken === 'test_temp_token' || !accessToken) {
    console.log(`[TEST MODE] Would send to ${to}: ${message}`);
    return true;
  }

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message },
  };

  try {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: data,
    });
    console.log(`Message sent to ${to}`);
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
  }
}

// WhatsApp Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Always send 200 first to acknowledge receipt
    res.sendStatus(200);

    if (body.object === 'whatsapp_business_account' && body.entry) {
      const entry = body.entry[0];
      const changes = entry.changes[0];
      const message = changes.value.messages?.[0];

      if (message && message.type === 'text') {
        const userPhone = message.from;
        const userQuestion = message.text.body;

        console.log(`Received question from ${userPhone}: ${userQuestion}`);

        // Simple language detection (Hindi characters)
        const hasHindi = /[\u0900-\u097F]/.test(userQuestion);
        const language = hasHindi ? 'hi' : 'en';

        // Get AI response
        console.log('Calling Gemini API...');
        const aiAnswer = await getGeminiResponse(userQuestion, language);
        console.log('Gemini response received');

        // Store in database (don't wait for response)
        storeConversation(userPhone, userQuestion, aiAnswer).catch(console.error);

        // Send response back
        await sendWhatsAppMessage(userPhone, aiAnswer);
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
});

// Dashboard API - Get recent conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const snapshot = await db.collection('conversations')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const conversations = [];
    snapshot.forEach(doc => {
      conversations.push({ id: doc.id, ...doc.data() });
    });

    res.json(conversations);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>AI Tutor Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0; }
        .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .question { color: #1a73e8; font-weight: bold; }
        .answer { color: #34a853; margin-top: 5px; }
        .timestamp { color: #666; font-size: 12px; }
        h1 { color: #1a73e8; }
        .status { background: #e8f0fe; padding: 10px; border-radius: 8px; margin-bottom: 20px; }
        .loading { text-align: center; padding: 20px; }
    </style>
</head>
<body>
    <h1>📚 AI Tutor Dashboard</h1>
    <div class="status" id="status">Loading conversations...</div>
    <div id="conversations" class="loading">Loading...</div>
    
    <script>
        async function loadConversations() {
            try {
                const response = await fetch('/api/conversations');
                const data = await response.json();
                
                const statusDiv = document.getElementById('status');
                const container = document.getElementById('conversations');
                
                if (!Array.isArray(data) || data.length === 0) {
                    statusDiv.innerHTML = '✅ No conversations yet. Send a WhatsApp message to start!';
                    container.innerHTML = '<div class="card">📱 No messages received yet. Send "Hello" to your WhatsApp bot.</div>';
                    return;
                }
                
                statusDiv.innerHTML = \`✅ Showing \${data.length} recent conversations\`;
                container.innerHTML = data.map(conv => \`
                    <div class="card">
                        <div>📱 \${conv.userPhone || 'Unknown'}</div>
                        <div class="question">❓ \${conv.question || ''}</div>
                        <div class="answer">✨ \${conv.answer || ''}</div>
                        <div class="timestamp">🕐 \${conv.timestamp ? new Date(conv.timestamp).toLocaleString() : 'Unknown time'}</div>
                    </div>
                \`).join('');
            } catch (error) {
                document.getElementById('status').innerHTML = '❌ Error loading conversations. Make sure backend is running.';
                document.getElementById('conversations').innerHTML = '<div class="card">Error: ' + error.message + '</div>';
            }
        }
        
        loadConversations();
        setInterval(loadConversations, 30000);
    </script>
</body>
</html>
  `);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`💡 Note: Using ${process.env.WHATSAPP_ACCESS_TOKEN === 'test_temp_token' ? 'TEST MODE' : 'LIVE WhatsApp mode'}`);
});