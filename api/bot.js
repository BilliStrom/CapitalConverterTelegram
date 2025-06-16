const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Конфигурация
const CONFIG = {
  MIN_AMOUNT_USD: 10, // Минимальная сумма в долларовом эквиваленте
  ORDER_EXPIRY_MINUTES: 60, // Время жизни ордера
  RATES_UPDATE_INTERVAL: 30, // Интервал обновления курсов (минуты)
  SESSION_TIMEOUT: 600000, // 10 минут бездействия
};

// Фикс для вебхуков
process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

// Хранилище сессий и данных
const userSessions = {};
let exchangeRates = {};
let lastRatesUpdate = 0;

// Инициализация сессий с таймаутом
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();
  
  if (!userSessions[userId]) {
    userSessions[userId] = {
      data: {},
      timer: setTimeout(() => {
        delete userSessions[userId];
        console.log(`Сессия для ${userId} очищена по таймауту`);
      }, CONFIG.SESSION_TIMEOUT)
    };
  }
  
  // Сброс таймера при активности
  clearTimeout(userSessions[userId].timer);
  userSessions[userId].timer = setTimeout(() => {
    delete userSessions[userId];
    console.log(`Сессия для ${userId} очищена по таймауту`);
  }, CONFIG.SESSION_TIMEOUT);
  
  ctx.session = userSessions[userId].data;
  return next();
});

// Данные криптовалют
const cryptoData = {
  BTC: { name: "Bitcoin", wallet: "bc1qre7z0r3jpkaqtcr3wv5lvvy78u578xkmap9r7l", min: 0.001 },
  ETH: { name: "Ethereum", wallet: "0xCcd1e4947C45B1c22c46d59F16D34be4441377B8", min: 0.01 },
  USDT: { name: "Tether", wallet: "0xCcd1e4947C45B1c22c46d59F16D34be4441377B8", min: 10 },
  LTC: { name: "Litecoin", wallet: "ltc1qjhaut8kw9e450s6k9fa82seqykg4xcu0zfqxc8", min: 0.1 },
  BNB: { name: "Binance Coin", wallet: "0xCcd1e4947C45B1c22c46d59F16D34be4441377B8", min: 0.1 },
  XRP: { name: "Ripple", wallet: "rM73La2rNE3SP6WbTvAuxGUmUsGN4YjJET", min: 10 },
};

// Инициализация курсов
const initExchangeRates = async () => {
  try {
    // Здесь можно добавить реальное API, например:
    // const response = await axios.get('https://api.binance.com/api/v3/ticker/price');
    exchangeRates = {
      BTC_USDT: 106368,
      ETH_USDT: 2575.78,
      LTC_USDT: 86.83,
      BTC_ETH:  41.3,
      ETH_BTC: 0.024213,
      LTC_BTC: 0.000816,
      BTC_LTC: 1226.11,
      ETH_LTC: 29.69,
      BNB_USDT: 652.92,
      XRP_USDT: 2.18,
      BTC_BNB: 163.02,
      ETH_BNB: 3.95,
    };
    lastRatesUpdate = Date.now();
    console.log('Курсы обновлены');
  } catch (error) {
    console.error('Ошибка обновления курсов:', error);
  }
};

// Команды
bot.command('start', (ctx) => {
  const welcomeMessage = `🚀 Добро пожаловать в *Crypto Exchange Bot*!
  
Я помогу вам обменять криптовалюты по выгодному курсу. 

📊 *Текущие курсы:*
${Object.entries(cryptoData)
  .filter(([symbol]) => exchangeRates[`${symbol}_USDT`])
  .map(([symbol, data]) => `1 ${symbol} = ${exchangeRates[`${symbol}_USDT`]} USDT`)
  .join('\n')}

💱 Чтобы начать обмен, используйте /exchange
🆘 Помощь: /help`;

  ctx.replyWithMarkdown(welcomeMessage);
});

bot.command('rates', (ctx) => {
  const ratesMessage = `📈 *Актуальные курсы:*
${Object.entries(cryptoData)
  .filter(([symbol]) => exchangeRates[`${symbol}_USDT`])
  .map(([symbol, data]) => `1 ${symbol} = ${exchangeRates[`${symbol}_USDT`]} USDT`)
  .join('\n')}\n\n*Обновлено:* ${new Date(lastRatesUpdate).toLocaleTimeString()}`;

  ctx.replyWithMarkdown(ratesMessage);
});

