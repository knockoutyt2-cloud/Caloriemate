CalorieMate PWA - AI Food Photo Nutrition

This version adds AI photo recognition to Food Log. User uploads a meal photo; a Netlify serverless function sends it to the OpenAI Responses API, asks for food item/portion estimates and nutrition, and returns a meal estimate that can be added to Food Log.

IMPORTANT: This is not activated by a static Netlify Drop upload alone. The Netlify Function must be deployed with the site, and an OpenAI API key must be set as a server-side environment variable. Never put the API key in index.html or any public client file.

Deployment:
1. Upload the project to a GitHub repository (include index.html, manifest, sw.js, icons, netlify.toml and netlify/functions/analyze-food.mjs).
2. In Netlify, import/connect that GitHub repository as a site. Build command can be blank; publish directory is ".".
3. Choose how the AI is billed (the function reads credentials only from server-side Netlify environment variables via the official OpenAI SDK):
   a) Netlify AI Gateway (no key needed): do NOT set OPENAI_API_KEY. Netlify injects OPENAI_API_KEY and OPENAI_BASE_URL automatically at runtime and usage is billed to Netlify credits.
   b) Your own OpenAI account: set OPENAI_API_KEY (marked secret) in the Netlify environment variables. Requests then go directly to OpenAI and are billed by OpenAI; the account must have API credits.
   Optional OPENAI_MODEL can override the default model (gpt-6.2-astra).
4. Trigger a new deploy.
5. Open the deployed site and Food Log -> choose a photo -> Analyze Photo with AI -> review -> Add meal to Food Log.

Costs and privacy:
- OpenAI API usage is billed separately by OpenAI and is not included in Netlify free hosting. Check current API pricing before use; set billing limits/usage limits.
- Uploaded food photos are sent to OpenAI for analysis when you press Analyze Photo. Do not upload personal or sensitive images.
- Image-based serving and nutrient estimates are approximate; oil/ghee, hidden ingredients and exact weight cannot be determined reliably from one photo.
- Keep API key only in Netlify server environment variables. Do not expose it in frontend code.

Current app data is saved in local browser storage on that device. This does not provide cloud sync or Apple Health integration.
