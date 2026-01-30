import axios from 'axios';

// Helper function to retry API calls
const retryWithBackoff = async (fn, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isLastRetry = i === maxRetries - 1;
      const isRetryableError = error.response?.status === 503 ||
        error.response?.status === 429 ||
        error.code === 'ECONNABORTED';

      if (isLastRetry || !isRetryableError) {
        throw error;
      }

      console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
};

export const analyzeImageWithGemini = async (base64Data, userProfile = { vegType: 'Vegetarian', goal: 'General Health' }) => {
  try {
    console.log('Sending image to Gemini Service...');

    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API Key missing. Check your .env file.');
    }

    const apiCall = async () => {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: `Analyze this image (nutrition label, medicine box, or supplement bottle) and return ONLY a valid JSON object.
                
FIRST, DETERMINE THE TYPE: "Food" or "Medicine".

=== IF FOOD / BEVERAGE ===
Focus on nutrition, ingredients, and health impact.
Schema:
{
  "productType": "Food",
  "productName": "short name",
  "vegetarianStatus": "Vegetarian / Non-Vegetarian / Vegan / Unclear",
  "healthScore": number (0-100),
  "healthInsight": "Short punchy verdict (max 10 words)",
  "scoreExplanation": "One clear sentence explaining the score.",
  "servingDescription": "e.g. 1 bar, 30g",
  "calories": number (kcal) or null,
  "protein": number (g) or null,
  "carbohydrates": number (g) or null,
  "totalFat": number (g) or null,
  "fiber": number (g) or null,
  "sugar": { "labelSugar": number (g), "hiddenSugars": ["list"] },
  "allergens": ["list"],
  "alternatives": ["Name : Reason"],
  "preservatives": [{ "name": "...", "concern": "..." }],
  "additives": [{ "name": "...", "concern": "..." }]
}

=== IF MEDICINE / SUPPLEMENT ===
Focus on active ingredients, usage, and safety.
Schema:
{
  "productType": "Medicine",
  "productName": "short name",
  "vegetarianStatus": "Vegetarian / Non-Vegetarian / Vegan / Unclear",
  "healthScore": number (0-100) (Based on safety/clarity/necessity checking. 100 = Safe/Clear, 50 = Caution),
  "healthInsight": "Simple primary use (e.g. 'Pain Relief', 'Immunity', 'Sleep Aid'). Max 3 words.",
  "scoreExplanation": "Explain simply in one sentence what this medicine matches/does. Use plain English, no complex medical terms. (e.g. 'Helps reduce fever and mild pain' or 'Provides Vitamin C for immune support').",
  "activeIngredients": ["list of main drugs/vitamins e.g. 'Paracetamol 500mg'"],
  "dosage": "Recommended dosage if visible (e.g. '1 tablet every 6 hours')",
  "usageInstructions": "Brief usage instructions",
  "warnings": ["Side effects or warnings e.g. 'Drowsiness', 'Take with food'"],
  "symptoms": ["Conditions this treats"],
  "servingDescription": null,
  "calories": null,
  "protein": null,
  "carbohydrates": null,
  "totalFat": null,
  "fiber": null,
  "sugar": { "labelSugar": null, "hiddenSugars": [] },
  "allergens": [],
  "alternatives": [],
  "preservatives": [],
  "additives": []
}

User Profile for Context:
- Vegetarian Type: ${userProfile.vegType}
- Goal: ${userProfile.goal}

Rules:
- Return ONLY valid JSON.
- If unsure of type, default to Food schema but set productType="Unknown".
- Ensure no markdown formatting or backticks.
- FOR MEDICINE: Write the 'scoreExplanation' and 'healthInsight' in very simple, non-technical language. Explain it like I'm 12 years old.
`,
                },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        },
        {
          timeout: 45000
        }
      );
      return response;
    };

    const response = await retryWithBackoff(apiCall, 3, 1000);

    const responseText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Gemini Service Error:', error);

    if (error.response?.status === 503) {
      throw new Error('Service unavailable. Try again later.');
    } else if (error.response?.status === 404) {
      throw new Error('API Endpoint not found. Please check model name.');
    } else if (error.response?.status === 403) {
      throw new Error('Permission denied. Check API Key.');
    }

    throw error;
  }
};

export const chatWithGemini = async (message, productContext, userProfile, chatHistory = []) => {
  try {
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Chat Error: API Key is missing!');
      return "I can't chat right now because the API key is missing. Please check your setup.";
    }

    const historyText = chatHistory.map(h => `${h.role}: ${h.text}`).join('\n');

    console.log(`Chatting about: ${productContext.productName}`);

    const contextPrompt = `
You are a helpful nutritionist assistant. 
The user is asking questions about a product called "${productContext.productName}" which was just analyzed.

PRODUCT DETAILS:
Type: ${productContext.productType}
Health Score: ${productContext.healthScore}
Ingredients: ${JSON.stringify(productContext.activeIngredients || productContext.ingredients || [])}
Nutrition: Calories: ${productContext.calories}, Protein: ${productContext.protein}, Sugar: ${JSON.stringify(productContext.sugar)}, Fat: ${productContext.totalFat}

USER PROFILE:
Diet: ${userProfile.vegType}
Goal: ${userProfile.goal}

PREVIOUS CHAT:
${historyText || 'No previous messages.'}

USER QUESTION: "${message}"

Rules:
- Answer concisely (max 3 sentences).
- Focus on the user's specific health goals.
- If it's a medicine, be very careful and suggest consulting a doctor for professional advice.
- Speak in a friendly, helpful tone.
`;

    const apiCall = async () => {
      return await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: contextPrompt }] }]
        },
        { timeout: 25000 }
      );
    };

    const response = await retryWithBackoff(apiCall, 2, 1000);
    const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      console.warn('Gemini returned empty response for chat');
      return "I'm not sure how to answer that right now. Could you try asking in a different way?";
    }

    return reply;
  } catch (error) {
    console.error('Chat API Error:', error.response?.data || error.message);

    if (error.response?.status === 503) {
      return "I'm temporarily unavailable. Please try again in a moment.";
    } else if (error.response?.status === 429) {
      return "Too many questions! Please wait a moment.";
    } else if (error.response?.status === 404) {
      return "AI Model configuration error (404). Please contact support.";
    }

    return "Sorry, I'm having trouble connecting right now. Please check your internet or try again later.";
  }
};

