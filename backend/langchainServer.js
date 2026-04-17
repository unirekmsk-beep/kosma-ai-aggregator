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

// ===== ТОЛЬКО СТАБИЛЬНЫЕ МОДЕЛИ (апрель 2026) =====
const FREE_MODELS = {
  // Три разные модели для параллельного опроса
  nemotron_super: 'nvidia/nemotron-3-super-120b-a12b:free',   // мощная от NVIDIA
  gpt_oss_120b: 'openai/gpt-oss-120b:free',                  // от OpenAI
  gemma_3_27b: 'google/gemma-3-27b-it:free',                 // от Google (рабочая, проверена)
  
  // Запасная (только для fallback, если основные падают)
  nemotron_nano: 'nvidia/nemotron-3-nano-30b-a3b:free',
};

// Модели для опроса по умолчанию (3 разные)
const DEFAULT_MODEL_KEYS = ['nemotron_super', 'gpt_oss_120b', 'gemma_3_27b'];

// Модель-синтезатор — отдельная, не участвует в опросе
const SYNTHESIS_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';

function getModelId(modelKey) {
  const modelId = FREE_MODELS[modelKey];
  if (!modelId) {
    console.warn(`Unknown model key: ${modelKey}, using fallback`);
    return FREE_MODELS.qwen_3_6; // fallback на стабильную Qwen
  }
  return modelId;
}

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
async function queryMultipleModels(prompt, modelIds) {
  const results = {};
  const promises = modelIds.map(async (modelId) => {
    const response = await queryModel(modelId, prompt);
    const shortName = modelId.split('/').pop().replace(':free', '').substring(0, 30);
    results[shortName] = response;
  });
  await Promise.all(promises);
  return results;
}

// AI-синтез с автоматическим fallback (список запасных моделей)
async function aiSynthesize(prompt, responses) {
  const synthesisPrompt = `
Ты — профессиональный синтезатор ответов ИИ.

Вопрос пользователя: "${prompt}"

Вот ответы от разных моделей ИИ:
${Object.entries(responses).map(([model, response]) => `
=== МОДЕЛЬ: ${model} ===
${response.substring(0, 1500)}${response.length > 1500 ? '...(обрезано)' : ''}
`).join('\n')}

Твоя задача: объединить эти ответы в один лучший ответ. 
Возьми самое ценное и точное из каждого ответа. 
Убери повторы. Если модели противоречат друг другу — выбери наиболее логичный и обоснованный ответ.

ТВОЙ СИНТЕЗИРОВАННЫЙ ОТВЕТ (только сам ответ, без пояснений):
`;

  // Список моделей для синтеза в порядке приоритета (от самых стабильных)
  const synthesisModels = [
    'qwen/qwen3.6-plus-preview:free',           // Новая, 1M контекста, стабильная
    'google/gemma-3-27b-it:free',                // Надёжная от Google
    'nvidia/nemotron-3-nano-30b-a3b:free',       // Лёгкая и быстрая от NVIDIA [citation:1]
    'meta-llama/llama-3.3-70b-instruct:free'     // Мощная, но может быть нагружена
  ];
  
  for (const model of synthesisModels) {
    try {
      console.log(`  Synthesizing with ${model}...`);
      const completion = await openrouter.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: synthesisPrompt }],
        max_tokens: 1500,
        temperature: 0.5,
      });
      console.log(`  Synthesis with ${model}: SUCCESS`);
      return completion.choices[0].message.content;
    } catch (error) {
      console.log(`  ${model} failed: ${error.message}, trying next...`);
    }
  }
  
  // Если все модели упали — берём первый успешный ответ как fallback
  const firstValid = Object.values(responses).find(r => r && !r.includes('[Error:'));
  return firstValid || 'Не удалось синтезировать ответ. Пожалуйста, попробуйте позже.';
}

