const { Telegraf, Markup } = require('telegraf');

// Кастомная реализация кэша вместо node-cache
const cache = {
  _store: new Map(),
  _timeouts: new Map(),
  set(key, value, ttl = 3600) {
    if (this._timeouts.has(key)) {
      clearTimeout(this._timeouts.get(key));
      this._timeouts.delete(key);
    }
    this._store.set(key, value);
    const timeout = setTimeout(() => {
      this._store.delete(key);
      this._timeouts.delete(key);
    }, ttl * 1000);
    this._timeouts.set(key, timeout);
  },
  get(key) {
    return this._store.get(key);
  }
};

// Конфигурация
const CONFIG = {
  ADMIN_ID: @perepytali, // Замените на ваш Telegram ID
  MIN_AMOUNT_USD: 10,
  ORDER_EXPIRY_MINUTES: 60,
  RATES_UPDATE_INTERVAL: 30,
  SESSION_TIMEOUT: 600000,
  COMMISSION_PERCENT: 1,
};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

const userSessions = {};

// Данные криптовалют
const cryptoData = {
  BTC: { 
    name: "Bitcoin", 
    wallet: "bc1qre7z0r3jpkaqtcr3wv5lvvy78u578xkmap9r7l", 
    min: 0.001,
    decimals: 8,
    explorer: txid => `https://blockchair.com/bitcoin/transaction/${txid}`
  },
  ETH: { 
    name: "Ethereum", 
    wallet: "0xCcd1e4947C45B1c22c46d59F16D34be4441377B8", 
    min: 0.01,
    decimals: 18,
    explorer: txid => `https://etherscan.io/tx/${txid}`
  },
  USDT: { 
    name: "Tether", 
    wallet: "0xCcd1e4947C45B1c22c46d59F16D34be4441377B8", 
    min: 10,
    decimals: 6,
    explorer: txid => `https://etherscan.io/tx/${txid}`
  },
  LTC: { 
    name: "Litecoin", 
    wallet: "ltc1qjhaut8kw9e450s6k9fa82seqykg4xcu0zfqxc8", 
    min: 0.1,
    decimals: 8,
    explorer: txid => `https://blockchair.com/litecoin/transaction/${txid}`
  }
};

// Курсы обмена
let exchangeRates = {
  BTC_USDT: 106368,
  ETH_USDT: 2575.78,
  LTC_USDT: 86.83,
  BTC_ETH: 41.3,
  ETH_BTC: 0.024213,
  LTC_BTC: 0.000816,
  BTC_LTC: 1226.11,
  ETH_LTC: 29.69
};

// Инициализация сессий
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();
  
  if (!userSessions[userId]) {
    userSessions[userId] = {
      data: { userId },
      timer: setTimeout(() => delete userSessions[userId], CONFIG.SESSION_TIMEOUT)
    };
  }
  
  clearTimeout(userSessions[userId].timer);
  userSessions[userId].timer = setTimeout(() => {
    delete userSessions[userId];
  }, CONFIG.SESSION_TIMEOUT);
  
  ctx.session = userSessions[userId].data;
  return next();
});

// Команда /start
bot.command('start', (ctx) => {
  const welcomeMessage = `🚀 Добро пожаловать в *Crypto Exchange Bot*!
  
📊 *Текущие курсы:*
1 BTC = ${exchangeRates.BTC_USDT} USDT
1 ETH = ${exchangeRates.ETH_USDT} USDT
1 LTC = ${exchangeRates.LTC_USDT} USDT

💱 Чтобы начать обмен, используйте /exchange
📝 Чтобы зарегистрировать кошелек: /register
🆘 Помощь: /help`;

  ctx.replyWithMarkdown(welcomeMessage);
});

// Регистрация кошелька
bot.command('register', (ctx) => {
  ctx.session.step = 'register_wallet';
  ctx.reply('📝 Введите адрес вашего криптокошелька для получения средств:');
});

// Просмотр кошелька
bot.command('wallet', (ctx) => {
  const address = ctx.session.walletAddress || cache.get(`user_${ctx.from.id}`);
  if (address) {
    ctx.replyWithMarkdown(`💼 Ваш кошелек:\n\`${address}\``);
  } else {
    ctx.reply('ℹ️ У вас нет зарегистрированного кошелька. Используйте /register');
  }
});

