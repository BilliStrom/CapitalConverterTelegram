const { Telegraf } = require('telegraf');

// Фикс для вебхуков на Vercel
process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    webhookReply: false,
    agent: null
  }
});

// Логирование инициализации
console.log('Bot initialization started');
console.log('Environment:', process.env.VERCEL_ENV || 'development');
console.log('Node version:', process.version);

// Проверка токена
if (!process.env.BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is not defined!');
} else {
  console.log('Bot token:', process.env.BOT_TOKEN.substring(0, 6) + '...');
}

// Простые команды для проверки
bot.start(ctx => {
  console.log('/start command received');
  return ctx.reply('🚀 Бот успешно запущен! Используйте команды:\n/test - проверка работы\n/exchange - обмен валюты');
});

bot.command('test', ctx => {
  console.log('/test command received');
  ctx.reply('✅ Тест успешен! Бот работает корректно.');
});

bot.command('exchange', ctx => {
  console.log('/exchange command received');
  ctx.reply('🔁 Функция обмена в разработке...');
});

// Расширенное логгирование
bot.use((ctx, next) => {
  console.log('Update received:', JSON.stringify(ctx.update, null, 2));
  return next();
});

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    console.log(`\n--- New ${req.method} Request ---`);
    
    if (req.method === 'POST') {
      try {
        // Для Vercel Serverless Functions
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        console.log('Request body:', body);
        
        const update = JSON.parse(body);
        await bot.handleUpdate(update);
        res.end('OK');
      } catch (err) {
        console.error('Request processing error:', err);
        res.status(500).end('Internal error');
      }
    } else {
      res.status(200).json({
        status: 'active',
        platform: 'Telegram Crypto Bot',
        node: process.version,
        time: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Global error handler:', err);
    res.status(500).end('Server error');
  }
};

// Финал инициализации
console.log('Bot initialization completed');