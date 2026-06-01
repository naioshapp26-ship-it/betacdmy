import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

type ResolvedAIConfig = {
  apiKey: string | null;
  aiProvider?: string;
  aiModel?: string;
  maxTokens?: number;
  temperature?: number;
  customConfig?: Record<string, any>;
};

// Cache for resolved AI configuration
let cachedAIConfig: ResolvedAIConfig | null = null;
let aiConfigFetched = false;

export const resetAIConfigCache = () => {
  cachedAIConfig = null;
  aiConfigFetched = false;
};

// Fetch platform or tenant AI config from backend
export const fetchResolvedAIConfig = async (forceRefresh = false): Promise<ResolvedAIConfig | null> => {
  if (aiConfigFetched && !forceRefresh) {
    return cachedAIConfig;
  }

  try {
    const response = await fetch('/api/ai/key');
    if (response.ok) {
      const data = await response.json();
      cachedAIConfig = {
        apiKey: data.apiKey || null,
        aiProvider: data.aiProvider,
        aiModel: data.aiModel,
        maxTokens: data.maxTokens,
        temperature: data.temperature,
        customConfig: data.customConfig || {},
      };
    } else {
      console.warn('[GeminiService] AI config not available (server response)', response.status);
      cachedAIConfig = { apiKey: null };
    }
  } catch (error) {
    console.warn('[GeminiService] Failed to fetch AI config:', error);
    cachedAIConfig = { apiKey: null };
  }

  aiConfigFetched = true;
  return cachedAIConfig;
};

const getResolvedConfig = async (): Promise<ResolvedAIConfig | null> => {
  if (!cachedAIConfig || !aiConfigFetched) {
    await fetchResolvedAIConfig();
  }
  return cachedAIConfig;
};

// Helper to get AI instance with the appropriate API key
const getAI = async (apiKey?: string): Promise<{ ai: GoogleGenAI; config: ResolvedAIConfig } | null> => {
  let config = cachedAIConfig;

  if (!config || !aiConfigFetched) {
    config = await fetchResolvedAIConfig();
  }

  const key = apiKey || config?.apiKey;
  
  if (!key) {
    console.warn('[GeminiService] No AI API key available in database');
    return null;
  }

  return { ai: new GoogleGenAI({ apiKey: key }), config: config ?? { apiKey: key } };
};

// Helper: call OpenAI chat completions API (text or JSON)
const callOpenAI = async (
  key: string,
  config: ResolvedAIConfig,
  prompt: string,
  options?: { json?: boolean }
): Promise<string | null> => {
  try {
    const body: any = {
      model: config.aiModel || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 4096,
    };
    if (options?.json) {
      body.response_format = { type: 'json_object' };
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', errorText);
      return null;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return null;
  }
};

export const generateChatResponse = async (
  history: {role: string, parts: string}[], 
  message: string, 
  language: string = 'en',
  apiKey?: string
) => {
  const config = await getResolvedConfig();
  const key = apiKey || config?.apiKey;

  if (!key) {
    console.warn('[GeminiService] No AI API key available in database');
    return "API Key not configured.";
  }

  if (config?.aiProvider && config.aiProvider === 'openai') {
    try {
      const systemContent = `You are a helpful assistant for Betacademy. You help students and instructors.\nIMPORTANT: You MUST reply in ${language === 'ar' ? 'Arabic' : 'English'}.`;
      const messages = [
        { role: 'system', content: systemContent },
        ...history.map((entry) => ({
          role: entry.role === 'user' ? 'user' : 'assistant',
          content: entry.parts
        })),
        { role: 'user', content: message }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: config.aiModel || 'gpt-4o-mini',
          messages,
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 4096
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI Chat Error:', errorText);
        return "I'm having trouble connecting right now. Please try again later.";
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content;
      return reply || "I'm having trouble connecting right now. Please try again later.";
    } catch (error) {
      console.error('OpenAI Chat Error:', error);
      return "I'm having trouble connecting right now. Please try again later.";
    }
  }

  const aiBundle = await getAI(key);
  if (!aiBundle) return "API Key not configured.";

  const { ai } = aiBundle;
  if (config?.aiProvider && config.aiProvider !== 'gemini') {
    return "AI provider not supported for chat.";
  }
  
  try {
    // Convert history to string format for context
    const historyText = history.map(h => `${h.role === 'user' ? 'User' : 'Model'}: ${h.parts}`).join('\n');
    
    const prompt = `System: You are a helpful assistant for Betacademy. You help students and instructors.
    IMPORTANT: You MUST reply in ${language === 'ar' ? 'Arabic' : 'English'}.
    
    Conversation History:
    ${historyText}
    
    User Query: ${message}`;
    
    const result = await ai.models.generateContent({
      model: config.aiModel || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens
      }
    });
    
    return result.text;
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return "I'm having trouble connecting right now. Please try again later.";
  }
};

export const gradeAssignment = async (
  assignmentPrompt: string,
  studentAnswer: string,
  rubric?: string,
  language: string = 'en',
  apiKey?: string
) => {
  const config = await getResolvedConfig();
  const key = apiKey || config?.apiKey;
  if (!key) return { score: 0, feedback: "API Key missing." };

  const prompt = `
        You are an expert strict academic grader.

        Assignment Question: ${assignmentPrompt}

        ${rubric ? `Grading Rubric/Criteria: ${rubric}` : ''}

        Student Answer: ${studentAnswer}

        Please grade this on a scale of 0 to 100. Provide a JSON response.
        JSON format: { "score": number, "feedback": "string" }

        IMPORTANT: The "feedback" content MUST be in ${language === 'ar' ? 'Arabic' : 'English'} language.
        `;

  if (config?.aiProvider === 'openai') {
    try {
      const text = await callOpenAI(key, config, prompt, { json: true });
      return text ? JSON.parse(text) : { score: 0, feedback: "Error parsing result" };
    } catch (e) {
      console.error("Grading error (OpenAI)", e);
      return { score: 0, feedback: "AI Grading Failed" };
    }
  }

  const aiBundle = await getAI(apiKey);
  if (!aiBundle) return { score: 0, feedback: "API Key missing." };
  const { ai } = aiBundle;

    try {
        const result = await ai.models.generateContent({
          model: config?.aiModel || 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: config?.temperature,
            maxOutputTokens: config?.maxTokens
          }
        });

        return JSON.parse(result.text || '{"score": 0, "feedback": "Error parsing result"}');
    } catch (e) {
        console.error("Grading error", e);
        return { score: 0, feedback: "AI Grading Failed" };
    }
};