// ========== ЭНДПОИНТЫ ==========

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Backend is healthy',
    message: 'AI Aggregator is running!',
    default_models: DEFAULT_MODEL_KEYS,
    synthesis_model: SYNTHESIS_MODEL,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/models', (req, res) => {
  res.json({
    available_models: Object.keys(FREE_MODELS),
    default_models: DEFAULT_MODEL_KEYS,
    synthesis_model: SYNTHESIS_MODEL,
    fallback_models: ['llama_3_3', 'qwen_3_next']
  });
});

app.post('/api/aggregate', async (req, res) => {
  const { prompt, models = DEFAULT_MODEL_KEYS } = req.body;

  if (!prompt || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required and cannot be empty' });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt is too long. Maximum 2000 characters allowed.' });
  }

  // Преобразуем ключи моделей в ID (с автоматическим fallback)
  const modelIds = models.map(key => getModelId(key)).filter(id => id);
  
  if (modelIds.length === 0) {
    return res.status(400).json({ error: 'No valid models specified' });
  }

  console.log(`\n=== AI Synthesis Aggregation ===`);
  console.log(`Prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
  console.log(`Models: ${modelIds.join(', ')}`);

  const startTime = Date.now();

  // Шаг 1: Параллельный опрос моделей
  console.log(`\n[Step 1] Querying ${modelIds.length} models in parallel...`);
  const modelResponses = await queryMultipleModels(prompt, modelIds);
  const queryTime = Date.now() - startTime;
  console.log(`[Step 1] Completed in ${queryTime}ms`);

  // Логируем статусы
  Object.entries(modelResponses).forEach(([model, response]) => {
    const status = response && !response.includes('[Error:') ? 'SUCCESS' : 'FAILED';
    console.log(`  ${model}: ${status}`);
  });

  // Шаг 2: AI-синтез (отдельной моделью)
  console.log(`\n[Step 2] AI Synthesis with ${SYNTHESIS_MODEL}...`);
  const synthesisStartTime = Date.now();
  const synthesizedResponse = await aiSynthesize(prompt, modelResponses);
  const synthesisTime = Date.now() - synthesisStartTime;
  console.log(`[Step 2] Completed in ${synthesisTime}ms`);

  // Шаг 3: Вычисление уверенности
  const successfulCount = Object.values(modelResponses).filter(r => r && !r.includes('[Error:')).length;
  const confidenceScore = (successfulCount / modelIds.length) * 100;
  let confidenceLevel = 'low';
  if (confidenceScore >= 70) confidenceLevel = 'high';
  else if (confidenceScore >= 30) confidenceLevel = 'medium';
  console.log(`\n[Step 3] Confidence: ${confidenceLevel} (${confidenceScore.toFixed(1)}%)`);

  // Формируем ответ
  const response = {
    prompt: prompt,
    synthesis: {
      response: synthesizedResponse,
      confidence: confidenceLevel,
      confidenceScore: Math.round(confidenceScore),
      method: 'ai_synthesis',
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
      totalSources: modelIds.length,
      successfulSources: successfulCount,
      framework: 'OpenRouter + Fixed Models + AI Synthesis',
      free_tier: true
    }
  };

  res.json(response);
});

app.get('/api/key-status', (req, res) => {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  res.json({
    openrouter_configured: hasKey,
    default_models: DEFAULT_MODEL_KEYS,
    synthesis_model: SYNTHESIS_MODEL,
    available_models: Object.keys(FREE_MODELS),
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
  console.log(`Aggregation: POST http://localhost:${PORT}/api/aggregate`);
  console.log(`\n📋 Configuration:`);
  console.log(`  Default models: ${DEFAULT_MODEL_KEYS.join(', ')}`);
  console.log(`  Synthesis model: ${SYNTHESIS_MODEL}`);
  console.log(`  Fallback models: llama_3_3, qwen_3_next`);
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  console.log(`  OpenRouter API Key: ${hasKey ? '✅ Configured' : '❌ Missing'}`);
  console.log(`\n✨ Features: parallel queries + AI-powered synthesis + confidence scoring + automatic fallback`);
  console.log('');
});
