const { Telegraf, Markup } = require('telegraf');

// Кастомная реализация кэша
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
  },
  del(key) {
    if (this._timeouts.has(key)) {
      clearTimeout(this._timeouts.get(key));
      this._timeouts.delete(key);
    }
    this._store.delete(key);
  }
};

// Конфигурация
const CONFIG = {
  ADMIN_ID: 5948326124,
  FREE_SEARCH_LIMIT: 3,
  PREMIUM_COST: 100, // рублей
  SESSION_TIMEOUT: 600000,
  CHAT_TIMEOUT: 3600000, // 1 час бездействия
};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false }
});

// Хранилище данных
const userData = new Map();
const activeChats = new Map();
const searchQueue = {
  male: [],
  female: [],
  any: []
};

// Сессии пользователей
const userSessions = {};

// Middleware для сессий
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
  const welcomeMessage = `👋 Добро пожаловать в *Анонимный Чат*!
  
✨ *Возможности:*
🔍 Поиск собеседников
🚻 Фильтр по полу
💎 Премиум-подписка
🎯 Таргетированный поиск

📋 *Основные команды:*
/start - Начать работу
/profile - Настройка профиля
/search - Найти собеседника
/stop - Остановить диалог
/premium - Премиум-подписка
/help - Помощь

💬 Начните с настройки профиля командой /profile`;

  ctx.replyWithMarkdown(welcomeMessage);
});

// Настройка профиля
bot.command('profile', (ctx) => {
  ctx.session.step = 'set_gender';
  ctx.reply('🚻 Выберите ваш пол:', Markup.inlineKeyboard([
    [Markup.button.callback('👨 Мужской', 'gender_male')],
    [Markup.button.callback('👩 Женский', 'gender_female')]
  ]));
});

// Обработка выбора пола
bot.action(/^gender_(male|female)$/, async (ctx) => {
  const gender = ctx.match[1];
  const userId = ctx.from.id;
  
  // Сохраняем данные пользователя
  if (!userData.has(userId)) {
    userData.set(userId, {
      gender,
      premium: false,
      searchesLeft: CONFIG.FREE_SEARCH_LIMIT,
      createdAt: Date.now()
    });
  } else {
    const data = userData.get(userId);
    data.gender = gender;
    userData.set(userId, data);
  }
  
  cache.set(`user_${userId}`, gender);
  
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.replyWithMarkdown(`✅ Пол установлен: ${gender === 'male' ? '👨 Мужской' : '👩 Женский'}\n\nТеперь вы можете использовать /search для поиска собеседника`);
});

// Поиск собеседника
bot.command('search', (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user || !user.gender) {
    return ctx.reply('⚠️ Сначала настройте профиль командой /profile');
  }
  
  if (user.searchesLeft <= 0 && !user.premium) {
    return ctx.replyWithMarkdown(`❌ Лимит бесплатных поисков исчерпан\n\n💎 Приобретите премиум-подписку для неограниченного поиска:\n/premium`);
  }
  
  ctx.session.step = 'search_options';
  ctx.reply('🔍 Выберите тип поиска:', Markup.inlineKeyboard([
    [Markup.button.callback('🎯 По полу', 'search_by_gender')],
    [Markup.button.callback('🎲 Случайный', 'search_random')],
    [Markup.button.callback('❌ Отмена', 'search_cancel')]
  ]));
});

// Поиск по полу (премиум)
bot.action('search_by_gender', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user.premium) {
    try {
      await ctx.deleteMessage();
    } catch (e) {
      console.log('Не удалось удалить сообщение:', e.message);
    }
    return ctx.replyWithMarkdown(`❌ Поиск по полу доступен только с премиум-подпиской\n\n💎 Приобретите премиум:\n/premium`);
  }
  
  ctx.session.step = 'select_gender';
  ctx.reply('🚻 Выберите пол для поиска:', Markup.inlineKeyboard([
    [Markup.button.callback('👨 Мужской', 'find_male')],
    [Markup.button.callback('👩 Женский', 'find_female')],
    [Markup.button.callback('❌ Отмена', 'search_cancel')]
  ]));
});

// Случайный поиск
bot.action('search_random', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  // Уменьшаем счетчик поисков для бесплатных пользователей
  if (!user.premium) {
    user.searchesLeft--;
    userData.set(userId, user);
  }
  
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.reply('🔍 Ищем собеседника...');
  findChatPartner(userId, 'any');
});