bot.command('exchange', (ctx) => {
  ctx.session.step = 'select_pair';
  showExchangeMenu(ctx);
});

bot.command('cancel', (ctx) => {
  if (ctx.session.step && ctx.session.step !== 'idle') {
    clearUserSession(ctx);
    ctx.reply('❌ Текущая операция отменена');
  } else {
    ctx.reply('⚠️ Нет активных операций для отмены');
  }
});

bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(`
❓ *Помощь по боту:*
  
💱 *Обмен валют:*
1. Используйте /exchange
2. Выберите пару для обмена
3. Введите сумму
4. Переведите средства на указанный адрес
5. Пришлите TXID транзакции

📊 *Курсы валют:*
- Обновляются каждые ${CONFIG.RATES_UPDATE_INTERVAL} минут
- Для просмотра используйте /rates

⏱️ *Время операций:*
- Крипто: 10-60 минут
- Поддержка: 24/7
- Ордер активен: ${CONFIG.ORDER_EXPIRY_MINUTES} минут

⚠️ *Важно:*
- Минимальная сумма: ${CONFIG.MIN_AMOUNT_USD} USD эквивалент
- Комиссии сети оплачивает отправитель
- Адреса проверяйте через сканер QR-кода

🆘 *Команды:*
/exchange - начать обмен
/rates - текущие курсы
/cancel - отменить операцию
/help - помощь`);
});

// Меню обмена
function showExchangeMenu(ctx) {
  ctx.reply('🔄 Выберите направление обмена:', Markup.inlineKeyboard([
    [
      Markup.button.callback('BTC → USDT', 'pair_BTC_USDT'),
      Markup.button.callback('ETH → BTC', 'pair_ETH_BTC'),
    ],
    [
      Markup.button.callback('USDT → ETH', 'pair_USDT_ETH'),
      Markup.button.callback('LTC → BTC', 'pair_LTC_BTC'),
    ],
    [
      Markup.button.callback('Другие пары', 'more_pairs'),
      Markup.button.callback('Настройки', 'settings'),
    ]
  ]));
}

// Обработка кнопок
bot.action('more_pairs', (ctx) => {
  ctx.editMessageText('🔀 Дополнительные пары:', Markup.inlineKeyboard([
    [
      Markup.button.callback('ETH → USDT', 'pair_ETH_USDT'),
      Markup.button.callback('BNB → BTC', 'pair_BNB_BTC'),
    ],
    [
      Markup.button.callback('XRP → ETH', 'pair_XRP_ETH'),
      Markup.button.callback('BTC → BNB', 'pair_BTC_BNB'),
    ],
    [Markup.button.callback('← Назад', 'back_to_main')]
  ]));
});

bot.action('back_to_main', (ctx) => {
  ctx.session.step = 'select_pair';
  showExchangeMenu(ctx);
});

bot.action(/^pair_(\w+)_(\w+)$/, async (ctx) => {
  const [, from, to] = ctx.match;
  
  ctx.session.step = 'enter_amount';
  ctx.session.from = from.toUpperCase();
  ctx.session.to = to.toUpperCase();
  
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  const minAmount = cryptoData[ctx.session.from]?.min || 0;
  ctx.reply(`💱 Вы выбрали: ${ctx.session.from} → ${ctx.session.to}\n\nВведите сумму ${ctx.session.from} для обмена${minAmount ? `\n(Минимум: ${minAmount} ${ctx.session.from})` : ''}:`);
});

// Обработка ввода
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  // Обработка суммы
  if (ctx.session.step === 'enter_amount') {
    return handleAmountInput(ctx);
  }
  
  // Обработка TXID
  if (ctx.session.step === 'confirm_txid') {
    return handleTxidInput(ctx);
  }
  
  ctx.reply('ℹ️ Для начала обмена используйте /exchange');
});

