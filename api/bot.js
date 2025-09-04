const { Telegraf, Markup } = require('telegraf');
const { Redis } = require('@upstash/redis');

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Конфигурация
const CONFIG = {
  ADMIN_ID: process.env.ADMIN_ID || 5948326124,
  FREE_SEARCH_LIMIT: 3,
  PREMIUM_COST: 100,
  SESSION_TIMEOUT: 600000,
  CHAT_TIMEOUT: 1800000,
  SEARCH_TIMEOUT: 300000,
  TERMS_URL: 'https://yourwebsite.com/terms',
  PRIVACY_URL: 'https://yourwebsite.com/privacy',
  SUPPORT_URL: 'https://t.me/your_support'
};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Вспомогательные функции для работы с Redis
const redisHelpers = {
  setUser: async (userId, data) => {
    try {
      await redis.set(`user:${userId}`, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Error setting user:', error);
      return false;
    }
  },
  
  getUser: async (userId) => {
    try {
      const data = await redis.get(`user:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }
};

// Функция для получения главного меню
function getMainMenu() {
  return Markup.keyboard([
    ['🔍 Найти собеседника', '🚻 Мой профиль'],
    ['💎 Премиум подписка', '📞 Поддержка'],
    ['📜 Правила', '❌ Выход']
  ]).resize();
}

// Команда /start - начальная точка
bot.command('start', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    let user = await redisHelpers.getUser(userId);
    
    if (!user) {
      user = {
        id: userId,
        username: ctx.from.username || `user_${userId}`,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name || '',
        acceptedTerms: false,
        ageVerified: false,
        searchesLeft: CONFIG.FREE_SEARCH_LIMIT,
        premium: false,
        createdAt: new Date().toISOString()
      };
      
      await redisHelpers.setUser(userId, user);
    }
    
    if (!user.ageVerified) {
      await ctx.reply(
        `👋 Добро пожаловать в Анонимный Чат!\n\n` +
        `Для использования сервиса вам должно быть не менее 18 лет.\n\n` +
        `Подтверждаете, что вам есть 18 лет?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
      return;
    }
    
    if (!user.acceptedTerms) {
      await ctx.reply(
        `📋 Для продолжения необходимо принять наши правила.\n\n` +
        `Соглашаетесь с условиями?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принимаю', 'terms_accept')],
          [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
        ])
      );
      return;
    }
    
    if (!user.gender) {
      await ctx.reply(
        '🚻 Для начала выберите ваш пол:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨 Мужской', 'gender_male')],
          [Markup.button.callback('👩 Женский', 'gender_female')]
        ])
      );
      return;
    }
    
    const welcomeMessage = `✨ Добро пожаловать в Анонимный Чат!\n\n` +
      `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
      `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
      `Выберите действие:`;
    
    await ctx.reply(welcomeMessage, getMainMenu());
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработка подтверждения возраста
bot.action('age_confirm_yes', async (ctx) => {
  try {
    // Отвечаем на callback запрос
    await ctx.answerCbQuery();
    
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.ageVerified = true;
      await redisHelpers.setUser(userId, user);
      
      // Отправляем новое сообщение
      await ctx.reply(
        `📋 Для продолжения необходимо принять наши правила.\n\n` +
        `Соглашаетесь с условиями?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принимаю', 'terms_accept')],
          [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
        ])
      );
    }
  } catch (error) {
    console.error('Error in age confirmation:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

bot.action('age_confirm_no', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('❌ Извините, этот сервис предназначен только для совершеннолетних пользователей.');
  } catch (error) {
    console.error('Error in age rejection:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

// Обработка принятия правил
bot.action('terms_accept', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.acceptedTerms = true;
      await redisHelpers.setUser(userId, user);
      
      await ctx.reply(
        '🚻 Для начала выберите ваш пол:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨 Мужской', 'gender_male')],
          [Markup.button.callback('👩 Женский', 'gender_female')]
        ])
      );
    }
  } catch (error) {
    console.error('Error in terms acceptance:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

bot.action('terms_decline', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('❌ Для использования сервиса необходимо принять правила. Если передумаете - запустите бота снова командой /start');
  } catch (error) {
    console.error('Error in terms rejection:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

// Обработка выбора пола
bot.action(/^gender_(male|female)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const gender = ctx.match[1];
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.gender = gender;
      await redisHelpers.setUser(userId, user);
      
      const welcomeMessage = `✨ Добро пожаловать в Анонимный Чат!\n\n` +
        `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
        `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
        `Выберите действие:`;
      
      await ctx.reply(welcomeMessage, getMainMenu());
    }
  } catch (error) {
    console.error('Error in gender selection:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const user = await redisHelpers.getUser(userId);
    
    if (!user) {
      return ctx.reply('Пожалуйста, начните с команды /start');
    }
    
    switch (text) {
      case '🔍 Найти собеседника':
        await ctx.reply('🔍 Функция поиска временно недоступна. Мы работаем над её восстановлением.');
        break;
      case '🚻 Мой профиль':
        const profileText = `👤 Ваш профиль\n\n` +
          `Имя: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}\n` +
          `Пол: ${user.gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n` +
          `Статус: ${user.premium ? '💎 Премиум' : '🔓 Обычный'}\n` +
          `Поисков осталось: ${user.searchesLeft}\n` +
          `Дата регистрации: ${new Date(user.createdAt).toLocaleDateString('ru-RU')}`;
        
        await ctx.reply(profileText, getMainMenu());
        break;
      case '💎 Премиум подписка':
        await ctx.reply(
          `💎 Премиум-подписка - ${CONFIG.PREMIUM_COST} руб.\n\n` +
          `Для приобретения свяжитесь с администратором: @admin`
        );
        break;
      case '📞 Поддержка':
        await ctx.reply(`🆘 Поддержка\n\nПо всем вопросам обращайтесь: ${CONFIG.SUPPORT_URL}`);
        break;
      case '📜 Правила':
        await ctx.reply('📜 Правила использования:\n\n1. Быть вежливым\n2. Не спамить\n3. Уважать собеседников');
        break;
      case '❌ Выход':
        await ctx.reply('До свидания! Если захотите вернуться, используйте /start');
        break;
      default:
        await ctx.reply('Используйте кнопки меню для навигации', getMainMenu());
    }
  } catch (error) {
    console.error('Error in text processing:', error);
    await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработчик для Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ 
        status: 'active',
        service: 'Anonymous Chat Bot',
        version: '3.0'
      });
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

console.log('Anonymous Chat Bot started');