export const generateAssignmentDraft = async (topic: string, difficulty: string, context?: string, apiKey?: string) => {
  const config = await getResolvedConfig();
  const key = apiKey || config?.apiKey;
  if (!key) return null;

  const prompt = `
         You are an expert curriculum developer for an online academy.
         Generate a structured assignment based on the following details:

         Topic: "${topic}"
         Difficulty Level: ${difficulty}
         ${context ? `Additional Context/Lesson Content: ${context}` : ''}

         IMPORTANT: Do NOT generate any questions that involve drawing, sketching, or matching pictures/images. Only create text-based assignments.

         Return a JSON object with:
         1. "title": A professional title for the assignment.
         2. "question": The detailed assignment prompt/question for the student.
         3. "rubric": A concise grading rubric (max 50 words) describing what constitutes a good answer.

         JSON Format only.
         `;

  if (config?.aiProvider === 'openai') {
    try {
      const text = await callOpenAI(key, config, prompt, { json: true });
      return text ? JSON.parse(text) : null;
    } catch (e) {
      console.error("Assignment Gen Error (OpenAI)", e);
      return null;
    }
  }

  const aiBundle = await getAI(apiKey);
  if (!aiBundle) return null;
  const { ai } = aiBundle;

    try {
         const result = await ai.models.generateContent({
          model: config?.aiModel || 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: config?.temperature,
            maxOutputTokens: config?.maxTokens
          }
        });

        return JSON.parse(result.text || '{}');
    } catch (e) {
        console.error("Assignment Gen Error", e);
        return null;
    }
};

export const generateAiText = async (prompt: string, apiKey?: string): Promise<string | null> => {
  const config = await getResolvedConfig();
  const key = apiKey || config?.apiKey;
  if (!key) return null;

  if (config?.aiProvider === 'openai') {
    return callOpenAI(key, config, prompt);
  }

  const aiBundle = await getAI(apiKey);
  if (!aiBundle) return null;
  const { ai } = aiBundle;

    try {
    const result = await ai.models.generateContent({
      model: config?.aiModel || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: config?.temperature,
        maxOutputTokens: config?.maxTokens
      }
    });

        return result.text?.trim() || null;
    } catch (e) {
        console.error("AI Text Generation Error", e);
        return null;
    }
};

