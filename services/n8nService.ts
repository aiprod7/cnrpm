import { BACKEND_API_URL, USE_MOCK_BACKEND } from "../constants";

interface N8nResponse {
  aiResponse: string;
  meta: {
    shouldSpeak: boolean;
  };
}

export const sendQueryToN8n = async (query: string, userId: string = "unknown"): Promise<N8nResponse> => {
  if (USE_MOCK_BACKEND) {
    return mockN8nResponse(query);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(BACKEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'your-shared-secret-key', // Ensure this matches server
      },
      body: JSON.stringify({
        userId,
        query,
        sessionId: Date.now().toString(),
        platform: 'telegram_mini_app'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();
    return data as N8nResponse;

  } catch (error) {
    console.error("N8n API Error:", error);
    // Fallback response as requested
    return {
      aiResponse: "Извините, не могу обработать запрос. Пожалуйста, попробуйте еще раз.",
      meta: { shouldSpeak: true }
    };
  }
};

// Mock function for preview environment
const mockN8nResponse = async (query: string): Promise<N8nResponse> => {
  await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate network delay
  
  return {
    aiResponse: `Я поняла Ваш запрос: "${query}". В настоящее время я работаю в демонстрационном режиме, но я готова интегрироваться с Вашей системой автоматизации.`,
    meta: { shouldSpeak: true }
  };
};
