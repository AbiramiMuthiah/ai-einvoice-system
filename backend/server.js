require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

// ===============================
// 1. INITIALIZE API KEYS & CREDS
// ===============================

let googleCreds;
try {
    const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    
    // Remove potential outer single/double quotes if they exist
    const cleanJson = rawJson.replace(/^['"]|['"]$/g, '');
    
    googleCreds = JSON.parse(cleanJson);
    console.log("✅ Google Credentials loaded successfully.");
} catch (e) {
    console.error("❌ Credentials Error:", e.message);
    process.exit(1);
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-pro-latest",
    generationConfig: { responseMimeType: "application/json" } // Force JSON output
});

// ===============================
// 2. GOOGLE VISION (REST API)
// ===============================
async function extractTextWithVision(base64Image) {
    // We use your Gemini/Google Cloud API key to authorize the Vision request
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    const body = {
        requests: [
            {
                image: { content: base64Image },
                features: [{ type: "TEXT_DETECTION" }]
            }
        ]
    };

    try {
        const response = await axios.post(url, body);
        const text = response.data.responses[0]?.fullTextAnnotation?.text;
        if (!text) throw new Error("No text found in image.");
        return text;
    } catch (error) {
        console.error("Vision API Error:", error.response?.data || error.message);
        throw new Error("Failed to extract text from image.");
    }
}

// ===============================
// 3. PROMPT TEMPLATE
// ===============================
const INVOICE_GENERATION_PROMPT = `
Extract data from this invoice text and return it in the following JSON format:
{
  "vendor": "",
  "vendorAddress": "",
  "client": "",
  "clientAddress": "",
  "invoiceNumber": "",
  "date": "",
  "dueDate": "",
  "items": [
    { "description": "", "quantity": 0, "unitPrice": 0, "total": 0 }
  ],
  "subtotal": 0,
  "tax": 0,
  "total": 0
}
Return ONLY the JSON object.
Invoice Text: 
"""{EXTRACTED_TEXT}"""
`;

// ===============================
// 4. ROUTE
// ===============================
app.post('/api/process-image', upload.single('invoiceImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        console.log("1. Image received, converting to base64...");
        const base64Image = req.file.buffer.toString("base64");

        console.log("2. Sending to Google Vision...");
        const extractedText = await extractTextWithVision(base64Image);

        console.log("3. Sending text to Gemini for structuring...");
        const result = await model.generateContent(
            INVOICE_GENERATION_PROMPT.replace("{EXTRACTED_TEXT}", extractedText)
        );

        // Clean any potential markdown formatting from Gemini output
        let responseText = result.response.text();
        responseText = responseText.replace(/```json|```/g, "").trim();

        const invoiceJson = JSON.parse(responseText);
        
        console.log("✅ Process complete!");
        res.json({ 
            extractedText, 
            invoice: invoiceJson 
        });

    } catch (error) {
        console.error("❌ Route Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ===============================
// 5. SERVER
// ===============================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);

    // server.js
app.use(cors({
  // Add your Vercel URL here after you deploy the frontend
  origin: ["http://localhost:3000", "https://your-project-name.vercel.app"], 
  methods: ["GET", "POST"]
}));

});