const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = 3000;

// ================= НАСТРОЙКИ =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Сессии
app.use(session({
    secret: 'bookstore-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 дней
}));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'book-store',
    password: 'password', 
    port: 5432,
});

// Проверка подключения
pool.connect()
    .then(client => {
        console.log('Подключено к PostgreSQL');
        client.release();
    })
    .catch(err => console.error('Ошибка подключения к БД:', err.message));

// ================= МАРШРУТЫ СТРАНИЦ =================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/catalog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'catalog.html'));
});
app.get('/book', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'book.html'));
});
app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cart.html'));
});
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// ================= API: КНИГИ (BOOKS) =================
// Получить все книги
app.get('/api/books', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, c.name as category_name
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            ORDER BY b.id
        `);
        res.json({ success: true, books: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка получения книг' });
    }
});

// Получить книгу по ID
app.get('/api/books/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM books WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Книга не найдена' });
        }
        res.json({ success: true, book: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка' });
    }
});

// ================= API: АВТОРИЗАЦИЯ =================
// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, nickname } = req.body;

        // Валидация
        const errors = [];
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push('Некорректный email');
        }
        if (!password || password.length < 6) {
            errors.push('Пароль должен содержать минимум 6 символов');
        }
        if (errors.length > 0) {
            return res.status(400).json({ success: false, errors });
        }

        // Проверка существующего пользователя
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Пользователь уже существует' });
        }

        // Хэширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password, nickname) VALUES ($1, $2, $3) RETURNING id, email, nickname',
            [email, hashedPassword, nickname || 'Пользователь']
        );

        // Сохраняем в сессии
        req.session.userId = result.rows[0].id;
        req.session.userEmail = result.rows[0].email;
        
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Валидация
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Пользователь не найден' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Неверный пароль' });
        }

        req.session.userId = user.id;
        req.session.userEmail = user.email;
        
        res.json({
            success: true,
            user: { id: user.id, email: user.email, nickname: user.nickname }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Получить текущего пользователя
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    pool.query('SELECT id, email, nickname, avatar FROM users WHERE id = $1', [req.session.userId])
        .then(result => {
            if (result.rows.length === 0) return res.status(404).json({ success: false });
            res.json({ success: true, user: result.rows[0] });
        })
        .catch(err => res.status(500).json({ success: false, message: 'Ошибка' }));
});

// Обновить профиль
app.put('/api/user', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    try {
        const { nickname, avatar } = req.body;
        const result = await pool.query(
            'UPDATE users SET nickname = COALESCE($1, nickname), avatar = COALESCE($2, avatar) WHERE id = $3 RETURNING *',
            [nickname, avatar, req.session.userId]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка' });
    }
});

// ================= API: КОРЗИНА (В БД) =================
// Получить корзину текущего пользователя
app.get('/api/cart', async (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: true, cart: [] }); 
    }
    try {
        const result = await pool.query(`
            SELECT ci.book_id, ci.quantity, b.title, b.author, b.price, b.image
            FROM cart_items ci
            JOIN books b ON ci.book_id = b.id
            WHERE ci.user_id = $1
        `, [req.session.userId]);
        res.json({ success: true, cart: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка получения корзины' });
    }
});

// Добавить в корзину
app.post('/api/cart/add', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    const { bookId, quantity = 1 } = req.body;
    try {
        // Проверяем, есть ли книга в корзине
        const existing = await pool.query(
            'SELECT id, quantity FROM cart_items WHERE user_id = $1 AND book_id = $2',
            [req.session.userId, bookId]
        );

        if (existing.rows.length > 0) {
            // Обновляем количество
            const newQuantity = existing.rows[0].quantity + quantity;
            await pool.query(
                'UPDATE cart_items SET quantity = $1 WHERE id = $2',
                [newQuantity, existing.rows[0].id]
            );
        } else {
            // Добавляем новую книгу
            await pool.query(
                'INSERT INTO cart_items (user_id, book_id, quantity) VALUES ($1, $2, $3)',
                [req.session.userId, bookId, quantity]
            );
        }
        res.json({ success: true, message: 'Книга добавлена в корзину' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка добавления в корзину' });
    }
});

// Обновить количество в корзине
app.post('/api/cart/update', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { bookId, quantity } = req.body;
    try {
        if (quantity <= 0) {
            await pool.query(
                'DELETE FROM cart_items WHERE user_id = $1 AND book_id = $2',
                [req.session.userId, bookId]
            );
        } else {
            await pool.query(
                'UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND book_id = $3',
                [quantity, req.session.userId, bookId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка обновления корзины' });
    }
});

// Очистить корзину
app.post('/api/cart/clear', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        await pool.query('DELETE FROM cart_items WHERE user_id = $1', [req.session.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка очистки корзины' });
    }
});

// ================= API: ЗАКАЗЫ И "ЛАРЧИК" =================
app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: 'Не авторизован' });
        }

        // Получаем книги из корзины пользователя
        const cartResult = await client.query(
            'SELECT ci.book_id, ci.quantity, b.price FROM cart_items ci JOIN books b ON ci.book_id = b.id WHERE ci.user_id = $1',
            [req.session.userId]
        );

        const items = cartResult.rows;
        if (items.length === 0) {
            return res.status(400).json({ success: false, message: 'Корзина пуста' });
        }

        await client.query('BEGIN');

        // Считаем сумму
        let totalAmount = 0;
        for (const item of items) {
            totalAmount += parseFloat(item.price) * item.quantity;
        }

        // Создаём заказ
        const orderResult = await client.query(
            'INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING id',
            [req.session.userId, totalAmount]
        );
        const orderId = orderResult.rows[0].id;

        // Добавляем позиции заказа и обновляем "Ларчик"
        for (const item of items) {
            const book = await client.query('SELECT title FROM books WHERE id = $1', [item.book_id]);
            
            // 1. Добавляем в order_items
            await client.query(
                'INSERT INTO order_items (order_id, book_id, title, price, quantity) VALUES ($1, $2, $3, $4, $5)',
                [orderId, item.book_id, book.rows[0].title, item.price, item.quantity]
            );

            // 2. Добавляем в user_library ("Ларчик")
            // Используем ON CONFLICT, чтобы не дублировать записи, если книга уже куплена
            await client.query(`
                INSERT INTO user_library (user_id, book_id, status) 
                VALUES ($1, $2, 'purchased')
                ON CONFLICT (user_id, book_id) DO NOTHING
            `, [req.session.userId, item.book_id]);

            // 3. Уменьшаем остаток на складе
            await client.query('UPDATE books SET stock = stock - $1 WHERE id = $2', [item.quantity, item.book_id]);
        }

        // Очищаем корзину после заказа
        await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.session.userId]);

        await client.query('COMMIT');
        res.json({ success: true, orderId, totalAmount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});

// Получить "Ларчик" (библиотеку пользователя)
app.get('/api/library', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    try {
        const result = await pool.query(`
            SELECT ul.id, ul.status, ul.purchased_at, b.*
            FROM user_library ul
            JOIN books b ON ul.book_id = b.id
            WHERE ul.user_id = $1
            ORDER BY ul.purchased_at DESC
        `, [req.session.userId]);
        res.json({ success: true, library: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка получения библиотеки' });
    }
});

// Обновить статус книги в ларчике (прочитано/отложено)
app.put('/api/library/:id/status', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { status } = req.body; // 'read', 'saved', 'purchased'
    try {
        await pool.query(
            'UPDATE user_library SET status = $1 WHERE id = $2 AND user_id = $3',
            [status, req.params.id, req.session.userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка обновления статуса' });
    }
});

// Мои заказы (история покупок)
app.get('/api/orders', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    try {
        const result = await pool.query(`
            SELECT o.*,
            json_agg(json_build_object('title', oi.title, 'price', oi.price, 'quantity', oi.quantity)) as items
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = $1
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `, [req.session.userId]);
        res.json({ success: true, orders: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка' });
    }
});

// ================= ЗАПУСК =================
app.listen(PORT, () => {
    console.log(`
Сервер запущен: http://localhost:${PORT}`);
    console.log(`Каталог: http://localhost:${PORT}/catalog`);
    console.log(`Корзина: http://localhost:${PORT}/cart`);
    console.log(`Профиль: http://localhost:${PORT}/profile`);
    console.log(`Вход: http://localhost:${PORT}/login`);
});