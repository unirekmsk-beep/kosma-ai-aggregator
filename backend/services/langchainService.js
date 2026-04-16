require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3001;

// Инициализация OpenRouter клиента
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// Доступные модели (бесплатные)
const AVAILABLE_MODELS = {
  openai_free: 'openai/gpt-oss-20b:free',
  meta_free: 'meta-llama/llama-3.3-70b-instruct:free',
  qwen_free: 'qwen/qwen3.6-plus-preview:free',
  deepseek_free: 'deepseek/deepseek-chat:free',
  mistral_free: 'mistralai/mistral-7b-instruct:free',
  gemma_free: 'google/gemma-3-27b-it:free',
  nvidia_free: 'nvidia/nemotron-3-nano-30b-a3b:free',
};

// Модель для синтеза (будет объединять ответы)
const SYNTHESIS_MODEL = 'openrouter/free'; // автоматически выбирает лучшую бесплатную

app.use(cors());
app.use(express.json());

// Функция запроса к одной модели
async function queryModel(modelId, prompt) {
  try {
    console.log(`  Querying ${modelId}...`);
    const completion = await openrouter.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
    });
    const content = completion.choices[0].message.content;
    console.log(`  ${modelId}: SUCCESS (${content.length} chars)`);
    return content;
  } catch (error) {
    console.error(`  ${modelId}: ERROR - ${error.message}`);
    return `[Error: ${error.message}]`;
  }
}

// Параллельный опрос нескольких моделей
async function queryMultipleModels(prompt, models) {
  const results = {};
  const modelIds = models.map(key => AVAILABLE_MODELS[key]).filter(id => id);
  
  const promises = modelIds.map(async (modelId) => {
    const response = await queryModel(modelId, prompt);
    // Находим ключ по значению модели
    const modelKey = Object.keys(AVAILABLE_MODELS).find(key => AVAILABLE_MODELS[key] === modelId);
    results[modelKey] = response;
  });
  
  await Promise.all(promises);
  return results;
}

// AI-синтез: объединение ответов нескольких моделей
async function aiSynthesize(prompt, responses) {
  // Формируем промпт для синтезатора
  const synthesisPrompt = `
Ты — профессиональный синтезатор ответов ИИ. Твоя задача — объединить ответы от нескольких моделей в один лучший ответ.

Вопрос пользователя: "${prompt}"

Вот ответы от разных моделей:

${Object.entries(responses).map(([model, response]) => `
=== МОДЕЛЬ: ${model} ===
${response}
`).join('\n')}

Правила синтеза:
1. Возьми самое ценное и точное из каждого ответа
2. Если модели противоречат друг другу — выбери наиболее логичный и обоснованный ответ
3. Сохрани важные детали, убрав повторы
4. Ответ должен быть связным, информативным и полезным
5. Если все ответы ошибочные или пустые — напиши, что не удалось получить ответ

Твой синтезированный ответ (только сам ответ, без пояснений):
`;

  try {
    console.log(`  Synthesizing responses with ${SYNTHESIS_MODEL}...`);
    const completion = await openrouter.chat.completions.create({
      model: SYNTHESIS_MODEL,
      messages: [{ role: "user", content: synthesisPrompt }],
      max_tokens: 1500,
      temperature: 0.5,
    });
    const synthesized = completion.choices[0].message.content;
    console.log(`  Synthesis: SUCCESS (${synthesized.length} chars)`);
    return synthesized;
  } catch (error) {
    console.error(`  Synthesis: ERROR - ${error.message}`);
    // Fallback: берём первый успешный ответ
    const firstValid = Object.values(responses).find(r => !r.includes('[Error:'));
    return firstValid || 'Не удалось синтезировать ответ. Пожалуйста, попробуйте позже.';
  }
}

// Простой синтез (fallback, если AI-синтез не сработал)
function simpleSynthesize(prompt, responses) {
  const validResponses = Object.entries(responses).filter(([_, resp]) => 
    resp && !resp.includes('[Error:')
  );
  
  if (validResponses.length === 0) {
    return 'Не удалось получить ответ от моделей. Пожалуйста, попробуйте позже.';
  }
  
  const bestResponse = validResponses[0][1];
  if (validResponses.length > 1) {
    return `${bestResponse}\n\n[Синтезировано из ${validResponses.length} моделей]`;
  }
  return bestResponse;
}

// Вычисление уверенности
function calculateConfidence(responses) {
  const validCount = Object.values(responses).filter(r => r && !r.includes('[Error:')).length;
  const totalCount = Object.keys(responses).length;
  const score = (validCount / totalCount) * 100;
  
  let level = 'low';
  if (score >= 70) level = 'high';
  else if (score >= 30) level = 'medium';
  
  return { score, level };
}

// ========== ЭНДПОИНТЫ ==========

app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  res.json({ 
    status: 'Backend is healthy', 
    message: 'AI Aggregator with AI Synthesis is running!',
    timestamp: new Date(),
    free_tier_enabled: hasKey,
    synthesis_model: SYNTHESIS_MODEL,
    framework: 'OpenRouter + AI Synthesis'
  });
});

// Получение списка моделей
app.get('/api/models', (req, res) => {
  res.json({
    available_models: Object.keys(AVAILABLE_MODELS).map(key => ({
      id: key,
      model: AVAILABLE_MODELS[key],
      is_free: true
    })),
    default_models: ['openai_free', 'meta_free', 'qwen_free'],
    synthesis_model: SYNTHESIS_MODEL,
    features: ['AI-powered synthesis', 'Parallel queries', 'Free tier']
  });
});

