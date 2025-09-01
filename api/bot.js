const { Telegraf, Markup } = require('telegraf');
const { Redis } = require('@upstash/redis');

// Инициализация Redis
let redis;
try {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('Redis connected successfully');
} catch (error) {
  console.error('Redis connection error:', error);
  // Заглушка для Redis в случае ошибки подключения
  redis = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(),
    sadd: () => Promise.resolve(),
    srem: () => Promise.resolve(),
    smembers: () => Promise.resolve([]),
    sismember: () => Promise.resolve(0),
  };
}

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
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

// Состояния бота
const USER_STATE = {
  START: 'start',
  AGE_VERIFICATION: 'age_verification',
  TERMS_ACCEPTANCE: 'terms_acceptance',
  PROFILE_SETUP: 'profile_setup',
  MAIN_MENU: 'main_menu',
  SEARCHING: 'searching',
  IN_CHAT: 'in_chat'
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
  },
  
  addToQueue: async (userId, gender) => {
    try {
      await redis.sadd(`queue:${gender}`, userId.toString());
      await redis.set(`search_time:${userId}`, Date.now().toString());
      return true;
    } catch (error) {
      console.error('Error adding to queue:', error);
      return false;
    }
  },
  
  removeFromQueue: async (userId, gender) => {
    try {
      await redis.srem(`queue:${gender}`, userId.toString());
      await redis.del(`search_time:${userId}`);
      return true;
    } catch (error) {
      console.error('Error removing from queue:', error);
      return false;
    }
  },
  
  isInQueue: async (userId, gender) => {
    try {
      return await redis.sismember(`queue:${gender}`, userId.toString());
    } catch (error) {
      console.error('Error checking queue:', error);
      return false;
    }
  },
  
  getQueue: async (gender) => {
    try {
      return await redis.smembers(`queue:${gender}`);
    } catch (error) {
      console.error('Error getting queue:', error);
      return [];
    }
  },
  
  findPartner: async (gender, excludeUserId) => {
    try {
      const queue = await redis.smembers(`queue:${gender}`);
      for (const userId of queue) {
        if (userId !== excludeUserId.toString()) {
          return userId;
        }
      }
      return null;
    } catch (error) {
      console.error('Error finding partner:', error);
      return null;
    }
  },
  
  setActiveChat: async (userId, partnerId, chatId) => {
    try {
      await redis.set(`chat:${userId}`, JSON.stringify({
        partnerId,
        chatId,
        startedAt: Date.now()
      }));
      return true;
    } catch (error) {
      console.error('Error setting active chat:', error);
      return false;
    }
  },
  
  getActiveChat: async (userId) => {
    try {
      const data = await redis.get(`chat:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting active chat:', error);
      return null;
    }
  },
  
  removeActiveChat: async (userId) => {
    try {
      const chat = await redisHelpers.getActiveChat(userId);
      if (chat) {
        await redis.del(`chat:${userId}`);
        await redis.del(`chat:${chat.partnerId}`);
      }
      return chat;
    } catch (error) {
      console.error('Error removing active chat:', error);
      return null;
    }
  },
  
  removeFromAllQueues: async (userId) => {
    try {
      const genders = ['male', 'female', 'any'];
      for (const gender of genders) {
        await redisHelpers.removeFromQueue(userId, gender);
      }
      return true;
    } catch (error) {
      console.error('Error removing from all queues:', error);
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

// Команда /start - начальная точка
bot.command('start', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    let user = await redisHelpers.getUser(userId);
    
    if (!user) {
      user = {
        state: USER_STATE.AGE_VERIFICATION,
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
      user.state = USER_STATE.AGE_VERIFICATION;
      await redisHelpers.setUser(userId, user);
      
      return ctx.replyWithMarkdown(
        `👋 Добро пожаловать в *Анонимный Чат*!\n\n` +
        `Для использования сервиса вам должно быть *не менее 18 лет*.\n\n` +
        `Подтверждаете, что вам есть 18 лет?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, мне есть 18 лет', 'age_confirm_yes')],
          [Markup.button.callback('❌ Нет', 'age_confirm_no')]
        ])
      );
    }
    
    if (!user.acceptedTerms) {
      user.state = USER_STATE.TERMS_ACCEPTANCE;
      await redisHelpers.setUser(userId, user);
      
      return ctx.replyWithMarkdown(
        `📋 Для продолжения необходимо принять наши правила:\n\n` +
        `Соглашаетесь с условиями?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принимаю', 'terms_accept')],
          [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
        ])
      );
    }
    
    if (!user.gender) {
      user.state = USER_STATE.PROFILE_SETUP;
      await redisHelpers.setUser(userId, user);
      
      return ctx.reply(
        '🚻 Для начала выберите ваш пол:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨 Мужской', 'gender_male')],
          [Markup.button.callback('👩 Женский', 'gender_female')]
        ])
      );
    }
    
    user.state = USER_STATE.MAIN_MENU;
    await redisHelpers.setUser(userId, user);
    
    const welcomeMessage = `✨ Добро пожаловать в *Анонимный Чат*!\n\n` +
      `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
      `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
      `Выберите действие:`;
    
    ctx.replyWithMarkdown(welcomeMessage, getMainMenu());
  } catch (error) {
    console.error('Error in start command:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
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
      user.state = USER_STATE.TERMS_ACCEPTANCE;
      await redisHelpers.setUser(userId, user);
      
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.log('Не удалось удалить сообщение:', e.message);
      }
      
      await ctx.replyWithMarkdown(
        `📋 Для продолжения необходимо принять наши правила:\n\n` +
        `Соглашаетесь с условиями?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принимаю', 'terms_accept')],
          [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
        ])
      );
    }
  } catch (error) {
    console.error('Error in age confirmation:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

bot.action('age_confirm_no', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    await ctx.reply('❌ Извините, этот сервис предназначен только для совершеннолетних пользователей.');
  } catch (error) {
    console.error('Error in age rejection:', error);
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
      user.state = USER_STATE.PROFILE_SETUP;
      await redisHelpers.setUser(userId, user);
      
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.log('Не удалось удалить сообщение:', e.message);
      }
      
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
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

bot.action('terms_decline', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    await ctx.reply('❌ Для использования сервиса необходимо принять правила. Если передумаете - запустите бота снова командой /start');
  } catch (error) {
    console.error('Error in terms rejection:', error);
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
      user.state = USER_STATE.MAIN_MENU;
      await redisHelpers.setUser(userId, user);
      
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.log('Не удалось удалить сообщение:', e.message);
      }
      
      const welcomeMessage = `✨ Добро пожаловать в *Анонимный Чат*!\n\n` +
        `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
        `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
        `Выберите действие:`;
      
      await ctx.replyWithMarkdown(welcomeMessage, getMainMenu());
    }
  } catch (error) {
    console.error('Error in gender selection:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
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
    
    if (user.state === USER_STATE.IN_CHAT) {
      const chat = await redisHelpers.getActiveChat(userId);
      if (chat && chat.partnerId) {
        try {
          await ctx.telegram.sendMessage(chat.partnerId, `💬 Сообщение:\n\n${text}\n\n/stopp - остановить диалог`);
          ctx.reply('✅ Сообщение отправлено');
        } catch (error) {
          ctx.reply('❌ Не удалось отправить сообщение. Возможно, собеседник вышел из чата.');
          await endChat(chat.chatId);
        }
      }
      return;
    }
    
    switch (text) {
      case '🔍 Найти собеседника':
        await handleSearch(ctx);
        break;
      case '🚻 Мой профиль':
        await showProfile(ctx);
        break;
      case '💎 Премиум подписка':
        await showPremiumInfo(ctx);
        break;
      case '📞 Поддержка':
        ctx.replyWithMarkdown(`🆘 *Поддержка*\n\nПо всем вопросам обращайтесь: ${CONFIG.SUPPORT_URL}`);
        break;
      case '📜 Правила':
        ctx.replyWithMarkdown('📜 *Правила использования:*\n\n1. Быть вежливым\n2. Не спамить\n3. Уважать собеседников');
        break;
      case '❌ Выход':
        ctx.reply('До свидания! Если захотите вернуться, используйте /start');
        break;
      default:
        ctx.reply('Используйте кнопки меню для навигации', getMainMenu());
    }
  } catch (error) {
    console.error('Error in text processing:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Поиск собеседника
async function handleSearch(ctx) {
  try {
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (!user || !user.gender) {
      return ctx.reply('Сначала настройте профиль', getMainMenu());
    }
    
    if (user.searchesLeft <= 0 && !user.premium) {
      return ctx.replyWithMarkdown(
        `❌ Лимит бесплатных поисков исчерпан\n\n` +
        `💎 Приобретите премиум-подписку для неограниченного поиска`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💎 Премиум подписка', 'premium_info')],
          [Markup.button.callback('❌ Отмена', 'cancel_search')]
        ])
      );
    }
    
    if (!user.premium) {
      user.searchesLeft--;
      await redisHelpers.setUser(userId, user);
    }
    
    user.state = USER_STATE.SEARCHING;
    await redisHelpers.setUser(userId, user);
    
    if (user.premium) {
      ctx.reply(
        '🔍 Выберите тип поиска:',
        Markup.inlineKeyboard([
          [Markup.button.callback('🎯 По полу', 'search_by_gender')],
          [Markup.button.callback('🎲 Случайный', 'search_random')],
          [Markup.button.callback('❌ Отмена', 'cancel_search')]
        ])
      );
    } else {
      ctx.reply(
        '🔍 Ищем случайного собеседника...\n\n/stopp - остановить поиск',
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ Остановить поиск', 'cancel_search')]
        ])
      );
      await findChatPartner(userId, 'any');
    }
  } catch (error) {
    console.error('Error in handleSearch:', error);
    ctx.reply('❌ Произошла ошибка при поиске. Пожалуйста, попробуйте еще раз.');
  }
}

