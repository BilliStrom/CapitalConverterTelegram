import os
from aiogram import Bot, Dispatcher, types
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.enums import ParseMode
import logging
import sys

# Настройка логгирования
logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger(__name__)

# Инициализация бота
API_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
bot = Bot(token=API_TOKEN, parse_mode=ParseMode.HTML)
dp = Dispatcher(storage=MemoryStorage())

class Form(StatesGroup):
    main_menu = State()

@dp.message(commands=['start'])
async def cmd_start(message: types.Message, state: FSMContext):
    await message.answer(
        "🖐 Добро пожаловать в бота!\n"
        "Используйте /help для списка команд"
    )
    await state.set_state(Form.main_menu)

@dp.message(commands=['help'])
async def cmd_help(message: types.Message):
    await message.answer("ℹ Доступные команды:\n/start\n/help")

async def main():
    await dp.start_polling(bot)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
