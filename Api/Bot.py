import os
import logging
from aiogram import Bot, Dispatcher, types
from aiogram.contrib.fsm_storage.memory import MemoryStorage
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.filters.state import State, StatesGroup
import requests
from pymongo import MongoClient
import uuid

# Настройка логгирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация бота
API_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
MONGO_URI = os.getenv('MONGODB_URI')
ADMIN_ID = os.getenv('ADMIN_ID')

bot = Bot(token=API_TOKEN)
dp = Dispatcher(bot, storage=MemoryStorage())

# Подключение к MongoDB
client = MongoClient(MONGO_URI)
db = client.crypto_exchange_bot

# Состояния FSM
class ExchangeStates(StatesGroup):
    CHOOSE_PAIR = State()
    ENTER_AMOUNT = State()
    CONFIRM_EXCHANGE = State()

# Команда /start
@dp.message_handler(commands=['start'], state='*')
async def cmd_start(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    user_data = db.users.find_one({"user_id": user_id})
    
    if not user_data:
        db.users.insert_one({
            "user_id": user_id,
            "username": message.from_user.username,
            "balance": {"BTC": 0, "ETH": 0, "USDT": 0},
            "transactions": []
        })
    
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True)
    keyboard.add("💰 Обменять", "💼 Баланс")
    keyboard.add("ℹ️ Помощь")
    
    await message.answer(
        "🔐 Добро пожаловать в CryptoExchangeBot!\n"
        "Быстрый и безопасный обмен криптовалюты\n\n"
        "Выберите действие:",
        reply_markup=keyboard
    )
    await state.finish()

# Обработка кнопки "Обменять"
@dp.message_handler(text="💰 Обменять", state='*')
async def start_exchange(message: types.Message):
    keyboard = types.InlineKeyboardMarkup()
    keyboard.row(
        types.InlineKeyboardButton("BTC → USDT", callback_data="pair_BTC_USDT"),
        types.InlineKeyboardButton("ETH → USDT", callback_data="pair_ETH_USDT")
    )
    keyboard.row(
        types.InlineKeyboardButton("USDT → BTC", callback_data="pair_USDT_BTC"),
        types.InlineKeyboardButton("USDT → ETH", callback_data="pair_USDT_ETH")
    )
    
    await message.answer("Выберите валютную пару:", reply_markup=keyboard)
    await ExchangeStates.CHOOSE_PAIR.set()

# Обработка выбора пары
@dp.callback_query_handler(lambda c: c.data.startswith('pair_'), state=ExchangeStates.CHOOSE_PAIR)
async def process_pair(callback_query: types.CallbackQuery, state: FSMContext):
    _, from_coin, to_coin = callback_query.data.split('_')
    async with state.proxy() as data:
        data['pair'] = (from_coin, to_coin)
    
    await bot.answer_callback_query(callback_query.id)
    await bot.send_message(
        callback_query.from_user.id, 
        f"Введите сумму {from_coin} для обмена:"
    )
    await ExchangeStates.ENTER_AMOUNT.set()

# Обработка ввода суммы
@dp.message_handler(state=ExchangeStates.ENTER_AMOUNT)
async def process_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount <= 0:
            await message.answer("❌ Сумма должна быть больше нуля!")
            return
            
        async with state.proxy() as data:
            from_coin, to_coin = data['pair']
            data['amount'] = amount
            
            # Получаем курс
            rate = get_exchange_rate(from_coin, to_coin)
            if not rate:
                await message.answer("⚠️ Ошибка получения курса. Попробуйте позже.")
                return
                
            to_amount = amount * rate
            data['to_amount'] = round(to_amount, 6)
            data['rate'] = rate
            
            text = (
                f"🔁 Обмен: {amount} {from_coin} → {data['to_amount']} {to_coin}\n"
                f"📈 Курс: 1 {from_coin} = {rate} {to_coin}\n\n"
                "Подтверждаете обмен?"
            )
            
            keyboard = types.InlineKeyboardMarkup()
            keyboard.add(types.InlineKeyboardButton("✅ Подтвердить", callback_data="confirm_yes"))
            keyboard.add(types.InlineKeyboardButton("❌ Отменить", callback_data="confirm_no"))
            
            await message.answer(text, reply_markup=keyboard)
            await ExchangeStates.CONFIRM_EXCHANGE.set()
            
    except ValueError:
        await message.answer("❌ Введите числовое значение суммы!")