// Обработка ввода суммы
async function handleAmountInput(ctx) {
  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  
  if (isNaN(amount)) {
    return ctx.reply('⚠️ Пожалуйста, введите число. Например: 0.5 или 100');
  }
  
  const { from, to } = ctx.session;
  const minAmount = cryptoData[from]?.min || 0;
  
  // Проверка минимальной суммы
  if (amount < minAmount) {
    return ctx.reply(`⚠️ Минимальная сумма для обмена: ${minAmount} ${from}`);
  }
  
  // Проверка минималки в USD
  const usdRate = exchangeRates[`${from}_USDT`];
  if (usdRate && (amount * usdRate) < CONFIG.MIN_AMOUNT_USD) {
    return ctx.reply(`⚠️ Минимальная сумма для обмена: ${(CONFIG.MIN_AMOUNT_USD / usdRate).toFixed(8)} ${from} (${CONFIG.MIN_AMOUNT_USD} USD)`);
  }
  
  const pair = `${from}_${to}`;
  if (!exchangeRates[pair]) {
    return ctx.reply('❌ Курс для этой пары не доступен');
  }
  
  // Рассчет суммы
  const rate = exchangeRates[pair];
  const result = (amount * rate).toFixed(8);
  
  // Сохранение данных
  ctx.session.order = {
    amount,
    from,
    to,
    rate,
    result,
    timestamp: Date.now()
  };
  
  // Получаем данные по валютам
  const fromCurrency = cryptoData[from] || { name: from };
  
  // Форматирование
  const formattedAmount = formatCrypto(amount, from);
  const formattedResult = formatCrypto(result, to);
  
  // Отправляем результат
  ctx.replyWithMarkdown(`✅ *Детали обмена:*
  
➡️ Отправляете: *${formattedAmount} ${from}* (${fromCurrency.name})
⬅️ Получаете: *${formattedResult} ${to}*
📊 Курс: 1 ${from} = ${rate} ${to}

💳 *Для завершения операции:*
1. Переведите ${formattedAmount} ${from} на адрес:
\`${fromCurrency.wallet}\`

2. После отправки средств пришлите TXID (хэш транзакции) для подтверждения

⏱️ Ордер будет активен ${CONFIG.ORDER_EXPIRY_MINUTES} минут`);

  ctx.session.step = 'confirm_txid';
}

// Обработка TXID
function handleTxidInput(ctx) {
  const txid = ctx.message.text.trim();
  const { order } = ctx.session;
  
  if (!order) {
    return ctx.reply('❌ Информация об ордере потеряна. Начните заново /exchange');
  }
  
  // Проверка времени ордера
  const orderAge = (Date.now() - order.timestamp) / 60000;
  if (orderAge > CONFIG.ORDER_EXPIRY_MINUTES) {
    clearUserSession(ctx);
    return ctx.reply('❌ Время действия ордера истекло. Начните заново /exchange');
  }
  
  const formattedAmount = formatCrypto(order.amount, order.from);
  const formattedResult = formatCrypto(order.result, order.to);
  
  ctx.replyWithMarkdown(`📬 *Транзакция принята!*
  
TXID: \`${txid}\`
Сумма: ${formattedAmount} ${order.from}
К получению: ${formattedResult} ${order.to}

Ваша транзакция принята в обработку. Обычно это занимает 10-30 минут.

Вы можете отслеживать статус транзакции:
🔗 [Blockchain Explorer](${getExplorerLink(order.from, txid)})

Спасибо за использование нашего сервиса!`);

  // Очистка сессии
  clearUserSession(ctx);
}

// Вспомогательные функции
function formatCrypto(value, currency) {
  const num = parseFloat(value);
  return num.toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'BTC' ? 8 : 6
  });
}

function clearUserSession(ctx) {
  const userId = ctx.from?.id;
  if (userId && userSessions[userId]) {
    clearTimeout(userSessions[userId].timer);
    delete userSessions[userId];
  }
  ctx.session = {};
}

function getExplorerLink(currency, txid) {
  const explorers = {
    BTC: `https://blockchair.com/bitcoin/transaction/${txid}`,
    ETH: `https://etherscan.io/tx/${txid}`,
    USDT: `https://etherscan.io/tx/${txid}`,
    LTC: `https://blockchair.com/litecoin/transaction/${txid}`,
    BNB: `https://bscscan.com/tx/${txid}`,
    XRP: `https://xrpscan.com/tx/${txid}`,
  };
  return explorers[currency] || `https://blockchair.com/search?q=${txid}`;
}

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    // Периодическое обновление курсов
    if (Date.now() - lastRatesUpdate > CONFIG.RATES_UPDATE_INTERVAL * 60000) {
      await initExchangeRates();
    }
    
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ 
        status: 'active',
        service: 'Crypto Exchange Bot',
        version: '2.0',
        currencies: Object.keys(cryptoData),
        last_rates_update: new Date(lastRatesUpdate).toISOString()
      });
    }
  } catch (err) {
    console.error('Global error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Инициализация
(async () => {
  await initExchangeRates();
  console.log('Crypto Exchange Bot started');
})();