// Поиск конкретного пола
bot.action(/^find_(male|female)$/, async (ctx) => {
  const gender = ctx.match[1];
  const userId = ctx.from.id;
  
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  
  ctx.reply(`🔍 Ищем ${gender === 'male' ? '👨 мужчину' : '👩 женщину'}...`);
  findChatPartner(userId, gender);
});

// Отмена поиска
bot.action('search_cancel', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e.message);
  }
  ctx.reply('❌ Поиск отменен');
});

// Поиск собеседника
function findChatPartner(userId, targetGender) {
  const user = userData.get(userId);
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
  
  activeChats.set(user1Id, { partner: user2Id, chatId });
  activeChats.set(user2Id, { partner: user1Id, chatId });
  
  // Таймаут чата
  const timeout = setTimeout(() => {
    endChat(chatId);
  }, CONFIG.CHAT_TIMEOUT);
  
  cache.set(`chat_${chatId}`, timeout);
  
  // Уведомляем пользователей
  const user1Gender = userData.get(user1Id)?.gender || 'unknown';
  const user2Gender = userData.get(user2Id)?.gender || 'unknown';
  
  bot.telegram.sendMessage(user1Id, `💬 Собеседник найден! (${user2Gender === 'male' ? '👨' : '👩'})\n\n✉️ Напишите сообщение...\n/stop - завершить диалог`);
  bot.telegram.sendMessage(user2Id, `💬 Собеседник найден! (${user1Gender === 'male' ? '👨' : '👩'})\n\n✉️ Напишите сообщение...\n/stop - завершить диалог`);
}

// Завершение чата
function endChat(chatId) {
  const [user1Id, user2Id] = chatId.split('_');
  
  activeChats.delete(parseInt(user1Id));
  activeChats.delete(parseInt(user2Id));
  cache.del(`chat_${chatId}`);
  
  bot.telegram.sendMessage(user1Id, '❌ Диалог завершен (таймаут)');
  bot.telegram.sendMessage(user2Id, '❌ Диалог завершен (таймаут)');
}

// Обработка сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  
  if (text.startsWith('/')) return;
  
  // Если пользователь в активном чате
  const chat = activeChats.get(userId);
  if (chat) {
    const partnerId = chat.partner;
    
    try {
      await ctx.telegram.sendMessage(partnerId, `✉️ Сообщение:\n\n${text}\n\n/stop - завершить диалог`);
      ctx.reply('✅ Сообщение отправлено');
    } catch (error) {
      ctx.reply('❌ Не удалось отправить сообщение');
      endChat(chat.chatId);
    }
    return;
  }
  
  // Обработка шагов регистрации
  if (ctx.session.step === 'set_gender') {
    // Уже обрабатывается через кнопки
    return;
  }
  
  ctx.reply('ℹ️ Используйте /search для поиска собеседника');
});

// Команда /stop
bot.command('stop', (ctx) => {
  const userId = ctx.from.id;
  const chat = activeChats.get(userId);
  
  if (chat) {
    endChat(chat.chatId);
    ctx.reply('✅ Диалог завершен');
  } else {
    ctx.reply('ℹ️ У вас нет активных диалогов');
  }
});

// Премиум-подписка
bot.command('premium', (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (user && user.premium) {
    return ctx.replyWithMarkdown('💎 У вас уже есть премиум-подписка!\n\n✨ Преимущества:\n• 🚻 Поиск по полу\n• ♾️ Неограниченный поиск\n• ⚡ Приоритет в очереди');
  }
  
  ctx.replyWithMarkdown(`💎 *Премиум-подписка* - ${CONFIG.PREMIUM_COST} руб.

✨ *Преимущества:*
• 🚻 Поиск по полу (мужской/женский)
• ♾️ Неограниченное количество поисков
• ⚡ Приоритет в очереди поиска

💳 Для приобретения свяжитесь с администратором: @admin`);
});

// Помощь
bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(`❓ *Помощь по боту*

🔍 *Поиск собеседника:*
• Бесплатно: ${CONFIG.FREE_SEARCH_LIMIT} поиска в день
• Премиум: неограниченно + поиск по полу

💎 *Премиум-подписка:*
• Стоимость: ${CONFIG.PREMIUM_COST} руб.
• Команда: /premium

📋 *Основные команды:*
/start - Начать
/profile - Настройка профиля
/search - Поиск собеседника
/stop - Завершить диалог
/premium - Премиум-подписка

⚠️ *Правила:*
• Уважайте собеседников
• Запрещен спам
• Запрещены оскорбления`);
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
        version: '1.0',
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
