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

// Доступные модели через OpenRouter
const AVAILABLE_MODELS = {
  openai: 'openai/gpt-3.5-turbo',
  openai_gpt4: 'openai/gpt-4o',
  anthropic: 'anthropic/claude-3.5-sonnet',
  google: 'google/gemini-2.0-flash',
  meta: 'meta-llama/llama-3.3-70b-instruct',
  mistral: 'mistralai/mistral-7b-instruct',
  deepseek: 'deepseek/deepseek-chat'
};

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Backend is healthy', 
    message: 'AI Aggregator backend with OpenRouter is running!',
    timestamp: new Date(),
    services: Object.keys(AVAILABLE_MODELS),
    framework: 'OpenRouter'
  });
});

// Функция запроса к одной модели через OpenRouter
async function queryModel(modelId, prompt) {
  try {
    const completion = await openrouter.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    console.error(`Error querying model ${modelId}:`, error.message);
    return `[Error: ${error.message}]`;
  }
}

// Параллельный опрос нескольких моделей
async function queryMultipleModels(prompt, models) {
  const results = {};
  const promises = models.map(async (modelKey) => {
    const modelId = AVAILABLE_MODELS[modelKey];
    if (modelId) {
      const response = await queryModel(modelId, prompt);
      results[modelKey] = response;
    } else {
      results[modelKey] = `[Error: Unknown model ${modelKey}]`;
    }
  });
  
  await Promise.all(promises);
  return results;
}

// Функция синтеза ответов (простая версия, можно заменить на более сложную)
function synthesizeResponses(prompt, responses) {
  const validResponses = Object.entries(responses).filter(([_, resp]) => 
    resp && !resp.includes('[Error:') && !resp.includes('mock')
  );
  
  const confidenceScore = (validResponses.length / Object.keys(responses).length) * 100;
  let confidence = 'low';
  if (confidenceScore >= 70) confidence = 'high';
  else if (confidenceScore >= 30) confidence = 'medium';
  
  // Простой синтез: берём первый успешный ответ или собираем summary
  let synthesizedResponse = '';
  if (validResponses.length > 0) {
    synthesizedResponse = validResponses[0][1];
    if (validResponses.length > 1) {
      synthesizedResponse += `\n\n[Синтезировано из ${validResponses.length} моделей]`;
    }
  } else {
    synthesizedResponse = 'Не удалось получить ответ от моделей. Пожалуйста, попробуйте позже.';
  }
  
  return {
    response: synthesizedResponse,
    confidence: confidence,
    confidenceScore: confidenceScore,
    approach: 'openrouter_aggregation',
    details: {
      validModels: validResponses.length,
      totalModels: Object.keys(responses).length,
      modelsUsed: validResponses.map(([key]) => key)
    }
  };
}

// Основной эндпоинт агрегации
app.post('/api/aggregate', async (req, res) => {
  const { prompt, models = ['openai', 'anthropic', 'google'] } = req.body;

  if (!prompt || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required and cannot be empty' });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt is too long. Maximum 2000 characters allowed.' });
  }

  try {
    console.log(`\n=== OpenRouter Aggregation for prompt ===`);
    console.log(`Prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
    console.log(`Requested models: ${models.join(', ')}`);

    const startTime = Date.now();

    // Запрос к выбранным моделям
    const modelResponses = await queryMultipleModels(prompt, models);
    
    const queryTime = Date.now() - startTime;
    console.log(`\n=== Model queries completed in ${queryTime}ms ===`);

    // Логируем статусы
    Object.entries(modelResponses).forEach(([model, response]) => {
      if (response && !response.includes('[Error:')) {
        console.log(`${model}: SUCCESS - ${response.length} characters`);
      } else {
        console.log(`${model}: FAILED`);
      }
    });

    // Синтез ответов
    const synthesisStartTime = Date.now();
    const synthesis = synthesizeResponses(prompt, modelResponses);
    const synthesisTime = Date.now() - synthesisStartTime;

    console.log(`\n=== Synthesis completed in ${synthesisTime}ms ===`);
    console.log(`Confidence: ${synthesis.confidence} (${synthesis.confidenceScore}%)`);

    // Форматируем ответ
    const response = {
      prompt: prompt,
      synthesis: {
        response: synthesis.response,
        confidence: synthesis.confidence,
        confidenceScore: synthesis.confidenceScore,
        approach: synthesis.approach,
        sourcesUsed: synthesis.details.modelsUsed,
        details: synthesis.details
      },
      individualResponses: modelResponses,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        queryTimeMs: queryTime,
        synthesisTimeMs: synthesisTime,
        timestamp: new Date().toISOString(),
        totalSources: models.length,
        successfulSources: synthesis.details.validModels,
        framework: 'OpenRouter'
      }
    };

    res.json(response);

  } catch (error) {
    console.error('\n=== Error in /api/aggregate route ===');
    console.error('Error details:', error);
    res.status(500).json({ 
      error: 'Failed to aggregate responses due to an internal error.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Эндпоинт для получения списка доступных моделей
app.get('/api/models', (req, res) => {
  res.json({
    models: AVAILABLE_MODELS,
    default_models: ['openai', 'anthropic', 'google'],
    framework: 'OpenRouter',
    documentation: 'https://openrouter.ai/docs',
    features: [
      '100+ models available',
      'Automatic retries',
      'Parallel execution',
      'Model selection'
    ]
  });
});

// Эндпоинт для проверки статуса API ключа
app.get('/api/key-status', (req, res) => {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  res.json({
    openrouter_configured: hasKey,
    message: hasKey ? 'OpenRouter API key is configured' : 'OpenRouter API key is missing'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 AI Aggregator Backend with OpenRouter running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Aggregation endpoint: POST http://localhost:${PORT}/api/aggregate`);
  console.log(`Model info: GET http://localhost:${PORT}/api/models`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  console.log(`\n📋 OpenRouter API Key: ${hasKey ? '✅ Configured' : '❌ Missing'}`);
  if (!hasKey) {
    console.log('⚠️  Please add OPENROUTER_API_KEY to your environment variables');
  }
  console.log('\n🔗 Using OpenRouter for unified AI model access');
  console.log('');
});
