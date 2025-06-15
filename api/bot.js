const { Telegraf } = require('telegraf');
const axios = require('axios');

// Инициализация бота с логгированием
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { 
    testEnv: process.env.NODE_ENV === 'test',
    webhookReply: false // Важно для Vercel!
  }
});

// Добавляем логгирование всех событий
bot.use(async (ctx, next) => {
  console.log('Received update:', JSON.stringify(ctx.update, null, 2));
  await next();
});

// Фиксированные курсы
const rates = {
  BTC_USD: 63000,
  ETH_USD: 3500,
  USDC_USD: 1,
  BTC_ETH: 0.055,
  ETH_BTC: 18.18
};

bot.start(ctx => {
  console.log(`/start from ${ctx.from.id}`);
  return ctx.reply(`🪙 Добро пожаловать! Используйте /exchange`);
});

bot.command('exchange', ctx => {
  console.log(`/exchange from ${ctx.from.id}`);
  ctx.reply('🔁 Выберите пару:', {
    reply_markup: {
      inline_keyboard: [
        [
          { 
            text: 'BTC → USDC', 
            callback_data: 'pair_BTC_USDC' 
          },
          { 
            text: 'ETH → BTC', 
            callback_data: 'pair_ETH_BTC' 
          }
        ]
      ]
    }
  });
});

// Обработка кнопок с логгированием
bot.action(/^pair_(\w+)_(\w+)$/, async (ctx) => {
  const [, from, to] = ctx.match;
  console.log(`Action received: ${from}_${to} from ${ctx.from.id}`);
  
  await ctx.editMessageText(`Выбрано: ${from} → ${to}\nВведите сумму:`);
  
  // Сохраняем состояние
  ctx.session = { action: 'exchange', from, to };
});

// Обработка текста с проверкой состояния
bot.on('text', async (ctx) => {
  console.log(`Text received: "${ctx.message.text}" from ${ctx.from.id}`);
  
  if (!ctx.session?.action) {
    return ctx.reply('Используйте /exchange для начала');
  }
  
  const amount = parseFloat(ctx.message.text);
  if (isNaN(amount)) {
    return ctx.reply('Введите число!');
  }
  
  const { from, to } = ctx.session;
  const pair = `${from}_${to}`;
  
  if (!rates[pair]) {
    return ctx.reply('Курс не найден');
  }
  
  const result = (amount * rates[pair]).toFixed(6);
  console.log(`Calculated exchange: ${amount} ${from} = ${result} ${to}`);
  
  ctx.reply(`✅ Результат: ${amount} ${from} = ${result} ${to}`);
  ctx.session = null;
});

// Обработчик для Vercel с логгированием
module.exports = async (req, res) => {
  try {
    console.log('Incoming request:', req.method, req.url);
    
    if (req.method === 'POST') {
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).send('Bot is running');
    }
  } catch (err) {
    console.error('FATAL ERROR:', err.stack);
    res.status(500).json({ error: err.message });
  }
};