// Показ профиля
async function showProfile(ctx) {
  try {
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (!user) {
      return ctx.reply('Пожалуйста, начните с команды /start');
    }
    
    const profileText = `👤 *Ваш профиль*\n\n` +
      `Имя: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}\n` +
      `Пол: ${user.gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n` +
      `Статус: ${user.premium ? '💎 Премиум' : '🔓 Обычный'}\n` +
      `Поисков осталось: ${user.searchesLeft}\n` +
      `Дата регистрации: ${new Date(user.createdAt).toLocaleDateString('ru-RU')}`;
    
    ctx.replyWithMarkdown(profileText, getMainMenu());
  } catch (error) {
    console.error('Error in showProfile:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
}

// Информация о премиум подписке
async function showPremiumInfo(ctx) {
  try {
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user && user.premium) {
      return ctx.replyWithMarkdown(
        `💎 *У вас уже есть премиум-подписка!*\n\n` +
        `✨ Преимущества:\n` +
        `• 🚻 Поиск по полу\n` +
        `• ♾️ Неограниченный поиск\n` +
        `• ⚡ Приоритет в очереди`,
        getMainMenu()
      );
    }
    
    ctx.replyWithMarkdown(
      `💎 *Премиум-подписка* - ${CONFIG.PREMIUM_COST} руб.\n\n` +
      `✨ *Преимущества:*\n` +
      `• 🚻 Поиск по полу (мужской/женский)\n` +
      `• ♾️ Неограниченное количество поисков\n` +
      `• ⚡ Приоритет в очереди поиска\n\n` +
      `💳 Для приобретения свяжитесь с администратором: @admin`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Купить подписку', 'buy_premium')],
        [Markup.button.callback('❌ Отмена', 'cancel_premium')]
      ])
    );
  } catch (error) {
    console.error('Error in showPremiumInfo:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
}

// Поиск собеседника по полу (премиум)
bot.action('search_by_gender', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (!user || !user.premium) {
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.log('Не удалось удалить сообщение:', e.message);
      }
      return ctx.reply('❌ Эта функция доступна только премиум-пользователям');
    }
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.reply(
      '🚻 Выберите пол для поиска:',
      Markup.inlineKeyboard([
        [Markup.button.callback('👨 Мужской', 'find_male')],
        [Markup.button.callback('👩 Женский', 'find_female')],
        [Markup.button.callback('❌ Отмена', 'cancel_search')]
      ])
    );
  } catch (error) {
    console.error('Error in search_by_gender:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработка выбора пола для поиска
bot.action(/^find_(male|female)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const gender = ctx.match[1];
    const userId = ctx.from.id;
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.reply(
      `🔍 Ищем ${gender === 'male' ? '👨 мужчину' : '👩 женщину'}...\n\n/stopp - остановить поиск`,
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Остановить поиск', 'cancel_search')]
      ])
    );
    
    await findChatPartner(userId, gender);
  } catch (error) {
    console.error('Error in find gender:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Случайный поиск
bot.action('search_random', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.reply(
      '🔍 Ищем случайного собеседника...\n\n/stopp - остановить поиск',
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Остановить поиск', 'cancel_search')]
      ])
    );
    
    await findChatPartner(userId, 'any');
  } catch (error) {
    console.error('Error in search_random:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Отмена поиска
bot.action('cancel_search', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (user) {
      user.state = USER_STATE.MAIN_MENU;
      await redisHelpers.setUser(userId, user);
      await redisHelpers.removeFromAllQueues(userId);
    }
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.reply('❌ Поиск отменен', getMainMenu());
  } catch (error) {
    console.error('Error in cancel_search:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Поиск собеседника
async function findChatPartner(userId, targetGender) {
  try {
    const user = await redisHelpers.getUser(userId);
    if (!user || user.state !== USER_STATE.SEARCHING) return;
    
    const partnerId = await redisHelpers.findPartner(targetGender, userId);
    
    if (partnerId) {
      await redisHelpers.removeFromQueue(partnerId, targetGender);
      await redisHelpers.removeFromQueue(userId, targetGender);
      await createChat(userId, parseInt(partnerId));
    } else {
      await redisHelpers.addToQueue(userId, targetGender);
      
      setTimeout(async () => {
        try {
          const currentUser = await redisHelpers.getUser(userId);
          if (currentUser && currentUser.state === USER_STATE.SEARCHING) {
            await redisHelpers.removeFromAllQueues(userId);
            currentUser.state = USER_STATE.MAIN_MENU;
            await redisHelpers.setUser(userId, currentUser);
            await bot.telegram.sendMessage(userId, '❌ Поиск завершен. Не удалось найти собеседника.', getMainMenu());
          }
        } catch (error) {
          console.error('Error in search timeout:', error);
        }
      }, CONFIG.SEARCH_TIMEOUT);
    }
  } catch (error) {
    console.error('Error in findChatPartner:', error);
    await bot.telegram.sendMessage(userId, '❌ Произошла ошибка при поиске. Пожалуйста, попробуйте еще раз.');
  }
}

// Создание чата
async function createChat(user1Id, user2Id) {
  try {
    const user1 = await redisHelpers.getUser(user1Id);
    const user2 = await redisHelpers.getUser(user2Id);
    
    if (!user1 || !user2) return;
    
    user1.state = USER_STATE.IN_CHAT;
    user2.state = USER_STATE.IN_CHAT;
    await redisHelpers.setUser(user1Id, user1);
    await redisHelpers.setUser(user2Id, user2);
    
    const chatId = `${user1Id}_${user2Id}_${Date.now()}`;
    
    await redisHelpers.setActiveChat(user1Id, user2Id, chatId);
    await redisHelpers.setActiveChat(user2Id, user1Id, chatId);
    
    const user1Gender = user1.gender === 'male' ? '👨' : '👩';
    const user2Gender = user2.gender === 'male' ? '👨' : '👩';
    
    await bot.telegram.sendMessage(
      user1Id, 
      `💬 Собеседник найден! (${user2Gender})\n\n` +
      `✉️ Напишите сообщение...\n` +
      `/stopp - завершить диалог`,
      Markup.keyboard(['/stopp']).resize()
    );
    
    await bot.telegram.sendMessage(
      user2Id, 
      `💬 Собеседник найден! (${user1Gender})\n\n` +
      `✉️ Напишите сообщение...\n` +
      `/stopp - завершить диалог`,
      Markup.keyboard(['/stopp']).resize()
    );
    
    setTimeout(async () => {
      try {
        const chat = await redisHelpers.getActiveChat(user1Id);
        if (chat && chat.chatId === chatId) {
          await endChat(chatId);
        }
      } catch (error) {
        console.error('Error in chat timeout:', error);
      }
    }, CONFIG.CHAT_TIMEOUT);
  } catch (error) {
    console.error('Error in createChat:', error);
    await bot.telegram.sendMessage(user1Id, '❌ Произошла ошибка при создании чата. Пожалуйста, попробуйте еще раз.');
    await bot.telegram.sendMessage(user2Id, '❌ Произошла ошибка при создании чата. Пожалуйста, попробуйте еще раз.');
  }
}

// Завершение чата
async function endChat(chatId) {
  try {
    const parts = chatId.split('_');
    const user1Id = parseInt(parts[0]);
    const user2Id = parseInt(parts[1]);
    
    const user1 = await redisHelpers.getUser(user1Id);
    const user2 = await redisHelpers.getUser(user2Id);
    
    if (user1) {
      user1.state = USER_STATE.MAIN_MENU;
      await redisHelpers.setUser(user1Id, user1);
    }
    
    if (user2) {
      user2.state = USER_STATE.MAIN_MENU;
      await redisHelpers.setUser(user2Id, user2);
    }
    
    await redisHelpers.removeActiveChat(user1Id);
    await redisHelpers.removeActiveChat(user2Id);
    
    try {
      await bot.telegram.sendMessage(user1Id, '❌ Диалог завершен', getMainMenu());
    } catch (error) {
      console.log('Ошибка при отправке сообщения user1:', error.message);
    }
    
    try {
      await bot.telegram.sendMessage(user2Id, '❌ Диалог завершен', getMainMenu());
    } catch (error) {
      console.log('Ошибка при отправке сообщения user2:', error.message);
    }
  } catch (error) {
    console.error('Error in endChat:', error);
  }
}

// Команда /stopp для остановки диалога или поиска
bot.command('stopp', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await redisHelpers.getUser(userId);
    
    if (!user) {
      return ctx.reply('Пожалуйста, начните с команды /start');
    }
    
    if (user.state === USER_STATE.IN_CHAT) {
      const chat = await redisHelpers.getActiveChat(userId);
      if (chat) {
        await endChat(chat.chatId);
        ctx.reply('✅ Диалог завершен', getMainMenu());
      } else {
        user.state = USER_STATE.MAIN_MENU;
        await redisHelpers.setUser(userId, user);
        ctx.reply('❌ Активный диалог не найден', getMainMenu());
      }
      return;
    }
    
    if (user.state === USER_STATE.SEARCHING) {
      user.state = USER_STATE.MAIN_MENU;
      await redisHelpers.setUser(userId, user);
      await redisHelpers.removeFromAllQueues(userId);
      ctx.reply('✅ Поиск остановлен', getMainMenu());
      return;
    }
    
    ctx.reply('❌ Сейчас нечего останавливать', getMainMenu());
  } catch (error) {
    console.error('Error in stopp command:', error);
    ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
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
        version: '2.1',
        redis: 'Upstash'
      });
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

console.log('Anonymous Chat Bot started with Redis support');