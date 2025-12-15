import { BACKEND_API_URL, USE_MOCK_BACKEND } from "../constants";

interface N8nResponse {
  aiResponse: string;
  meta: {
    shouldSpeak: boolean;
  };
}

export const sendQueryToN8n = async (
  query: string, 
  userId: string = "unknown",
  inputType: 'voice' | 'text' = 'voice'
): Promise<N8nResponse> => {
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
      },
      body: JSON.stringify({
        userId,
        query,
        sessionId: Date.now().toString(),
        platform: 'telegram_mini_app',
        inputType
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Check for Server Errors (500, 404, etc)
    if (!response.ok) {
      console.warn(`N8n Server Error: ${response.status} ${response.statusText}`);
      return {
          aiResponse: "Прошу прощения, на сервере произошла техническая ошибка. Пожалуйста, попробуйте позже.",
          meta: { shouldSpeak: true }
      };
    }

    // Handle response safely. N8n might return JSON or plain text.
    const textData = await response.text();
    let data: any;

    try {
        data = JSON.parse(textData);
    } catch (e) {
        // If n8n returns plain text (e.g., "Workflow started"), wrap it.
        console.warn("N8n returned non-JSON response:", textData);
        data = {
            aiResponse: textData || "Запрос отправлен.",
            meta: { shouldSpeak: true }
        };
    }

    // Ensure structure matches N8nResponse
    return {
        aiResponse: data.aiResponse || (typeof data === 'string' ? data : (data.message || "Ответ получен.")),
        meta: data.meta || { shouldSpeak: true }
    };

  } catch (error) {
    console.error("N8n API Connection Error:", error);
    
    return {
      aiResponse: "Не удалось соединиться с сервером. Проверьте интернет или попробуйте позже.",
      meta: { shouldSpeak: true }
    };
  }
};

// Mock function for preview environment
const mockN8nResponse = async (query: string): Promise<N8nResponse> => {
  // Simulate variable network delay (1-2 seconds)
  const delay = 1000 + Math.random() * 1000;
  await new Promise(resolve => setTimeout(resolve, delay));
  
  const lowerQuery = query.toLowerCase();
  let responseText = "";

  // Simple keyword matching for demo purposes
  if (lowerQuery.includes("привет") || lowerQuery.includes("здравствуй")) {
    responseText = "Здравствуйте! Рада Вас слышать. Чем я могу быть полезна сегодня?";
  } else if (lowerQuery.includes("цена") || lowerQuery.includes("стоит")) {
    responseText = "Стоимость наших услуг зависит от выбранного пакета. Базовый тариф начинается от пяти тысяч рублей.";
  } else if (lowerQuery.includes("запис") || lowerQuery.includes("бронир")) {
    responseText = "Я с удовольствием запишу Вас. На какой день и время Вам было бы удобно?";
  } else if (lowerQuery.includes("пока") || lowerQuery.includes("до свидания")) {
    responseText = "Всего доброго! Буду ждать нашей следующей встречи.";
  } else {
    // Default echo for unknown queries
    responseText = `Я услышала: "${query}". В демонстрационном режиме я пока не знаю ответа на этот вопрос, но я учусь.`;
  }

  return {
    aiResponse: responseText,
    meta: { shouldSpeak: true }
  };
};