# Подтверждение обмена
@dp.callback_query_handler(lambda c: c.data.startswith('confirm_'), state=ExchangeStates.CONFIRM_EXCHANGE)
async def confirm_exchange(callback_query: types.CallbackQuery, state: FSMContext):
    action = callback_query.data.split('_')[1]
    
    if action == "no":
        await bot.send_message(callback_query.from_user.id, "❌ Обмен отменен")
        await cmd_start(callback_query.message, state)
        return
        
    async with state.proxy() as data:
        from_coin, to_coin = data['pair']
        amount = data['amount']
        to_amount = data['to_amount']
        
        transaction_id = str(uuid.uuid4())[:8].upper()
        
        # Обновляем балансы (в демо-режиме без реального обмена)
        db.users.update_one(
            {"user_id": callback_query.from_user.id},
            {"$inc": {f"balance.{from_coin}": -amount, f"balance.{to_coin}": to_amount}}
        )
        
        # Сохраняем транзакцию
        db.transactions.insert_one({
            "transaction_id": transaction_id,
            "user_id": callback_query.from_user.id,
            "pair": f"{from_coin}/{to_coin}",
            "amount": amount,
            "to_amount": to_amount,
            "status": "completed"
        })
        
        await bot.send_message(
            callback_query.from_user.id,
            f"✅ Обмен успешно завершен!\n"
            f"ID транзакции: {transaction_id}\n"
            f"На баланс зачислено: {to_amount} {to_coin}"
        )
        
        # Уведомление админу
        if ADMIN_ID:
            await bot.send_message(
                ADMIN_ID,
                f"🔔 Новая транзакция!\n"
                f"Пользователь: @{callback_query.from_user.username}\n"
                f"Обмен: {amount} {from_coin} → {to_amount} {to_coin}\n"
                f"ID: {transaction_id}"
            )
    
    await state.finish()
    await cmd_start(callback_query.message, state)

# Получение курса (демо-режим)
def get_exchange_rate(from_coin, to_coin):
    # Реальные значения можно получать через CoinGecko API
    demo_rates = {
        ("BTC", "USDT"): 60000,
        ("ETH", "USDT"): 3000,
        ("USDT", "BTC"): 1/60000,
        ("USDT", "ETH"): 1/3000
    }
    return demo_rates.get((from_coin, to_coin))

# Команда баланса
@dp.message_handler(text="💼 Баланс")
async def show_balance(message: types.Message):
    user_data = db.users.find_one({"user_id": message.from_user.id})
    if not user_data:
        return
        
    balance = user_data.get('balance', {})
    text = "💼 Ваш баланс:\n"
    for coin, amount in balance.items():
        if amount > 0:
            text += f"• {coin}: {amount:.6f}\n"
    
    if text == "💼 Ваш баланс:\n":
        text = "💰 На вашем балансе пока нет средств"
        
    await message.answer(text)

# Помощь
@dp.message_handler(text="ℹ️ Помощь")
async def show_help(message: types.Message):
    await message.answer(
        "❓ Как пользоваться ботом:\n\n"
        "1. Нажмите '💰 Обменять'\n"
        "2. Выберите валютную пару\n"
        "3. Введите сумму\n"
        "4. Подтвердите операцию\n\n"
        "Техподдержка: @ваш_аккаунт"
    )

# Обработка вебхука для Vercel
from aiogram.utils.executor import start_webhook

async def on_startup(dp):
    await bot.set_webhook(os.getenv('VERCEL_URL') + '/webhook')

async def on_shutdown(dp):
    await bot.delete_webhook()

if __name__ == '__main__':
    start_webhook(
        dispatcher=dp,
        webhook_path='/webhook',
        on_startup=on_startup,
        on_shutdown=on_shutdown,
        skip_updates=True,
        host="0.0.0.0",
        port=int(os.getenv('PORT', 5000))
