const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const NodeCache = require('node-cache');
const Web3 = require('web3');
const { ethers } = require('ethers');
const { generateMnemonic, mnemonicToSeedSync } = require('bip39');
const { hdkey } = require('ethereumjs-wallet');

// Конфигурация
const CONFIG = {
  ADMIN_ID: 123456789, // Ваш Telegram ID
  MIN_AMOUNT_USD: 10,
  ORDER_EXPIRY_MINUTES: 60,
  RATES_UPDATE_INTERVAL: 30,
  SESSION_TIMEOUT: 600000,
  COMMISSION_PERCENT: 1, // Комиссия сервиса
  HOT_WALLET_MNEMONIC: process.env.HOT_WALLET_MNEMONIC || generateMnemonic(),
};

// Фикс для вебхуков
process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

// Кэш для хранения данных
const cache = new NodeCache({ stdTTL: 3600 });
const userSessions = {};

// Инициализация Web3
const web3 = new Web3(process.env.INFURA_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY');
const provider = new ethers.providers.JsonRpcProvider(process.env.INFURA_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY');

// Генерация горячего кошелька
function getHotWallet() {
  const seed = mnemonicToSeedSync(CONFIG.HOT_WALLET_MNEMONIC);
  const hdWallet = hdkey.fromMasterSeed(seed);
  const wallet = hdWallet.derivePath("m/44'/60'/0'/0/0").getWallet();
  return {
    address: wallet.getAddressString(),
    privateKey: wallet.getPrivateKey().toString('hex')
  };
}

const HOT_WALLET = getHotWallet();

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
    wallet: HOT_WALLET.address, 
    min: 0.01,
    decimals: 18,
    explorer: txid => `https://etherscan.io/tx/${txid}`
  },
  USDT: { 
    name: "Tether", 
    wallet: HOT_WALLET.address, 
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
  },
  BNB: { 
    name: "Binance Coin", 
    wallet: HOT_WALLET.address, 
    min: 0.1,
    decimals: 18,
    explorer: txid => `https://bscscan.com/tx/${txid}`
  },
  XRP: { 
    name: "Ripple", 
    wallet: "rM73La2rNE3SP6WbTvAuxGUmUsGN4YjJET", 
    min: 10,
    decimals: 6,
    explorer: txid => `https://xrpscan.com/tx/${txid}`
  },
};

// Курсы обмена
let exchangeRates = {
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

// Регистрация пользователя
async function registerUser(ctx, address) {
  const userId = ctx.from.id;
  cache.set(`user_${userId}`, { address });
  ctx.session.walletAddress = address;
  return `✅ Кошелек успешно зарегистрирован!\n\nВаш адрес: \`${address}\`\n\nТеперь вы можете совершать обмены.`;
}

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
📝 Чтобы зарегистрировать кошелек: /register
🆘 Помощь: /help`;

  ctx.replyWithMarkdown(welcomeMessage);
});

bot.command('register', (ctx) => {
  ctx.session.step = 'register_wallet';
  ctx.reply('📝 Введите адрес вашего криптокошелька для получения средств:');
});

bot.command('wallet', (ctx) => {
  const address = ctx.session.walletAddress;
  if (address) {
    ctx.replyWithMarkdown(`💼 Ваш зарегистрированный кошелек:\n\`${address}\``);
  } else {
    ctx.reply('ℹ️ У вас нет зарегистрированного кошелька. Используйте /register');
  }
});

bot.command('rates', (ctx) => {
  const ratesMessage = `📈 *Актуальные курсы:*
${Object.entries(cryptoData)
  .filter(([symbol]) => exchangeRates[`${symbol}_USDT`])
  .map(([symbol, data]) => `1 ${symbol} = ${exchangeRates[`${symbol}_USDT`]} USDT`)
  .join('\n')}`;

  ctx.replyWithMarkdown(ratesMessage);
});

bot.command('exchange', (ctx) => {
  if (!ctx.session.walletAddress) {
    return ctx.reply('⚠️ Сначала зарегистрируйте кошелек командой /register');
  }
  ctx.session.step = 'select_pair';
  showExchangeMenu(ctx);
});

