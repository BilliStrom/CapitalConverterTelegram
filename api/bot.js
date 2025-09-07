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
      const userData = JSON.stringify(data);
      await redis.set(`user:${userId}`, userData);
      return true;
    } catch (error) {
      console.error('Error setting user:', error);
      return false;
    }
  },

  getUser: async (userId) => {
    try {
      const data = await redis.get(`user:${userId}`);
      
      if (!data) return null;
      
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch (parseError) {
          console.error('Failed to parse user data, deleting corrupted data:', parseError);
          await redis.del(`user:${userId}`);
          return null;
        }
      } else if (typeof data === 'object' && data !== null) {
        return data;
      } else {
        console.error('Invalid user data format:', data);
        return null;
      }
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  },

  // Функции для управления очередью поиска
  addToSearchQueue: async (userId, userData) => {
    try {
      // Правильный формат для hset: ключ, поле, значение
      await redis.hset('search_queue', userId, JSON.stringify(userData));
      return true;
    } catch (error) {
      console.error('Error adding to search queue:', error);
      return false;
    }
  },

  removeFromSearchQueue: async (userId) => {
    try {
      await redis.hdel('search_queue', userId);
      return true;
    } catch (error) {
      console.error('Error removing from search queue:', error);
      return false;
    }
  },

  getSearchQueue: async () => {
    try {
      const queue = await redis.hgetall('search_queue');
      return queue || {};
    } catch (error) {
      console.error('Error getting search queue:', error);
      return {};
    }
  },

  // Функции для управления активными чатами
  setActiveChat: async (userId, partnerId) => {
    try {
      await redis.set(`chat:${userId}`, partnerId);
      return true;
    } catch (error) {
      console.error('Error setting active chat:', error);
      return false;
    }
  },

  getActiveChat: async (userId) => {
    try {
      return await redis.get(`chat:${userId}`);
    } catch (error) {
      console.error('Error getting active chat:', error);
      return null;
    }
  },

  removeActiveChat: async (userId) => {
    try {
      await redis.del(`chat:${userId}`);
      return true;
    } catch (error) {
      console.error('Error removing active chat:', error);
      return false;
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

// Функция для получения меню чата
function getChatMenu() {
  return Markup.keyboard([
    ['❌ Завершить диалог']
  ]).resize();
}

// Функция для поиска собеседника
async function findChatPartner(userId, userData) {
  try {
    // Добавляем пользователя в очередь поиска
    await redisHelpers.addToSearchQueue(userId, userData);
    
    // Получаем текущую очередь поиска
    const queue = await redisHelpers.getSearchQueue();
    
    // Ищем подходящего собеседника (исключая текущего пользователя)
    for (const [otherUserId, otherUserDataStr] of Object.entries(queue)) {
      if (otherUserId !== userId.toString()) {
        try {
          const otherUserData = JSON.parse(otherUserDataStr);
          
          // Проверяем, не ищет ли пользователь сам себя
          if (otherUserId !== userId.toString()) {
            // Создаем чат между пользователями
            await redisHelpers.setActiveChat(userId, otherUserId);
            await redisHelpers.setActiveChat(otherUserId, userId);
            
            // Удаляем обоих из очереди поиска
            await redisHelpers.removeFromSearchQueue(userId);
            await redisHelpers.removeFromSearchQueue(otherUserId);
            
            return otherUserId;
          }
        } catch (e) {
          console.error('Error parsing user data from queue:', e);
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in findChatPartner:', error);
    return null;
  }
}

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Добавим обработчик для всех callback-запросов
bot.on('callback_query', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    
    if (data === 'age_confirm_yes') {
      const user = await redisHelpers.getUser(userId);
      
      if (user) {
        user.ageVerified = true;
        await redisHelpers.setUser(userId, user);
        
        await ctx.editMessageText(
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
      }
    } else if (data === 'age_confirm_no') {
      await ctx.editMessageText('❌ Извините, этот сервис предназначен только для совершеннолетних пользователей.');
    } else if (data === 'terms_accept') {
      const user = await redisHelpers.getUser(userId);
      
      if (user) {
        user.termsAccepted = true;
        await redisHelpers.setUser(userId, user);
        
        await ctx.editMessageText(
          'Выберите ваш пол:',
          Markup.inlineKeyboard([
            [Markup.button.callback('👨 Мужской', 'gender_male')],
            [Markup.button.callback('👩 Женский', 'gender_female')]
          ])
        );
      }
    } else if (data === 'terms_decline') {
      await ctx.editMessageText('❌ Для использования сервиса необходимо принять правила. Если передумаете - запустите бота снова командой /start');
    } else if (data.startsWith('gender_')) {
      const gender = data.replace('gender_', '');
      const user = await redisHelpers.getUser(userId);
      
      if (user) {
        user.gender = gender;
        await redisHelpers.setUser(userId, user);
        
        await ctx.editMessageText(
          'Отлично! Теперь вы можете использовать все функции бота.',
          getMainMenu()
        );
      }
    } else if (data === 'start_registration') {
      await ctx.deleteMessage();
      await ctx.reply(
        'Для использования бота вам должно быть больше 18 лет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    }
  } catch (error) {
    console.error('Error in callback query handler:', error);
    try {
      await ctx.answerCbQuery('❌ Произошла ошибка');
    } catch (e) {
      console.error('Failed to answer callback query:', e);
    }
  }
});

// Команда /start - начальная точка
bot.command('start', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await redisHelpers.getUser(userId);
    
    if (!user) {
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
      
      await ctx.reply(
        '👋 Добро пожаловать в анонимный чат!\n\nДля использования бота вам должно быть больше 18 лет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    } else if (!user.ageVerified) {
      await ctx.reply(
        'Для использования бота вам должно быть больше 18 лет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    } else if (!user.termsAccepted) {
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
      await ctx.reply(
        'Выберите ваш пол:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨 Мужской', 'gender_male')],
          [Markup.button.callback('👩 Женский', 'gender_female')]
        ])
      );
    } else {
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

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const user = await redisHelpers.getUser(userId);

    // Проверяем, находится ли пользователь в активном чате
    const activeChat = await redisHelpers.getActiveChat(userId);
    
    if (activeChat) {
      // Если пользователь в активном чате, пересылаем сообщение собеседнику
      try {
        await ctx.telegram.sendMessage(activeChat, `💬: ${text}`, getChatMenu());
        await ctx.reply('✅ Сообщение отправлено', getChatMenu());
      } catch (error) {
        console.error('Error sending message to partner:', error);
        await ctx.reply('❌ Не удалось отправить сообщение. Возможно, собеседник отключился.', getMainMenu());
        await redisHelpers.removeActiveChat(userId);
      }
      return;
    }

    if (!user || !user.ageVerified || !user.termsAccepted || !user.gender) {
      return ctx.reply('Пожалуйста, завершите регистрацию:', Markup.inlineKeyboard([
        [Markup.button.callback('Начать регистрацию', 'start_registration')]
      ]));
    }

    // Обработка команд главного меню
    switch (text) {
      case '🔍 Найти собеседника':
        // Проверяем лимиты поиска
        if (user.searches >= CONFIG.FREE_SEARCH_LIMIT && !user.premium) {
          await ctx.reply(
            `❌ Вы исчерпали лимит бесплатных поисков (${CONFIG.FREE_SEARCH_LIMIT} в день).\n\nПриобретите премиум-подписку для неограниченного общения.`,
            Markup.inlineKeyboard([
              [Markup.button.callback('💎 Приобрести премиум', 'buy_premium')]
            ])
          );
          break;
        }
        
        await ctx.reply('🔍 Ищем собеседника...', getChatMenu());
        
        // Ищем собеседника
        const partnerId = await findChatPartner(userId, user);
        
        if (partnerId) {
          // Обновляем счетчик поисков
          user.searches += 1;
          await redisHelpers.setUser(userId, user);
          
          // Уведомляем обоих пользователей о соединении
          await ctx.reply('✅ Собеседник найден! Начинайте общение.', getChatMenu());
          await ctx.telegram.sendMessage(partnerId, '✅ Собеседник найден! Начинайте общение.', getChatMenu());
        } else {
          // Если собеседник не найден, оставляем в очереди и ждем
          setTimeout(async () => {
            const stillInQueue = await redisHelpers.getActiveChat(userId);
            if (!stillInQueue) {
              await ctx.reply('❌ Не удалось найти собеседника. Попробуйте позже.', getMainMenu());
              await redisHelpers.removeFromSearchQueue(userId);
            }
          }, CONFIG.SEARCH_TIMEOUT);
        }
        break;
        
      case '❌ Завершить диалог':
        const chatPartner = await redisHelpers.getActiveChat(userId);
        if (chatPartner) {
          await ctx.reply('Диалог завершен.', getMainMenu());
          await ctx.telegram.sendMessage(chatPartner, 'Собеседник завершил диалог.', getMainMenu());
          
          // Удаляем информацию о чате
          await redisHelpers.removeActiveChat(userId);
          await redisHelpers.removeActiveChat(chatPartner);
        } else {
          await ctx.reply('У вас нет активного диалога.', getMainMenu());
        }
        break;
        
      case '🚻 Мой профиль':
        const profileText = `👤 Ваш профиль:\n\n` +
          `Имя: ${user.first_name} ${user.last_name}\n` +
          `Username: @${user.username || 'не указан'}\n` +
          `Пол: ${user.gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n` +
          `Поисков сегодня: ${user.searches}/${CONFIG.FREE_SEARCH_LIMIT}\n` +
          `Статус: ${user.premium ? '💎 Премиум' : '🔓 Обычный'}`;
        await ctx.reply(profileText, getMainMenu());
        break;
        
      case '💎 Премиум подписка':
        await ctx.reply(
          `💎 Премиум подписка:\n\n` +
          `• Неограниченное количество поисков\n` +
          `• Приоритет в поиске собеседников\n` +
          `• Доступ к расширенной статистике\n\n` +
          `Стоимость: ${CONFIG.PREMIUM_COST} руб.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('💳 Купить подпику', 'buy_premium')]
          ])
        );
        break;
        
      case '📞 Поддержка':
        await ctx.reply(`📞 По всем вопросам обращайтесь в поддержку: ${CONFIG.SUPPORT_URL}`, getMainMenu());
        break;
        
      case '📜 Правила':
        await ctx.reply(
          `📜 Правила использования:\n\n` +
          `1. Запрещены оскорбления и угрозы\n` +
          `2. Запрещен спам и реклама\n` +
          `3. Запрещен контент для взрослых\n` +
          `4. Уважайте других пользователей\n\n` +
          `Полные правила: ${CONFIG.TERMS_URL}`,
          getMainMenu()
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
    await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.', getMainMenu());
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