// Обмен валюты
bot.command('exchange', (ctx) => {
  if (!ctx.session.walletAddress && !cache.get(`user_${ctx.from.id}`)) {
    return ctx.reply('⚠️ Сначала зарегистрируйте кошелек командой /register');
  }
  ctx.session.step = 'select_pair';
  showExchangeMenu(ctx);
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
    ]
  ]));
}

// Обработка выбора пары
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
  const text = ctx.message.text.trim();
  
  if (text.startsWith('/')) return;
  
  // Регистрация кошелька
  if (ctx.session.step === 'register_wallet') {
    cache.set(`user_${ctx.from.id}`, text);
    ctx.session.walletAddress = text;
    return ctx.replyWithMarkdown(`✅ Кошелек зарегистрирован:\n\`${text}\`\n\nТеперь вы можете использовать /exchange`);
  }
  
  // Ввод суммы
  if (ctx.session.step === 'enter_amount') {
    return handleAmountInput(ctx);
  }
  
  // Ввод TXID
  if (ctx.session.step === 'confirm_txid') {
    return handleTxidInput(ctx);
  }
  
  ctx.reply('ℹ️ Для начала обмена используйте /exchange');
});

// Обработка суммы
async function handleAmountInput(ctx) {
  const amount = parseFloat(ctx.message.text.replace(',', '.'));
  
  if (isNaN(amount)) {
    return ctx.reply('⚠️ Пожалуйста, введите число. Например: 0.5 или 100');
  }
  
  const { from, to } = ctx.session;
  const minAmount = cryptoData[from]?.min || 0;
  
  if (amount < minAmount) {
    return ctx.reply(`⚠️ Минимальная сумма: ${minAmount} ${from}`);
  }
  
  const pair = `${from}_${to}`;
  if (!exchangeRates[pair]) {
    return ctx.reply('❌ Курс для этой пары не доступен');
  }
  
  const commission = amount * (CONFIG.COMMISSION_PERCENT / 100);
  const netAmount = amount - commission;
  const rate = exchangeRates[pair];
  const result = (netAmount * rate).toFixed(8);
  
  ctx.session.order = {
    amount,
    netAmount,
    commission,
    from,
    to,
    rate,
    result,
    timestamp: Date.now()
  };
  
  const fromCurrency = cryptoData[from];
  
  ctx.replyWithMarkdown(`✅ *Детали обмена:*
  
➡️ Отправляете: *${formatCrypto(amount, from)} ${from}*
➖ Комиссия (${CONFIG.COMMISSION_PERCENT}%): *${formatCrypto(commission, from)} ${from}*
🔄 К обмену: *${formatCrypto(netAmount, from)} ${from}*
⬅️ Получаете: *${formatCrypto(result, to)} ${to}*
📊 Курс: 1 ${from} = ${rate} ${to}

💳 *Для завершения:*
1. Переведите ${formatCrypto(amount, from)} ${from} на:
\`${fromCurrency.wallet}\`

2. Отправьте TXID транзакции`);

  ctx.session.step = 'confirm_txid';
}

// Обработка TXID
async function handleTxidInput(ctx) {
  const txid = ctx.message.text.trim();
  const { order } = ctx.session;
  
  if (!order) {
    return ctx.reply('❌ Ордер не найден. Начните заново /exchange');
  }
  
  if (txid.length < 10) {
    return ctx.reply('⚠️ Неверный формат TXID. Введите корректный хэш транзакции:');
  }
  
  const address = ctx.session.walletAddress || cache.get(`user_${ctx.from.id}`);
  
  ctx.replyWithMarkdown(`📬 *Запрос на обмен принят!*
  
TXID: \`${txid}\`
Сумма: ${formatCrypto(order.amount, order.from)} ${order.from}
К получению: ${formatCrypto(order.result, order.to)} ${order.to}
Адрес: \`${address}\`

✅ Ваша заявка принята в обработку. Средства будут зачислены в течение 1-24 часов.

🔗 Проверить транзакцию: [Block Explorer](${cryptoData[order.from]?.explorer(txid) || '#'})`);

  clearUserSession(ctx);
}

// Вспомогательные функции
function formatCrypto(value, currency) {
  const num = parseFloat(value);
  const decimals = cryptoData[currency]?.decimals || 8;
  return num.toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
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

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ 
        status: 'active',
        service: 'Crypto Exchange Bot',
        version: '3.1'
      });
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

console.log('Bot started');