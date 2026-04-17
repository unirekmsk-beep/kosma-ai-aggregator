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

// ===== ПОЛНЫЙ СПИСОК БЕСПЛАТНЫХ МОДЕЛЕЙ (апрель 2026) =====
const FREE_MODELS = {
  // ОСНОВНЫЕ (ТОП-3) — самые мощные и стабильные
  nemotron_super: 'nvidia/nemotron-3-super-120b-a12b:free',
  gpt_oss_120b: 'openai/gpt-oss-120b:free',
  gemma_4_31b: 'google/gemma-4-31b-it:free',
  
  // РЕЗЕРВНЫЕ (1-я линия) — тоже мощные, на случай перегрузки основных
  qwen_next: 'qwen/qwen3-next-80b-a3b-instruct:free',
  glm_4_5: 'z-ai/glm-4.5-air:free',
  minimax: 'minimax/minimax-m2.5:free',
  hermes: 'nousresearch/hermes-3-llama-3.1-405b:free',
  
  // ЛЁГКИЕ (2-я линия) — для синтеза и быстрых ответов
  nemotron_nano: 'nvidia/nemotron-3-nano-30b-a3b:free',
  gemma_3_27b: 'google/gemma-3-27b-it:free',
  gemma_3_12b: 'google/gemma-3-12b-it:free',
  
  // САМЫЕ ЛЁГКИЕ (последний рубеж)
  gemma_3_4b: 'google/gemma-3-4b-it:free',
  llama_3_2: 'meta-llama/llama-3.2-3b-instruct:free',
};

// Модели для опроса по умолчанию (ТОП-3)
const DEFAULT_MODEL_KEYS = ['nemotron_super', 'gpt_oss_120b', 'gemma_4_31b'];

// Модель-синтезатор (отдельная, лёгкая и быстрая)
const SYNTHESIS_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';

// Список всех ID моделей для синтеза (в порядке приоритета)
const SYNTHESIS_MODELS_LIST = [
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'z-ai/glm-4.5-air:free',
  'minimax/minimax-m2.5:free',
  'google/gemma-3-4b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

function getModelId(modelKey) {
  const modelId = FREE_MODELS[modelKey];
  if (!modelId) {
    console.warn(`Unknown model key: ${modelKey}, using fallback to nemotron_nano`);
    return FREE_MODELS.nemotron_nano;
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

// AI-синтез с автоматическим перебором моделей
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

  // Перебираем все модели из списка SYNTHESIS_MODELS_LIST
  for (const model of SYNTHESIS_MODELS_LIST) {
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
  
  // Если все модели упали — берём первый успешный ответ
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
    synthesis_fallback_list: SYNTHESIS_MODELS_LIST
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

  // Шаг 2: AI-синтез (с автоматическим перебором моделей)
  console.log(`\n[Step 2] AI Synthesis (trying fallback models)...`);
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
      synthesisModel: 'auto_fallback',
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
      framework: 'OpenRouter + Multi-Tier Fallback',
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
  console.log(`\n🚀 AI Aggregator with Multi-Tier Fallback running on http://localhost:${PORT}`);
  console.log(`Health check: GET http://localhost:${PORT}/api/health`);
  console.log(`Aggregation: POST http://localhost:${PORT}/api/aggregate`);
  console.log(`\n📋 Configuration:`);
  console.log(`  Default models: ${DEFAULT_MODEL_KEYS.join(', ')}`);
  console.log(`  Synthesis fallback count: ${SYNTHESIS_MODELS_LIST.length} models`);
  console.log(`  OpenRouter API Key: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`\n✨ Features: parallel queries + multi-tier AI synthesis + confidence scoring`);
  console.log('');
});