// Основной эндпоинт агрегации с AI-синтезом
app.post('/api/aggregate', async (req, res) => {
  const { 
    prompt, 
    models = ['openai_free', 'meta_free', 'qwen_free']
  } = req.body;

  if (!prompt || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required and cannot be empty' });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt is too long. Maximum 2000 characters allowed.' });
  }

  try {
    console.log(`\n=== AI Synthesis Aggregation ===`);
    console.log(`Prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
    console.log(`Models: ${models.join(', ')}`);

    const startTime = Date.now();

    // Шаг 1: Параллельный опрос моделей
    console.log(`\n[Step 1] Querying ${models.length} models in parallel...`);
    const modelResponses = await queryMultipleModels(prompt, models);
    
    const queryTime = Date.now() - startTime;
    console.log(`\n[Step 1] Completed in ${queryTime}ms`);

    // Логируем статусы
    Object.entries(modelResponses).forEach(([model, response]) => {
      const status = response && !response.includes('[Error:') ? 'SUCCESS' : 'FAILED';
      console.log(`  ${model}: ${status}`);
    });

    // Шаг 2: AI-синтез (объединение ответов)
    console.log(`\n[Step 2] AI Synthesis with ${SYNTHESIS_MODEL}...`);
    const synthesisStartTime = Date.now();
    
    let synthesizedResponse;
    let synthesisMethod;
    
    try {
      synthesizedResponse = await aiSynthesize(prompt, modelResponses);
      synthesisMethod = 'ai_synthesis';
    } catch (synthesisError) {
      console.log(`  AI Synthesis failed, falling back to simple synthesis...`);
      synthesizedResponse = simpleSynthesize(prompt, modelResponses);
      synthesisMethod = 'simple_synthesis_fallback';
    }
    
    const synthesisTime = Date.now() - synthesisStartTime;
    console.log(`[Step 2] Completed in ${synthesisTime}ms (method: ${synthesisMethod})`);

    // Шаг 3: Вычисление уверенности
    const confidence = calculateConfidence(modelResponses);
    console.log(`\n[Step 3] Confidence: ${confidence.level} (${confidence.score}%)`);

    // Формируем ответ
    const response = {
      prompt: prompt,
      synthesis: {
        response: synthesizedResponse,
        confidence: confidence.level,
        confidenceScore: confidence.score,
        method: synthesisMethod,
        synthesisModel: SYNTHESIS_MODEL,
        sourcesUsed: Object.keys(modelResponses).filter(key => 
          modelResponses[key] && !modelResponses[key].includes('[Error:')
        )
      },
      individualResponses: modelResponses,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        queryTimeMs: queryTime,
        synthesisTimeMs: synthesisTime,
        timestamp: new Date().toISOString(),
        totalSources: models.length,
        successfulSources: confidence.score / (100 / models.length),
        framework: 'OpenRouter + AI Synthesis',
        free_tier: true
      }
    };

    res.json(response);

  } catch (error) {
    console.error('\n=== Error in /api/aggregate ===');
    console.error(error);
    res.status(500).json({ 
      error: 'Failed to aggregate responses.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Тестовый эндпоинт для проверки AI-синтеза
app.get('/api/test-synthesis', async (req, res) => {
  const testPrompt = req.query.prompt || "What are the benefits of artificial intelligence?";
  
  try {
    // Тестовые ответы для проверки синтеза
    const testResponses = {
      openai_free: "AI helps automate repetitive tasks, freeing humans for creative work.",
      meta_free: "Key benefits include improved efficiency, data analysis at scale, and 24/7 availability.",
      qwen_free: "Artificial intelligence enhances decision-making, reduces errors, and enables new discoveries."
    };
    
    const synthesized = await aiSynthesize(testPrompt, testResponses);
    res.json({
      success: true,
      test_prompt: testPrompt,
      test_responses: testResponses,
      synthesized_response: synthesized,
      message: "AI Synthesis is working! You can now use /api/aggregate with real queries."
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      help: "Check your OPENROUTER_API_KEY in Railway Variables"
    });
  }
});

// Эндпоинт для проверки статуса API ключа
app.get('/api/key-status', (req, res) => {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  res.json({
    openrouter_configured: hasKey,
    synthesis_model: SYNTHESIS_MODEL,
    available_models: Object.keys(AVAILABLE_MODELS),
    features: ['parallel_queries', 'ai_synthesis', 'confidence_scoring'],
    message: hasKey ? '✅ API key configured. AI Synthesis ready!' : '❌ Add OPENROUTER_API_KEY to Railway Variables'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 AI Aggregator with AI Synthesis running on http://localhost:${PORT}`);
  console.log(`Health check: GET http://localhost:${PORT}/api/health`);
  console.log(`Test synthesis: GET http://localhost:${PORT}/api/test-synthesis`);
  console.log(`Aggregation: POST http://localhost:${PORT}/api/aggregate`);
  
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  console.log(`\n📋 OpenRouter API Key: ${hasKey ? '✅ Configured' : '❌ Missing'}`);
  if (hasKey) {
    console.log(`🎯 AI Synthesis Model: ${SYNTHESIS_MODEL}`);
    console.log(`📋 Default models: openai_free, meta_free, qwen_free`);
    console.log(`✨ Features: parallel queries + AI-powered synthesis + confidence scoring`);
  } else {
    console.log('⚠️  Please add OPENROUTER_API_KEY to your Railway Variables');
  }
  console.log('');
});
