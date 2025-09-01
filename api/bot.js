const { Telegraf, Markup } = require('telegraf');
const NodeCache = require('node-cache');

// Инициализация кэша
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Конфигурация
const CONFIG = {
  ADMIN_ID: process.env.ADMIN_ID || 5948326124,
  FREE_SEARCH_LIMIT: 3,
  PREMIUM_COST: 100,
  SESSION_TIMEOUT: 600000,
  CHAT_TIMEOUT: 3600000,
  // URLs для юридических документов
  TERMS_URL: 'https://yourwebsite.com/terms',
  PRIVACY_URL: 'https://yourwebsite.com/privacy',
  SUPPORT_URL: 'https://t.me/your_support'
};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

// Хранилища данных (в продакшене заменить на БД)
const userData = new Map();
const activeChats = new Map();
const searchQueue = {
  male: [],
  female: [],
  any: []
};

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

// Тексты для соглашений
const LEGAL_TEXTS = {
  terms: `📜 *ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ*

1. *ОБЩИЕ ПОЛОЖЕНИЯ*
1.1. Настоящее Пользовательское соглашение регулирует отношения между Вами и Сервисом.
1.2. Используя Сервис, Вы соглашаетесь с условиями настоящего Соглашения.

2. *ПРАВИЛА ИСПОЛЬЗОВАНИЯ СЕРВИСА*
2.1. Сервис предназначен для лиц старше 18 лет.
2.2. Запрещено распространение противоправного контента.
2.3. Запрещены оскорбления, угрозы и домогательства.

3. *КОНФИДЕНЦИАЛЬНОСТЬ*
3.1. Мы обрабатываем данные в соответствии с нашей Политикой конфиденциальности.

Полная версия: ${CONFIG.TERMS_URL}`,

  privacy: `🔒 *ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ*

1. *КАКИЕ ДАННЫЕ МЫ СОБИРАЕМ*
- Идентификатор Telegram
- Пол (добровольно предоставленный)
- Статус подписки

2. *КАК ИСПОЛЬЗУЕМ ДАННЫЕ*
- Для предоставления услуг чата
- Для обработки платежей
- Для улучшения сервиса

3. *ВАШИ ПРАВА*
- Вы можете запросить удаление ваших данных
- Вы можете отказаться от обработки данных

Полная версия: ${CONFIG.PRIVACY_URL}`
};

// Функция для получения главного меню
function getMainMenu(userId) {
  const user = userData.get(userId);
  const isPremium = user && user.premium;
  const searchesLeft = user ? user.searchesLeft : 0;
  
  return Markup.keyboard([
    ['🔍 Найти собеседника', '🚻 Мой профиль'],
    ['💎 Премиум подписка', '📞 Поддержка'],
    ['📜 Правила', '❌ Выход']
  ]).resize();
}