bot.command('admin_update', (ctx) => {
  if (ctx.from.id !== CONFIG.ADMIN_ID) {
    return ctx.reply('⚠️ Команда доступна только администратору');
  }
  
  const args = ctx.message.text.split(' ');
  args.shift();
  
  if (args.length === 0) {
    return ctx.reply('Использование: /admin_update BTC_USDT=65000 ETH_USDT=3500');
  }
  
  let updated = 0;
  args.forEach(arg => {
    const [pair, value] = arg.split('=');
    if (pair && value) {
      const rate = parseFloat(value);
      if (!isNaN(rate)) {
        exchangeRates[pair.toUpperCase()] = rate;
        updated++;
      }
    }
  });
  
  ctx.reply(`✅ Обновлено ${updated} курсов`);
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
      Markup.button.callback('Другие пары', 'more_pairs')
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
  const text = ctx.message.text.trim();
  
  if (text.startsWith('/')) return;
  
  if (ctx.session.step === 'register_wallet') {
    const address = text;
    const message = await registerUser(ctx, address);
    return ctx.replyWithMarkdown(message);
  }
  
  if (ctx.session.step === 'enter_amount') {
    return handleAmountInput(ctx);
  }
  
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
  
  // Рассчет суммы с учетом комиссии
  const commission = amount * (CONFIG.COMMISSION_PERCENT / 100);
  const netAmount = amount - commission;
  const rate = exchangeRates[pair];
  const result = (netAmount * rate).toFixed(8);
  
  // Сохранение данных
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
  
  // Получаем данные по валютам
  const fromCurrency = cryptoData[from] || { name: from };
  
  // Форматирование
  const formattedAmount = formatCrypto(amount, from);
  const formattedResult = formatCrypto(result, to);
  
  // Отправляем результат
  ctx.replyWithMarkdown(`✅ *Детали обмена:*
  
➡️ Отправляете: *${formattedAmount} ${from}*
➖ Комиссия сервиса (${CONFIG.COMMISSION_PERCENT}%): *${formatCrypto(commission, from)} ${from}*
🔄 К обмену: *${formatCrypto(netAmount, from)} ${from}*
⬅️ Получаете: *${formattedResult} ${to}*
📊 Курс: 1 ${from} = ${rate} ${to}

💳 *Для завершения операции:*
1. Переведите ${formattedAmount} ${from} на адрес:
\`${fromCurrency.wallet}\`

2. После отправки средств пришлите TXID (хэш транзакции) для подтверждения

⏱️ Ордер будет активен ${CONFIG.ORDER_EXPIRY_MINUTES} минут`);

  ctx.session.step = 'confirm_txid';
}

// Автоматическая отправка средств
async function sendCrypto(to, amount, currency) {
  // В реальном приложении здесь будет интеграция с API кошелька
  console.log(`Отправка ${amount} ${currency} на адрес ${to}`);
  
  // Имитация транзакции
  const txid = '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  
  return {
    success: true,
    txid,
    amount,
    currency,
    to
  };
}

// Обработка TXID
async function handleTxidInput(ctx) {
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
  
  // Проверка формата TXID
  if (!txid || txid.length < 10) {
    return ctx.reply('⚠️ Неверный формат TXID. Пожалуйста, введите корректный хэш транзакции:');
  }
  
  // Имитация проверки транзакции
  ctx.reply('🔍 Проверяем вашу транзакцию...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Автоматическая отправка средств пользователю
  ctx.reply('🔄 Отправляем ваши средства...');
  const sendResult = await sendCrypto(
    ctx.session.walletAddress,
    order.result,
    order.to
  );
  
  if (!sendResult.success) {
    return ctx.reply('❌ Ошибка при отправке средств. Свяжитесь с поддержкой.');
  }
  
  const formattedAmount = formatCrypto(order.result, order.to);
  
  ctx.replyWithMarkdown(`✅ *Обмен успешно завершен!*
  
➡️ Вы отправили: *${formatCrypto(order.amount, order.from)} ${order.from}*
⬅️ Вы получили: *${formattedAmount} ${order.to}*
💸 Комиссия сервиса: *${formatCrypto(order.commission, order.from)} ${order.from}*

📬 Средства отправлены на ваш кошелек:
\`${ctx.session.walletAddress}\`

🔗 Транзакция отправки: [${sendResult.txid}](${cryptoData[order.to]?.explorer(sendResult.txid) || '#'})
⏱️ Дата: ${new Date().toLocaleString()}

Спасибо за использование нашего сервиса!`);

  // Очистка сессии
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
        version: '3.0',
        hot_wallet: HOT_WALLET.address,
        currencies: Object.keys(cryptoData)
      });
    }
  } catch (err) {
    console.error('Global error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

console.log('Crypto Exchange Bot started');
console.log('Hot wallet address:', HOT_WALLET.address);