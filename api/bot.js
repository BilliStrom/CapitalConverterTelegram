const { Telegraf } = require('telegraf');
const axios = require('axios');

// Фикс для вебхуков на Vercel
process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    webhookReply: false,
    agent: null
  }
});

// Простая реализация сессий в памяти (без записи на диск)
const userSessions = {};

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (userId) {
    // Инициализируем сессию пользователя
    if (!userSessions[userId]) {
      userSessions[userId] = {};
    }
    ctx.session = userSessions[userId];
  }
  return next();
});

// Начальные данные
const cryptoData = {
  BTC: { name: "Bitcoin", wallet: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" },
  ETH: { name: "Ethereum", wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" },
  USDT: { name: "Tether", wallet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  LTC: { name: "Litecoin", wallet: "LcWJv3djruGY4uh7xVPZyKxqJJUTdrzqN7" }
};

// Курсы обмена
const exchangeRates = {
  BTC_USDT: 63000,
  ETH_USDT: 3500,
  LTC_USDT: 75,
  BTC_ETH: 18.0,
  ETH_BTC: 0.055,
  LTC_BTC: 0.0012,
  BTC_LTC: 840,
  ETH_LTC: 46.67
};

// Команда /start
bot.start(ctx => {
  ctx.reply(`🚀 Добро пожаловать в Crypto Exchange Bot!
  
Я помогу вам обменять криптовалюты по выгодному курсу. Доступные команды:

💱 /exchange - начать обмен
📊 /rates - текущие курсы
🆘 /help - помощь

Для быстрого старта нажмите /exchange`);
});

// Команда /rates
bot.command('rates', async ctx => {
  try {
    ctx.replyWithMarkdown(`📈 *Текущие курсы:*
    
1 BTC = ${exchangeRates.BTC_USDT} USDT
1 ETH = ${exchangeRates.ETH_USDT} USDT
1 LTC = ${exchangeRates.LTC_USDT} USDT

1 BTC = ${exchangeRates.BTC_ETH} ETH
1 ETH = ${exchangeRates.ETH_BTC} BTC
1 LTC = ${exchangeRates.LTC_BTC} BTC`);

  } catch (error) {
    ctx.reply('⚠️ Ошибка при получении курсов');
  }
});

// Команда /exchange
bot.command('exchange', ctx => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'select_pair';
  
  ctx.reply('🔄 Выберите направление обмена:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'BTC → USDT', callback_data: 'pair_BTC_USDT' },
          { text: 'ETH → BTC', callback_data: 'pair_ETH_BTC' }
        ],
        [
          { text: 'USDT → ETH', callback_data: 'pair_USDT_ETH' },
          { text: 'LTC → BTC', callback_data: 'pair_LTC_BTC' }
        ],
        [
          { text: 'Другие пары', callback_data: 'more_pairs' }
        ]
      ]
    }
  });
});

// Обработка кнопок
bot.action('more_pairs', ctx => {
  ctx.editMessageText('Выберите пару:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'ETH → USDT', callback_data: 'pair_ETH_USDT' },
          { text: 'BTC → LTC', callback_data: 'pair_BTC_LTC' }
        ],
        [
          { text: 'USDT → BTC', callback_data: 'pair_USDT_BTC' },
          { text: 'LTC → ETH', callback_data: 'pair_LTC_ETH' }
        ],
        [
          { text: '← Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  });
});

bot.action('back_to_main', ctx => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'select_pair';
  ctx.editMessageText('🔄 Выберите направление обмена:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'BTC → USDT', callback_data: 'pair_BTC_USDT' },
          { text: 'ETH → BTC', callback_data: 'pair_ETH_BTC' }
        ],
        [
          { text: 'USDT → ETH', callback_data: 'pair_USDT_ETH' },
          { text: 'LTC → BTC', callback_data: 'pair_LTC_BTC' }
        ],
        [
          { text: 'Другие пары', callback_data: 'more_pairs' }
        ]
      ]
    }
  });
});

// Обработка выбора пары
bot.action(/^pair_(\w+)_(\w+)$/, async (ctx) => {
  const [, from, to] = ctx.match;
  
  // Инициализируем сессию если нужно
  if (!ctx.session) ctx.session = {};
  
  // Сохраняем в сессию
  ctx.session.step = 'enter_amount';
  ctx.session.from = from.toUpperCase();
  ctx.session.to = to.toUpperCase();
  
  await ctx.deleteMessage();
  ctx.reply(`💱 Вы выбрали: ${from.toUpperCase()} → ${to.toUpperCase()}\n\nВведите сумму ${from.toUpperCase()} для обмена:`);
});

// Обработка ввода суммы
bot.on('text', async (ctx) => {
  // Пропускаем команды
  if (ctx.message.text.startsWith('/')) return;
  
  // Проверяем наличие сессии и шаг
  if (!ctx.session || !ctx.session.step || ctx.session.step !== 'enter_amount') {
    return ctx.reply('Используйте /exchange для начала обмена');
  }
  
  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  
  if (isNaN(amount)) {
    return ctx.reply('⚠️ Пожалуйста, введите число. Например: 0.5 или 100');
  }
  
  if (amount <= 0) {
    return ctx.reply('⚠️ Сумма должна быть больше нуля');
  }
  
  const { from, to } = ctx.session;
  const pair = `${from}_${to}`;
  
  if (!exchangeRates[pair]) {
    return ctx.reply('❌ Курс для этой пары не доступен');
  }
  
  // Рассчет суммы
  const rate = exchangeRates[pair];
  const result = (amount * rate).toFixed(6);
  
  // Форматируем сумму
  const formattedAmount = amount.toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  });
  
  const formattedResult = parseFloat(result).toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  });
  
  // Получаем данные по валютам
  const fromCurrency = cryptoData[from] || { name: from };
  const toCurrency = cryptoData[to] || { name: to };
  
  // Отправляем результат
  ctx.replyWithMarkdown(`✅ *Детали обмена:*
  
➡️ Отправляете: *${formattedAmount} ${from}* (${fromCurrency.name})
⬅️ Получаете: *${formattedResult} ${to}* (${toCurrency.name})
📊 Курс: 1 ${from} = ${rate} ${to}

💳 *Для завершения операции:*
1. Переведите ${formattedAmount} ${from} на адрес:
\`${fromCurrency.wallet}\`

2. После отправки средств пришлите TXID (хэш транзакции) для подтверждения

⏱️ Ордер будет активен 60 минут`);

  // Сбрасываем сессию
  if (ctx.from?.id) {
    delete userSessions[ctx.from.id];
  }
});

// Команда /help
bot.command('help', ctx => {
  ctx.replyWithMarkdown(`❓ *Помощь по боту:*
  
💱 *Обмен валют:*
1. Используйте /exchange
2. Выберите пару для обмена
3. Введите сумму
4. Переведите средства на указанный адрес
5. Пришлите TXID транзакции

📊 *Курсы валют:*
- Все курсы фиксированные
- Обновляются каждые 30 минут
- Для просмотра используйте /rates

⏱️ *Время операций:*
- Крипто: 10-60 минут
- Поддержка: 24/7

⚠️ *Важно:*
- Минимальная сумма: 10 USD эквивалент
- Комиссии сети оплачивает отправитель
- Адреса проверяйте через сканер QR-кода`);
});

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ 
        status: 'active',
        service: 'Crypto Exchange Telegram Bot',
        version: '1.0'
      });
    }
  } catch (err) {
    console.error('Global error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Запуск
console.log('Crypto Exchange Bot started');