// Команда /start - начальная точка
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  
  // Проверяем, есть ли пользователь в системе
  if (!userData.has(userId)) {
    // Новый пользователь - начинаем с проверки возраста
    userData.set(userId, {
      state: USER_STATE.AGE_VERIFICATION,
      id: userId,
      username: ctx.from.username || `user_${userId}`,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      acceptedTerms: false,
      ageVerified: false,
      searchesLeft: CONFIG.FREE_SEARCH_LIMIT,
      premium: false,
      createdAt: new Date()
    });
  }
  
  const user = userData.get(userId);
  
  // Проверка возраста для новых пользователей
  if (!user.ageVerified) {
    user.state = USER_STATE.AGE_VERIFICATION;
    userData.set(userId, user);
    
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
  
  // Принятие условий использования
  if (!user.acceptedTerms) {
    user.state = USER_STATE.TERMS_ACCEPTANCE;
    userData.set(userId, user);
    
    return ctx.replyWithMarkdown(
      `📋 Для продолжения необходимо принять наши правила:\n\n${LEGAL_TEXTS.terms}\n\n` +
      `Соглашаетесь с условиями?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принимаю', 'terms_accept')],
        [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
      ])
    );
  }
  
  // Настройка профиля
  if (!user.gender) {
    user.state = USER_STATE.PROFILE_SETUP;
    userData.set(userId, user);
    
    return ctx.reply(
      '🚻 Для начала выберите ваш пол:',
      Markup.inlineKeyboard([
        [Markup.button.callback('👨 Мужской', 'gender_male')],
        [Markup.button.callback('👩 Женский', 'gender_female')]
      ])
    );
  }
  
  // Главное меню
  user.state = USER_STATE.MAIN_MENU;
  userData.set(userId, user);
  
  const welcomeMessage = `✨ Добро пожаловать в *Анонимный Чат*!\n\n` +
    `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
    `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
    `Выберите действие:`;
  
  ctx.replyWithMarkdown(welcomeMessage, getMainMenu(userId));
});

// Обработка подтверждения возраста
bot.action('age_confirm_yes', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user) {
    user.ageVerified = true;
    user.state = USER_STATE.TERMS_ACCEPTANCE;
    userData.set(userId, user);
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.replyWithMarkdown(
      `📋 Для продолжения необходимо принять наши правила:\n\n${LEGAL_TEXTS.terms}\n\n` +
      `Соглашаетесь с условиями?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принимаю', 'terms_accept')],
        [Markup.button.callback('❌ Не принимаю', 'terms_decline')]
      ])
    );
  }
});

bot.action('age_confirm_no', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.reply('❌ Извините, этот сервис предназначен только для совершеннолетних пользователей.');
});

// Обработка принятия правил
bot.action('terms_accept', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user) {
    user.acceptedTerms = true;
    user.state = USER_STATE.PROFILE_SETUP;
    userData.set(userId, user);
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    ctx.reply(
      '🚻 Для начала выберите ваш пол:',
      Markup.inlineKeyboard([
        [Markup.button.callback('👨 Мужской', 'gender_male')],
        [Markup.button.callback('👩 Женский', 'gender_female')]
      ])
    );
  }
});

bot.action('terms_decline', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.reply('❌ Для использования сервиса необходимо принять правила. Если передумаете - запустите бота снова командой /start');
});

// Обработка выбора пола
bot.action(/^gender_(male|female)$/, async (ctx) => {
  const gender = ctx.match[1];
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user) {
    user.gender = gender;
    user.state = USER_STATE.MAIN_MENU;
    userData.set(userId, user);
    
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    
    const welcomeMessage = `✨ Добро пожаловать в *Анонимный Чат*!\n\n` +
      `🔍 Бесплатных поисков: ${user.searchesLeft}\n` +
      `💎 Статус: ${user.premium ? 'Премиум' : 'Обычный'}\n\n` +
      `Выберите действие:`;
    
    ctx.replyWithMarkdown(welcomeMessage, getMainMenu(userId));
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const user = userData.get(userId);
  
  if (!user) {
    return ctx.reply('Пожалуйста, начните с команды /start');
  }
  
  // Проверяем, находится ли пользователь в чате
  if (user.state === USER_STATE.IN_CHAT) {
    const chat = activeChats.get(userId);
    if (chat && chat.partnerId) {
      try {
        // Пересылаем сообщение партнеру
        await ctx.telegram.sendMessage(chat.partnerId, `💬 Сообщение от собеседника:\n\n${text}\n\n/stopp - остановить диалог`);
        ctx.reply('✅ Сообщение отправлено');
      } catch (error) {
        ctx.reply('❌ Не удалось отправить сообщение. Возможно, собеседник вышел из чата.');
        endChat(chat.chatId);
      }
    }
    return;
  }
  
  // Обработка главного меню
  switch (text) {
    case '🔍 Найти собеседника':
      handleSearch(ctx);
      break;
    case '🚻 Мой профиль':
      showProfile(ctx);
      break;
    case '💎 Премиум подписка':
      showPremiumInfo(ctx);
      break;
    case '📞 Поддержка':
      ctx.replyWithMarkdown(`🆘 *Поддержка*\n\nПо всем вопросам обращайтесь: ${CONFIG.SUPPORT_URL}`);
      break;
    case '📜 Правила':
      ctx.replyWithMarkdown(LEGAL_TEXTS.terms);
      break;
    case '❌ Выход':
      ctx.reply('До свидания! Если захотите вернуться, используйте /start');
      break;
    default:
      ctx.reply('Используйте кнопки меню для навигации', getMainMenu(userId));
  }
});

