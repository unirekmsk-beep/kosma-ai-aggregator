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

// ===== МОДЕЛИ (бесплатные, актуально на апрель 2026) =====
const FREE_MODELS = {
  gemma4_31b: 'google/gemma-4-31b:free',
  nemotron_super: 'nvidia/nemotron-3-super:free',
  gpt_oss_120b: 'openai/gpt-oss-120b:free',
  gemma4_26b: 'google/gemma-4-26b-a4b:free',
  qwen3_next: 'qwen/qwen3-next-80b-a3b-instruct:free',
  llama_3_3: 'meta-llama/llama-3.3-70b-instruct:free',
  nemotron_nano: 'nvidia/nemotron-3-nano-30b-a3b:free',
  gemma_2: 'google/gemma-2-27b-it:free',
  mistral: 'mistralai/mistral-7b-instruct:free',
};

// Модели по умолчанию (можно переопределить через переменную окружения)
const DEFAULT_MODEL_KEYS = process.env.DEFAULT_MODEL_KEYS 
  ? process.env.DEFAULT_MODEL_KEYS.split(',')
  : ['gemma4_31b', 'nemotron_super', 'gpt_oss_120b'];

// Модель для синтеза (фиксированная, быстрая)
const SYNTHESIS_MODEL = 'google/gemma-4-26b-a4b:free';

function getModelId(modelKey) {
  return FREE_MODELS[modelKey];
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
    const shortName = modelId.split('/').pop().replace(':free', '');
    results[shortName] = response;
  });
  await Promise.all(promises);
  return results;
}

// AI-синтез
async function aiSynthesize(prompt, responses) {
  const synthesisPrompt = `
Ты — профессиональный синтезатор ответов ИИ.

Вопрос пользователя: "${prompt}"

Ответы от разных моделей:
${Object.entries(responses).map(([model, response]) => `
=== МОДЕЛЬ: ${model} ===
${response}
`).join('\n')}

Объедини эти ответы в один лучший ответ. Возьми самое ценное из каждого, убери повторы.
Твой ответ (только сам ответ, без пояснений):
`;

  try {
    console.log(`  Synthesizing with ${SYNTHESIS_MODEL}...`);
    const completion = await openrouter.chat.completions.create({
      model: SYNTHESIS_MODEL,
      messages: [{ role: "user", content: synthesisPrompt }],
      max_tokens: 1500,
      temperature: 0.5,
    });
    return completion.choices[0].message.content;
  } catch (error) {
    console.error(`  Synthesis error: ${error.message}`);
    const firstValid = Object.values(responses).find(r => !r.includes('[Error:'));
    return firstValid || 'Не удалось синтезировать ответ.';
  }
}

// ========== ЭНДПОИНТЫ ==========

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Backend is healthy',
    message: 'AI Aggregator with fixed models is running!',
    default_models: DEFAULT_MODEL_KEYS,
    synthesis_model: SYNTHESIS_MODEL,
  });
});

app.get('/api/models', (req, res) => {
  res.json({
    available_models: Object.keys(FREE_MODELS),
    default_models: DEFAULT_MODEL_KEYS,
    synthesis_model: SYNTHESIS_MODEL,
  });
});

app.post('/api/aggregate', async (req, res) => {
  const { prompt, models = DEFAULT_MODEL_KEYS } = req.body;

  if (!prompt || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Преобразуем ключи моделей в ID
  const modelIds = models.map(key => getModelId(key)).filter(id => id);
  
  if (modelIds.length === 0) {
    return res.status(400).json({ error: 'No valid models specified' });
  }

  console.log(`\n=== Aggregation with ${modelIds.length} models ===`);
  console.log(`Prompt: "${prompt.substring(0, 100)}..."`);
  console.log(`Models: ${modelIds.join(', ')}`);

  const startTime = Date.now();

  // Шаг 1: Опрос моделей
  const modelResponses = await queryMultipleModels(prompt, modelIds);
  const queryTime = Date.now() - startTime;

  // Шаг 2: Синтез
  const synthesisStartTime = Date.now();
  const synthesizedResponse = await aiSynthesize(prompt, modelResponses);
  const synthesisTime = Date.now() - synthesisStartTime;

  const response = {
    prompt: prompt,
    synthesis: {
      response: synthesizedResponse,
      confidence: 'medium',
      confidenceScore: (Object.keys(modelResponses).length / modelIds.length) * 100,
      method: 'ai_synthesis',
      synthesisModel: SYNTHESIS_MODEL,
      sourcesUsed: Object.keys(modelResponses)
    },
    individualResponses: modelResponses,
    metadata: {
      processingTimeMs: Date.now() - startTime,
      queryTimeMs: queryTime,
      synthesisTimeMs: synthesisTime,
      timestamp: new Date().toISOString(),
      totalSources: modelIds.length,
      successfulSources: Object.keys(modelResponses).length,
      framework: 'OpenRouter + Fixed Models',
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
    message: hasKey ? '✅ API key configured' : '❌ Add OPENROUTER_API_KEY'
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Backend running on http://localhost:${PORT}`);
  console.log(`Default models: ${DEFAULT_MODEL_KEYS.join(', ')}`);
  console.log(`Synthesis model: ${SYNTHESIS_MODEL}`);
});