const parseJsonResponse = (text: string) => {
  if (!text) return null;

  const tryParse = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const fencedMatch = text.match(/```(?:json)?([\s\S]*?)```/i);
  const cleaned = fencedMatch ? fencedMatch[1].trim() : text.trim();

  const direct = tryParse(cleaned);
  if (direct) return direct;

  let startIndex = -1;
  const stack: string[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (char === '{' || char === '[') {
      if (startIndex === -1) startIndex = i;
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      if (!stack.length) continue;
      const last = stack[stack.length - 1];
      if ((last === '{' && char === '}') || (last === '[' && char === ']')) {
        stack.pop();
        if (stack.length === 0 && startIndex !== -1) {
          const block = cleaned.slice(startIndex, i + 1);
          return tryParse(block);
        }
      }
    }
  }

  return null;
};

export const generateCourseStructure = async (topic: string, description: string, level: string, apiKey?: string) => {
  try {
    const response = await fetch('/api/ai/generate-course', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ topic, description, level })
    });

    if (response.ok) {
      return await response.json();
    }

    console.warn('[GeminiService] Course generation API failed:', response.status);
  } catch (error) {
    console.warn('[GeminiService] Course generation API error:', error);
  }

  const config = await getResolvedConfig();
  const key = apiKey || config?.apiKey;
  if (!key) {
    console.warn('[GeminiService] No AI API key available in database');
    return null;
  }

  const prompt = `
        You are a world-class instructional designer. Create a comprehensive and detailed course structure for:
        
        Title: ${topic}
        Description: ${description}
        Level: ${level}

        The course must have at least 3 modules (Lessons).
        Each module must have at least 2 items (ContentItems).
        
        Available Item Types:
        - VIDEO: Needs a 'content' field (use a placeholder URL like "https://example.com/video").
        - TEXT: Provide a short 'contentOutline' (3-5 bullet points). Full lesson content will be generated later.
        - QUIZ: Needs a 'question' field and 'gradingRubric'.
        - ASSIGNMENT: Needs a 'question' field and 'gradingRubric'.

        IMPORTANT: Do NOT generate any questions that involve drawing, sketching, or matching pictures/images. Only create text-based questions that can be answered in writing.

        Return a JSON object in this format:
        {
          "title": "string",
          "description": "string",
          "modules": [
            {
              "title": "Module Title",
              "items": [
                 { "type": "VIDEO", "title": "Video Title", "content": "url" },
                 { "type": "TEXT", "title": "Text Title", "contentOutline": ["Point 1", "Point 2", "Point 3"] },
                 { "type": "QUIZ", "title": "Quiz Title", "question": "Question text", "gradingRubric": "Rubric text", "autoGrade": true }
              ]
            }
          ]
        }
        `;

  let generated: any | null = null;

  if (config?.aiProvider === 'openai') {
    try {
      const resultText = await callOpenAI(key, config, prompt, { json: true });
      generated = parseJsonResponse(resultText || '');
    } catch (error) {
      console.error('Course Generation Error (OpenAI):', error);
      return null;
    }
  } else {
    const aiBundle = await getAI(key);
    if (!aiBundle) return null;

    const { ai } = aiBundle;
    if (config?.aiProvider && config.aiProvider !== 'gemini') {
      return null;
    }

    try {
      const result = await ai.models.generateContent({
        model: config?.aiModel || 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: config?.temperature,
          maxOutputTokens: config?.maxTokens
        }
      });

      generated = parseJsonResponse(result.text || '');
    } catch (error) {
      console.error('Course Generation Error:', error);
      return null;
    }
  }

  if (!generated) {
    console.error('Course Generation Error: Unable to parse AI response');
    return null;
  }
  
  if (generated.modules && Array.isArray(generated.modules)) {
    generated.modules = generated.modules.map((module: any, mIdx: number) => ({
      ...module,
      id: module.id || `m_${Date.now()}_${mIdx}`,
      items: Array.isArray(module.items) ? module.items.map((item: any, iIdx: number) => ({
        ...item,
        id: item.id || `i_${Date.now()}_${mIdx}_${iIdx}`
      })) : []
    }));
  }

  const courseTitle = generated.title || topic;
  const courseDescription = generated.description || description;

  if (generated.modules && Array.isArray(generated.modules)) {
    for (const module of generated.modules) {
      if (!Array.isArray(module.items)) continue;
      for (const item of module.items) {
        if (item.type === 'VIDEO' && !item.content) {
          item.content = 'https://example.com/video';
        }

        if (item.type === 'TEXT') {
          const existing = typeof item.content === 'string' ? item.content.trim() : '';
          if (!existing || existing.length < 120) {
            const outline = Array.isArray(item.contentOutline)
              ? item.contentOutline.join(', ')
              : '';
            const lessonPrompt = `
Create a comprehensive educational lesson in Markdown format.

Course Title: ${courseTitle}
Course Description: ${courseDescription}
Level: ${level}
Module: ${module.title || 'Module'}
Lesson Title: ${item.title || 'Lesson'}
${outline ? `Outline: ${outline}` : ''}

Requirements:
- At least 300 words.
- Clear sections with headings.
- Explain key concepts with examples.
- Friendly, instructional tone.
`;
            const lessonContent = await generateAiText(lessonPrompt, apiKey);
            if (lessonContent) {
              item.content = lessonContent;
            }
          }
        }
      }
    }
  }

  return generated;
};