// Поиск собеседника
function handleSearch(ctx) {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user || !user.gender) {
    return ctx.reply('Сначала настройте профиль', getMainMenu(userId));
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
  
  // Уменьшаем счетчик поисков для бесплатных пользователей
  if (!user.premium) {
    user.searchesLeft--;
    userData.set(userId, user);
  }
  
  user.state = USER_STATE.SEARCHING;
  userData.set(userId, user);
  
  // Показываем варианты поиска
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
    findChatPartner(userId, 'any');
  }
}

// Показ профиля
function showProfile(ctx) {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user) {
    return ctx.reply('Пожалуйста, начните с команды /start');
  }
  
  const profileText = `👤 *Ваш профиль*\n\n` +
    `Имя: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}\n` +
    `Пол: ${user.gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n` +
    `Статус: ${user.premium ? '💎 Премиум' : '🔓 Обычный'}\n` +
    `Поисков осталось: ${user.searchesLeft}\n` +
    `Дата регистрации: ${user.createdAt.toLocaleDateString('ru-RU')}`;
  
  ctx.replyWithMarkdown(profileText, getMainMenu(userId));
}

// Информация о премиум подписке
function showPremiumInfo(ctx) {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user && user.premium) {
    return ctx.replyWithMarkdown(
      `💎 *У вас уже есть премиум-подписка!*\n\n` +
      `✨ Преимущества:\n` +
      `• 🚻 Поиск по полу\n` +
      `• ♾️ Неограниченный поиск\n` +
      `• ⚡ Приоритет в очереди`,
      getMainMenu(userId)
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
}

// Поиск собеседника по полу (премиум)
bot.action('search_by_gender', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
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
});

// Обработка выбора пола для поиска
bot.action(/^find_(male|female)$/, async (ctx) => {
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
  
  findChatPartner(userId, gender);
});

// Случайный поиск
bot.action('search_random', async (ctx) => {
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
  
  findChatPartner(userId, 'any');
});

// Отмена поиска
bot.action('cancel_search', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user) {
    user.state = USER_STATE.MAIN_MENU;
    userData.set(userId, user);
    
    // Удаляем из очереди поиска
    removeFromSearchQueues(userId);
  }
  
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.reply('❌ Поиск отменен', getMainMenu(userId));
});

// Поиск собеседника
function findChatPartner(userId, targetGender) {
  const user = userData.get(userId);
  if (!user) return;
  
  const queue = searchQueue[targetGender];
  
  // Если пользователь уже в очереди
  if (queue.includes(userId)) {
    return;
  }
  
  // Добавляем в очередь
  queue.push(userId);
  
  // Ищем подходящего собеседника
  if (queue.length >= 2) {
    const partnerId = queue.find(id => id !== userId);
    if (partnerId) {
      // Удаляем из очереди
      const index = queue.indexOf(partnerId);
      if (index > -1) queue.splice(index, 1);
      const userIndex = queue.indexOf(userId);
      if (userIndex > -1) queue.splice(userIndex, 1);
      
      // Создаем чат
      createChat(userId, partnerId);
    }
  }
}

