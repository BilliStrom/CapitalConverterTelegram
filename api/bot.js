const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    webhookReply: false // ВАЖНО для Vercel!
  }
});

// Включаем сессии
bot.use(Telegraf.session());

// Логгирование всех входящих запросов
bot.use(async (ctx, next) => {
  console.log('Received update:', JSON.stringify(ctx.update, null, 2));
  await next();
});

// Команды
bot.start(ctx => ctx.reply('🪙 Бот активирован! Используйте /exchange'));

bot.command('exchange', ctx => {
  ctx.reply('Выберите пару:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'BTC → USDC', callback_data: 'BTC_USDC' }]
      ]
    }
  });
});

// Обработчик кнопок
bot.action('BTC_USDC', ctx => {
  ctx.editMessageText('Введите сумму BTC:');
  ctx.session = { action: 'exchange', pair: 'BTC_USDC' };
});

// Обработчик текста
bot.on('text', ctx => {
  if (ctx.session?.action === 'exchange') {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount)) {
      return ctx.reply('Введите число!');
    }
    ctx.reply(`✅ Вы ввели: ${amount} BTC`);
    ctx.session = null;
  }
});

// Vercel handler (КРИТИЧЕСКИ ВАЖНО)
module.exports = async (req, res) => {
  try {
    // Логируем входящий запрос
    console.log('Incoming request:', req.method, req.url);
    
    if (req.method === 'POST') {
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      await bot.handleUpdate(req.body, res);
    } else {
      // Для GET запросов
      res.status(200).json({
        status: 'alive',
        message: 'Bot is running'
      });
    }
  } catch (err) {
    console.error('FATAL ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

// Проверка инициализации
console.log('Bot initialized');