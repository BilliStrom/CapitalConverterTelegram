import os
import logging
from aiogram import Bot, Dispatcher, types
from aiogram.contrib.fsm_storage.memory import MemoryStorage
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.filters.state import State, StatesGroup
import uuid
from aiogram.utils.executor import start_webhook

# Настройка логгирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация бота
API_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
ADMIN_ID = os.getenv('ADMIN_ID', '123456789')  # Ваш ID в Telegram

bot = Bot(token=API_TOKEN)
dp = Dispatcher(bot, storage=MemoryStorage())

# Вместо базы данных - словарь в памяти
user_data = {}

# Состояния FSM
class ExchangeStates(StatesGroup):
    CHOOSE_PAIR = State()
    ENTER_AMOUNT = State()
    CONFIRM_EXCHANGE = State()

# Команда /start
@dp.message_handler(commands=['start'], state='*')
async def cmd_start(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    
    # Инициализация пользователя
    if user_id not in user_data:
        user_data[user_id] = {
            "balance": {"BTC": 0.1, "ETH": 0.5, "USDT": 50},
            "transactions": []
        }
    
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True)
    keyboard.add("💰 Обменять", "💼 Баланс")
    keyboard.add("ℹ️ Помощь")
    
    await message.answer(
        "🔐 Добро пожаловать в CryptoBot!\n"
        "Быстрый обмен криптовалюты в один клик\n\n"
        "Выберите действие:",
        reply_markup=keyboard
    )
    await state.finish()

# Обмен валюты
@dp.message_handler(text="💰 Обменять", state='*')
async def start_exchange(message: types.Message):
    keyboard = types.InlineKeyboardMarkup(row_width=2)
    buttons = [
        types.InlineKeyboardButton("BTC → USDT", callback_data="pair_BTC_USDT"),
        types.InlineKeyboardButton("ETH → USDT", callback_data="pair_ETH_USDT"),
        types.InlineKeyboardButton("USDT → BTC", callback_data="pair_USDT_BTC"),
        types.InlineKeyboardButton("USDT → ETH", callback_data="pair_USDT_ETH")
    ]
    keyboard.add(*buttons)
    
    await message.answer("Выберите валютную пару:", reply_markup=keyboard)
    await ExchangeStates.CHOOSE_PAIR.set()

# Обработка выбора пары
@dp.callback_query_handler(lambda c: c.data.startswith('pair_'), state=ExchangeStates.CHOOSE_PAIR)
async def process_pair(callback_query: types.CallbackQuery, state: FSMContext):
    _, from_coin, to_coin = callback_query.data.split('_')
    
    await state.update_data(pair=(from_coin, to_coin))
    await bot.send_message(
        callback_query.from_user.id, 
        f"Введите сумму {from_coin} для обмена:"
    )
    await ExchangeStates.ENTER_AMOUNT.set()

# Обработка суммы
@dp.message_handler(state=ExchangeStates.ENTER_AMOUNT)
async def process_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount <= 0:
            await message.answer("❌ Сумма должна быть больше нуля!")
            return
            
        data = await state.get_data()
        from_coin, to_coin = data['pair']
        
        # Курсы для демонстрации
        rates = {
            ("BTC", "USDT"): 60000,
            ("ETH", "USDT"): 3000,
            ("USDT", "BTC"): 1/60000,
            ("USDT", "ETH"): 1/3000
        }
        
        rate = rates.get((from_coin, to_coin))
        if not rate:
            await message.answer("⚠️ Ошибка курса. Выберите другую пару")
            return
            
        to_amount = round(amount * rate, 6)
        
        await state.update_data(
            amount=amount,
            to_amount=to_amount,
            rate=rate
        )
        
        text = (
            f"🔁 Обмен: {amount} {from_coin} → {to_amount} {to_coin}\n"
            f"📈 Курс: 1 {from_coin} = {rate} {to_coin}\n\n"
            "Подтверждаете обмен?"
        )
        
        keyboard = types.InlineKeyboardMarkup()
        keyboard.add(types.InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_yes"))
        keyboard.add(types.InlineKeyboardButton("❌ Отменить", callback_data="confirm_no"))
        
        await message.answer(text, reply_markup=keyboard)
        await ExchangeStates.CONFIRM_EXCHANGE.set()
            
    except ValueError:
        await message.answer("❌ Введите число!")

# Подтверждение обмена
@dp.callback_query_handler(lambda c: c.data.startswith('confirm_'), state=ExchangeStates.CONFIRM_EXCHANGE)
async def confirm_exchange(callback_query: types.CallbackQuery, state: FSMContext):
    action = callback_query.data.split('_')[1]
    user_id = callback_query.from_user.id
    
    if action == "no":
        await bot.send_message(user_id, "❌ Обмен отменен")
        await cmd_start(callback_query.message, state)
        return
        
    data = await state.get_data()
    from_coin, to_coin = data['pair']
    amount = data['amount']
    to_amount = data['to_amount']
    
    # Обновляем баланс
    if user_id in user_data:
        user_data[user_id]["balance"][from_coin] -= amount
        if to_coin not in user_data[user_id]["balance"]:
            user_data[user_id]["balance"][to_coin] = 0
        user_data[user_id]["balance"][to_coin] += to_amount
        
        # Сохраняем транзакцию
        transaction_id = str(uuid.uuid4())[:6].upper()
        user_data[user_id]["transactions"].append({
            "id": transaction_id,
            "pair": f"{from_coin}/{to_coin}",
            "amount": amount,
            "to_amount": to_amount
        })
        
        await bot.send_message(
            user_id,
            f"✅ Обмен успешен!\n"
            f"ID: {transaction_id}\n"
            f"Получено: {to_amount} {to_coin}"
        )
        
        # Уведомление админу
        await bot.send_message(
            ADMIN_ID,
            f"🔔 Новый обмен!\n"
            f"Пользователь: @{callback_query.from_user.username}\n"
            f"Обмен: {amount} {from_coin} → {to_amount} {to_coin}\n"
            f"ID: {transaction_id}"
        )
    
    await state.finish()
    await cmd_start(callback_query.message, state)

# Баланс
@dp.message_handler(text="💼 Баланс")
async def show_balance(message: types.Message):
    user_id = message.from_user.id
    if user_id not in user_data:
        await cmd_start(message, None)
        return
        
    balance = user_data[user_id]["balance"]
    text = "💼 Ваш баланс:\n"
    for coin, amount in balance.items():
        text += f"• {coin}: {amount:.6f}\n"
    
    await message.answer(text)

# Помощь
@dp.message_handler(text="ℹ️ Помощь")
async def show_help(message: types.Message):
    await message.answer(
        "🆘 Помощь по боту:\n\n"
        "1. Нажмите '💰 Обменять'\n"
        "2. Выберите пару валют\n"
        "3. Введите сумму\n"
        "4. Подтвердите операцию\n\n"
        "Техподдержка: @ваш_аккаунт"
    )

# Вебхук для Vercel
async def on_startup(dp):
    webhook_url = os.getenv('VERCEL_URL') + '/webhook'
    await bot.set_webhook(webhook_url)
    logger.info(f"Бот запущен! Webhook: {webhook_url}")

if __name__ == '__main__':
    # Для локального тестирования
    from aiogram import executor
    executor.start_polling(dp, skip_updates=True)