// Создание чата
function createChat(user1Id, user2Id) {
  const chatId = `${user1Id}_${user2Id}_${Date.now()}`;
  
  const user1 = userData.get(user1Id);
  const user2 = userData.get(user2Id);
  
  if (!user1 || !user2) return;
  
  // Обновляем состояние пользователей
  user1.state = USER_STATE.IN_CHAT;
  user2.state = USER_STATE.IN_CHAT;
  userData.set(user1Id, user1);
  userData.set(user2Id, user2);
  
  // Сохраняем активный чат
  activeChats.set(user1Id, { partnerId: user2Id, chatId });
  activeChats.set(user2Id, { partnerId: user1Id, chatId });
  
  // Таймаут чата
  const timeout = setTimeout(() => {
    endChat(chatId);
  }, CONFIG.CHAT_TIMEOUT);
  
  cache.set(`chat_${chatId}`, timeout);
  
  // Уведомляем пользователей
  const user1Gender = user1.gender === 'male' ? '👨' : '👩';
  const user2Gender = user2.gender === 'male' ? '👨' : '👩';
  
  bot.telegram.sendMessage(
    user1Id, 
    `💬 Собеседник найден! (${user2Gender})\n\n` +
    `✉️ Напишите сообщение...\n` +
    `/stopp - завершить диалог`,
    Markup.keyboard(['/stopp']).resize()
  );
  
  bot.telegram.sendMessage(
    user2Id, 
    `💬 Собеседник найден! (${user1Gender})\n\n` +
    `✉️ Напишите сообщение...\n` +
    `/stopp - завершить диалог`,
    Markup.keyboard(['/stopp']).resize()
  );
}

// Завершение чата
function endChat(chatId) {
  const [user1Id, user2Id] = chatId.split('_');
  const id1 = parseInt(user1Id);
  const id2 = parseInt(user2Id);
  
  const user1 = userData.get(id1);
  const user2 = userData.get(id2);
  
  if (user1) {
    user1.state = USER_STATE.MAIN_MENU;
    userData.set(id1, user1);
  }
  
  if (user2) {
    user2.state = USER_STATE.MAIN_MENU;
    userData.set(id2, user2);
  }
  
  activeChats.delete(id1);
  activeChats.delete(id2);
  
  const timeout = cache.get(`chat_${chatId}`);
  if (timeout) {
    clearTimeout(timeout);
    cache.del(`chat_${chatId}`);
  }
  
  bot.telegram.sendMessage(id1, '❌ Диалог завершен', getMainMenu(id1));
  bot.telegram.sendMessage(id2, '❌ Диалог завершен', getMainMenu(id2));
}

// Удаление из всех очередей поиска
function removeFromSearchQueues(userId) {
  Object.keys(searchQueue).forEach(gender => {
    const index = searchQueue[gender].indexOf(userId);
    if (index > -1) {
      searchQueue[gender].splice(index, 1);
    }
  });
}

// Команда /stopp для остановки диалога или поиска
bot.command('stopp', (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user) {
    return ctx.reply('Пожалуйста, начните с команды /start');
  }
  
  // Если пользователь в чате
  if (user.state === USER_STATE.IN_CHAT) {
    const chat = activeChats.get(userId);
    if (chat) {
      endChat(chat.chatId);
      ctx.reply('✅ Диалог завершен', getMainMenu(userId));
    } else {
      user.state = USER_STATE.MAIN_MENU;
      userData.set(userId, user);
      ctx.reply('❌ Активный диалог не найден', getMainMenu(userId));
    }
    return;
  }
  
  // Если пользователь в поиске
  if (user.state === USER_STATE.SEARCHING) {
    user.state = USER_STATE.MAIN_MENU;
    userData.set(userId, user);
    
    // Удаляем из очереди поиска
    removeFromSearchQueues(userId);
    
    ctx.reply('✅ Поиск остановлен', getMainMenu(userId));
    return;
  }
  
  ctx.reply('❌ Сейчас нечего останавливать', getMainMenu(userId));
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
        version: '2.0',
        users: userData.size,
        activeChats: activeChats.size
      });
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

console.log('Anonymous Chat Bot started');
