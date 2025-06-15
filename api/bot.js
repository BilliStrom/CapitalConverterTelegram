const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Фиксированные курсы (можно заменить на API)
const rates = {
  BTC_USD: 63000,
  ETH_USD: 3500,
  USDC_USD: 1,
  BTC_ETH: 0.055,
  ETH_BTC: 18.18
};

bot.start(ctx => ctx.reply(
  `🪙 Добро пожаловать в CryptoExchangeBot!\n` +
  `Используйте команды:\n` +
  `/rates - текущие курсы\n` +
  `/exchange - обмен криптовалюты`
));

bot.command('rates', ctx => {
  ctx.reply(`📊 Текущие курсы:
1 BTC = $${rates.BTC_USD}
1 ETH = $${rates.ETH_USD}
1 USDC = $${rates.USDC_USD}
1 BTC = ${rates.BTC_ETH} ETH`);
});

bot.command('exchange', ctx => {
  ctx.reply('🔁 Выберите пару для обмена:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'BTC → USDC', callback_data: 'pair_BTC_USDC' },
          { text: 'ETH → BTC', callback_data: 'pair_ETH_BTC' }
        ],
        [
          { text: 'USDC → ETH', callback_data: 'pair_USDC_ETH' },
          { text: 'ETH → USDC', callback_data: 'pair_ETH_USDC' }
        ]
      ]
    }
  });
});

// Обработка выбора пары
bot.action(/^pair_(\w+)_(\w+)$/, async (ctx) => {
  const [, from, to] = ctx.match;
  ctx.deleteMessage();
  
  // Сохраняем выбор пользователя
  ctx.session = { from, to };
  
  ctx.reply(`💱 Вы выбрали: ${from} → ${to}\nВведите сумму ${from} для обмена:`);
});

// Обработка суммы
bot.on('text', async (ctx) => {
  if (!ctx.session?.from) return;
  
  const amount = parseFloat(ctx.message.text);
  if (isNaN(amount) {
    return ctx.reply('⚠️ Введите число! Например: 0.5');
  }
  
  const { from, to } = ctx.session;
  const pair = `${from}_${to}`;
  
  // Проверяем наличие курса
  if (!rates[pair]) {
    return ctx.reply('❌ Курс для этой пары не найден');
  }
  
  const result = (amount * rates[pair]).toFixed(6);
  
  ctx.reply(`✅ Результат обмена:
${amount} ${from} = ${result} ${to}

📬 Для завершения переведите ${amount} ${from} на адрес:
${generateWallet(from)}

📩 После перевода отправьте TXID транзакции`);
  
  // Сбрасываем сессию
  ctx.session = null;
});

// Генерация кошелька
function generateWallet(currency) {
  const wallets = {
    BTC: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  };
  return wallets[currency] || 'Адрес временно недоступен';
}

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Bot error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