export const generateBlogPost = async (topic: string, author: string, apiKey?: string) => {
      const config = await getResolvedConfig();
      const key = apiKey || config?.apiKey;
      if (!key) return null;

      const prompt = `
        You are a professional blog writer for an educational academy.
        Write a high-quality, engaging blog post about: "${topic}".
        Author Name: ${author}

        Return a JSON object with the following fields:
        1. "title": Catchy title.
        2. "excerpt": A short summary (2-3 sentences).
        3. "content": The full blog post content in Markdown format. It should be engaging, educational, and well-structured with headings. Length: approx 400-600 words.

        JSON Format only.
        `;

      if (config?.aiProvider === 'openai') {
        try {
          const text = await callOpenAI(key, config, prompt, { json: true });
          return text ? JSON.parse(text) : null;
        } catch (e) {
          console.error("Blog Generation Error (OpenAI)", e);
          return null;
        }
      }

      const aiBundle = await getAI(apiKey);
      if (!aiBundle) return null;
      const { ai } = aiBundle;

    try {
        const result = await ai.models.generateContent({
          model: config?.aiModel || 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: config?.temperature,
            maxOutputTokens: config?.maxTokens
          }
        });

        return JSON.parse(result.text || '{}');
    } catch (e) {
        console.error("Blog Generation Error", e);
        return null;
    }
};

export const generateImage = async (prompt: string, apiKey?: string): Promise<string | null> => {
  const aiBundle = await getAI(apiKey);
  if (!aiBundle) return null;

  const { ai, config } = aiBundle;
  if (config.aiProvider && config.aiProvider !== 'gemini') {
    return null;
  }
    try {
        const imageModel = config.aiModel && config.aiModel.includes('image')
          ? config.aiModel
          : 'gemini-2.5-flash-image';

        const response = await ai.models.generateContent({
          model: imageModel,
            contents: {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
            config: {
              imageConfig: {
                    aspectRatio: "16:9",
                }
            },
        });

        // Find the image part in the response
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        return null;
    } catch (e) {
        console.error("Image Generation Error", e);
        return null;
    }
};

// --- LIVE API UTILS ---

export const createLiveSession = async (
    onAudioData: (base64: string) => void,
    onTranscription: (text: string, type: 'user' | 'model') => void,
    language: string = 'en',
    apiKey?: string
) => {
  const aiBundle = await getAI(apiKey);
  if (!aiBundle) throw new Error("No API Key");

  const { ai, config } = aiBundle;
  if (config.aiProvider && config.aiProvider !== 'gemini') {
    throw new Error("AI provider not supported for live sessions");
  }

    const liveModel = config.aiModel && config.aiModel.includes('audio')
      ? config.aiModel
      : 'gemini-2.5-flash-native-audio-preview-09-2025';

    const sessionPromise = ai.live.connect({
      model: liveModel,
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: `You are a friendly voice assistant for Betacademy. Keep answers concise and helpful. Speak in ${language === 'ar' ? 'Arabic' : 'English'}.`,
            inputAudioTranscription: {}, 
            outputAudioTranscription: {},
        },
        callbacks: {
            onopen: () => console.log("Live Session Open"),
            onmessage: (msg: LiveServerMessage) => {
                // Handle Audio
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) onAudioData(audioData);

                // Handle Transcription
                if (msg.serverContent?.inputTranscription?.text) {
                    onTranscription(msg.serverContent.inputTranscription.text, 'user');
                }
                if (msg.serverContent?.outputTranscription?.text) {
                    onTranscription(msg.serverContent.outputTranscription.text, 'model');
                }
            },
            onclose: () => console.log("Live Session Closed"),
            onerror: (err) => console.error("Live Session Error", err)
        }
    });

    return sessionPromise;
};