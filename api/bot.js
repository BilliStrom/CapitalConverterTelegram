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

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Команда /start - начальная точка
bot.command('start', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await redisHelpers.getUser(userId);
    
    if (!user) {
      // Создаем нового пользователя
      user = {
        id: userId,
        username: ctx.from.username || '',
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        ageVerified: false,
        termsAccepted: false,
        gender: null,
        searches: 0,
        premium: false,
        createdAt: new Date().toISOString()
      };
      
      await redisHelpers.setUser(userId, user);
      
      // Запрос подтверждения возраста
      await ctx.reply(
        '👋 Добро пожаловать в анонимный чат!\n\nДля использования бота вам должно быть больше 18 лет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    } else if (!user.ageVerified) {
      // Пользователь существует, но не подтвердил возраст
      await ctx.reply(
        'Для использования бота вам должно быть больше 18 лет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    } else if (!user.termsAccepted) {
      // Возраст подтвержден, но не приняты правила
      await ctx.reply(
        `📜 Пожалуйста, ознакомьтесь с нашими правилами:\n\n` +
        `1. Запрещены оскорбления и угрозы\n` +
        `2. Запрещен спам и реклама\n` +
        `3. Запрещен контент для взрослых\n` +
        `4. Уважайте других пользователей\n\n` +
        `Полные правила: ${CONFIG.TERMS_URL}\n` +
        `Политика конфиденциальности: ${CONFIG.PRIVACY_URL}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принимаю правила', 'terms_accept')],
          [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
        ])
      );
    } else if (!user.gender) {
      // Правила приняты, но не указан пол
      await ctx.reply(
        'Выберите ваш пол:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨 Мужской', 'gender_male')],
          [Markup.button.callback('👩 Женский', 'gender_female')]
        ])
      );
    } else {
      // Все данные есть, показываем главное меню
      await ctx.reply(
        'Главное меню:',
        getMainMenu()
      );
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработка подтверждения возраста
bot.action('age_confirm_yes', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.ageVerified = true;
      await redisHelpers.setUser(userId, user);
      
      // Запрашиваем принятие правил
      await ctx.editMessageText(
        `📜 Пожалуйста, ознакомьтесь с нашими правилами:\n\n` +
        `1. Запрещены оскорбления и угрозы\n` +
        `2. Запрещен спам и реклама\n` +
        `3. Запрещен контент для взрослых\n` +
        `4. Уважайте других пользователей\n\n` +
        `Полные правила: ${CONFIG.TERMS_URL}\n` +
        `Политика конфиденциальности: ${CONFIG.PRIVACY_URL}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Принимаю правила', callback_data: 'terms_accept' }],
              [{ text: '❌ Не принимаю', callback_data: 'terms_decline' }]
            ]
          }
        }
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
    await ctx.editMessageText('❌ Извините, этот сервис предназначен только для совершеннолетних пользователей.');
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
      user.termsAccepted = true;
      await redisHelpers.setUser(userId, user);
      
      // Запрашиваем пол
      await ctx.editMessageText(
        'Выберите ваш пол:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👨 Мужской', callback_data: 'gender_male' }],
              [{ text: '👩 Женский', callback_data: 'gender_female' }]
            ]
          }
        }
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
    await ctx.editMessageText('❌ Для использования сервиса необходимо принять правила. Если передумаете - запустите бота снова командой /start');
  } catch (error) {
    console.error('Error in terms rejection:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

// Обработка выбора пола
bot.action(/^gender_(male|female)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const gender = ctx.match[1];
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.gender = gender;
      await redisHelpers.setUser(userId, user);
      
      // Показываем главное меню
      await ctx.editMessageText(
        'Отлично! Теперь вы можете использовать все функции бота.',
        getMainMenu()
      );
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

    if (!user || !user.ageVerified || !user.termsAccepted || !user.gender) {
      // Если пользователь не завершил регистрацию, отправляем на /start
      return ctx.reply('Пожалуйста, завершите регистрацию:', Markup.inlineKeyboard([
        [Markup.button.callback('Начать регистрацию', 'start_registration')]
      ]));
    }

    // Обработка команд главного меню
    switch (text) {
      case '🔍 Найти собеседника':
        await ctx.reply('🔍 Поиск собеседника...');
        // Здесь будет логика поиска
        break;
      case '🚻 Мой профиль':
        const profileText = `👤 Ваш профиль:\n\n` +
          `Имя: ${user.first_name} ${user.last_name}\n` +
          `Username: @${user.username || 'не указан'}\n` +
          `Пол: ${user.gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n` +
          `Поисков сегодня: ${user.searches}/${CONFIG.FREE_SEARCH_LIMIT}\n` +
          `Статус: ${user.premium ? '💎 Премиум' : '🔓 Обычный'}`;
        await ctx.reply(profileText);
        break;
      case '💎 Премиум подписка':
        await ctx.reply(
          `💎 Премиум подписка:\n\n` +
          `• Неограниченное количество поисков\n` +
          `• Приоритет в поиске собеседников\n` +
          `• Доступ к расширенной статистике\n\n` +
          `Стоимость: ${CONFIG.PREMIUM_COST} руб.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('💳 Купить подписку', 'buy_premium')]
          ])
        );
        break;
      case '📞 Поддержка':
        await ctx.reply(`📞 По всем вопросам обращайтесь в поддержку: ${CONFIG.SUPPORT_URL}`);
        break;
      case '📜 Правила':
        await ctx.reply(
          `📜 Правила использования:\n\n` +
          `1. Запрещены оскорбления и угрозы\n` +
          `2. Запрещен спам и реклама\n` +
          `3. Запрещен контент для взрослых\n` +
          `4. Уважайте других пользователей\n\n` +
          `Полные правила: ${CONFIG.TERMS_URL}`
        );
        break;
      case '❌ Выход':
        await ctx.reply(
          'Вы уверены, что хотите выйти?',
          Markup.keyboard([
            ['✅ Да, выйти', '❌ Нет, остаться']
          ]).resize()
        );
        break;
      default:
        await ctx.reply('Используйте меню для навигации:', getMainMenu());
    }
  } catch (error) {
    console.error('Error in text processing:', error);
    await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработчик для кнопки начала регистрации
bot.action('start_registration', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await ctx.reply(
      'Для использования бота вам должно быть больше 18 лет.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
        [Markup.button.callback('❌ Нет', 'age_confirm_no')]
      ])
    );
  } catch (error) {
    console.error('Error in start registration:', error);
    await ctx.answerCbQuery('❌ Произошла ошибка');
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
