// ==========================================
// 1. CONFIGURACIÓN INICIAL
// ==========================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

const app = express();

// Configuración SQL Server
const config = {
    server: process.env.SERVER,
    database: process.env.DATABASE,
    user: process.env.USER,
    password: process.env.PASSWORD,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

// Configuración de multer para imágenes
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'public/img/libros'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Solo imágenes: jpg, jpeg, png, gif, webp'));
    }
});

// ==========================================
// 2. MIDDLEWARE
// ==========================================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

app.use((req, res, next) => {
    res.locals.userId = req.session.userId;
    res.locals.idRol = req.session.idRol;
    res.locals.nombre = req.session.nombre;
    next();
});

// Conexión a BD
sql.connect(config).then(pool => {
    if (pool.connected) {
        console.log('✅ Conectado a SQL Server');
        global.db = pool;
    }
}).catch(err => console.error('❌ Error de conexión:', err));

// Funciones de autenticación
const isAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/login');
};

const isBibliotecario = (req, res, next) => {
    if (req.session.idRol === 1 || req.session.idRol === 2) return next();
    res.status(403).send('Acceso denegado');
};

const isAdmin = (req, res, next) => {
    if (req.session.idRol === 1) return next();
    res.status(403).send('Acceso denegado');
};

// ==========================================
// 3. AUTH (LOGIN/LOGOUT)
// ==========================================

app.get('/login', (req, res) => {
    res.render('auth/login', { error: null });
});

app.post('/login', async (req, res) => {
    const { correo, contraseña } = req.body;
    
    try {
        const result = await db.query`
            SELECT * FROM Usuarios WHERE Correo = ${correo} AND Activo = 1
        `;
        
        if (result.recordset.length === 0) {
            return res.render('auth/login', { error: 'Usuario no encontrado' });
        }
        
        const user = result.recordset[0];
        const passwordMatch = await bcrypt.compare(contraseña, user.ContraseñaHash);
        
        if (!passwordMatch) {
            return res.render('auth/login', { error: 'Contraseña incorrecta' });
        }
        
        req.session.userId = user.IdUsuario;
        req.session.idRol = user.IdRol;
        req.session.nombre = user.Nombre + ' ' + user.ApellidoPaterno;
        
        if (user.IdRol === 1 || user.IdRol === 2) {
            res.redirect('/admin/dashboard');
        } else {
            res.redirect('/user/biblioteca');
        }
    } catch (err) {
        console.error(err);
        res.render('auth/login', { error: 'Error de conexión' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/', (req, res) => res.redirect('/login'));

// ==========================================
// 4. ADMIN - DASHBOARD
// ==========================================

app.get('/admin/dashboard', isAuth, isBibliotecario, async (req, res) => {
    try {
        const libros = await db.query`SELECT COUNT(*) as total FROM Libros`;
        const ejemplares = await db.query`SELECT COUNT(*) as total FROM Ejemplares WHERE Activo = 1`;
        const prestamos = await db.query`SELECT COUNT(*) as total FROM Prestamos WHERE IdEstadoPrestamo = 1`;
        const socios = await db.query`SELECT COUNT(*) as total FROM Usuarios WHERE IdRol = 3 AND Activo = 1`;
        
        res.render('admin/dashboard', {
            totalLibros: libros.recordset[0].total,
            totalEjemplares: ejemplares.recordset[0].total,
            prestamosActivos: prestamos.recordset[0].total,
            totalSocios: socios.recordset[0].total
        });
    } catch (err) {
        console.error('Error dashboard:', err);
        res.render('admin/dashboard', { totalLibros: 0, totalEjemplares: 0, prestamosActivos: 0, totalSocios: 0 });
    }
});

// ==========================================
// 5. ADMIN - LIBROS
// ==========================================

// Lista de libros
app.get('/admin/libros', isAuth, isBibliotecario, async (req, res) => {
    try {
        const result = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            ORDER BY l.Titulo
        `;
        
        res.render('admin/libros', { libros: result.recordset });
    } catch (err) {
        console.error('Error:', err);
        res.render('admin/libros', { libros: [] });
    }
});

// Ver formulario nuevo libro (GET)
app.get('/admin/libros/nuevo', isAuth, isBibliotecario, async (req, res) => {
    try {
        const generos = await db.query`SELECT * FROM Generos`;
        const editoriales = await db.query`SELECT * FROM Editoriales`;
        const ubicaciones = await db.query`SELECT * FROM Ubicaciones`;
        const todosAutores = await db.query`SELECT * FROM Autores`;
        
        res.render('admin/libro-form', { 
            libro: null, 
            generos: generos.recordset, 
            editoriales: editoriales.recordset, 
            ubicaciones: ubicaciones.recordset,
            todosAutores: todosAutores.recordset
        });
    } catch (err) {
        console.error('Error:', err);
        res.redirect('/admin/libros');
    }
});

// Guardar nuevo libro (POST)
app.post('/admin/libros/nuevo', isAuth, isBibliotecario, upload.single('imagen'), async (req, res) => {
    const { titulo, isbn, ano, genero, editorial, ubicacion, sinopsis, cantidad, autores } = req.body;
    
    try {
        const result = await db.query`
            INSERT INTO Libros (Titulo, ISBN, AnoPublicacion, IdGenero, IdEditorial, Sinopsis)
            VALUES (${titulo}, ${isbn}, ${parseInt(ano)}, ${parseInt(genero)}, ${parseInt(editorial)}, ${sinopsis})
            SELECT SCOPE_IDENTITY() as IdLibro
        `;
        
        const idLibro = result.recordset[0].IdLibro;
        const cant = parseInt(cantidad) || 1;
        
        for (let i = 0; i < cant; i++) {
            const codigoBarra = isbn + '-' + (i + 1);
            await db.query`
                INSERT INTO Ejemplares (IdLibro, IdEstadoMaterial, IdUbicacion, CodigoBarra, FechaAdquisicion, Activo)
                VALUES (${idLibro}, 2, ${parseInt(ubicacion)}, ${codigoBarra}, GETDATE(), 1)
            `;
        }
        
        if (autores) {
            const arr = Array.isArray(autores) ? autores : [autores];
            for (const idAutor of arr) {
                await db.query`INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES (${idLibro}, ${idAutor})`;
            }
        }
        
        res.redirect('/admin/libros');
    } catch (err) {
        console.error('Error guardar libro:', err);
        res.send('Error al guardar libro');
    }
});

// Ver detalles del libro
app.get('/admin/libros/:id', isAuth, isBibliotecario, async (req, res) => {
    try {
        const libro = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            WHERE l.IdLibro = ${req.params.id}
        `;
        
        if (libro.recordset.length === 0) {
            return res.redirect('/admin/libros');
        }
        
        const ejemplares = await db.query`
            SELECT e.*, u.NombreUbicacion, em.NombreEstado as estadoMaterial
            FROM Ejemplares e
            LEFT JOIN Ubicaciones u ON e.IdUbicacion = u.IdUbicacion
            LEFT JOIN EstadosMaterial em ON e.IdEstadoMaterial = em.IdEstadoMaterial
            WHERE e.IdLibro = ${req.params.id}
        `;
        
        let disponiblesCount = 0;
        if (ejemplares.recordset && ejemplares.recordset.length > 0) {
            disponiblesCount = ejemplares.recordset.filter(e => e.Activo === 1).length;
        }
        
        const autores = await db.query`
            SELECT a.* FROM Autores a
            JOIN LibroAutor la ON a.IdAutor = la.IdAutor
            WHERE la.IdLibro = ${req.params.id}
        `;
        
        res.render('admin/libro-detalle', { 
            libro: libro.recordset[0], 
            ejemplares: ejemplares.recordset || [],
            autores: autores.recordset || [],
            historial: [],
            disponiblesCount: disponiblesCount
        });
    } catch (err) {
        console.error('Error detalle libro:', err);
        res.redirect('/admin/libros');
    }
});

// Editar libro (GET)
app.get('/admin/libros/editar/:id', isAuth, isBibliotecario, async (req, res) => {
    try {
        const libro = await db.query`SELECT * FROM Libros WHERE IdLibro = ${req.params.id}`;
        const generos = await db.query`SELECT * FROM Generos`;
        const editoriales = await db.query`SELECT * FROM Editoriales`;
        const ubicaciones = await db.query`SELECT * FROM Ubicaciones`;
        const autores = await db.query`SELECT a.IdAutor FROM Autores a JOIN LibroAutor la ON a.IdAutor = la.IdAutor WHERE la.IdLibro = ${req.params.id}`;
        const autoresIds = autores.recordset.map(a => a.IdAutor);
        const todosAutores = await db.query`SELECT * FROM Autores`;
        
        res.render('admin/libro-form', { 
            libro: libro.recordset[0], 
            generos: generos.recordset, 
            editoriales: editoriales.recordset, 
            ubicaciones: ubicaciones.recordset,
            autoresIds: autoresIds,
            todosAutores: todosAutores.recordset
        });
    } catch (err) {
        console.error('Error:', err);
        res.redirect('/admin/libros');
    }
});

// Editar libro (POST)
app.post('/admin/libros/editar/:id', isAuth, isBibliotecario, async (req, res) => {
    const { titulo, isbn, ano, genero, editorial, sinopsis, autores } = req.body;
    
    try {
        await db.query`
            UPDATE Libros 
            SET Titulo = ${titulo}, ISBN = ${isbn}, AnoPublicacion = ${parseInt(ano)},
                IdGenero = ${parseInt(genero)}, IdEditorial = ${parseInt(editorial)}, Sinopsis = ${sinopsis}
            WHERE IdLibro = ${req.params.id}
        `;
        
        await db.query`DELETE FROM LibroAutor WHERE IdLibro = ${req.params.id}`;
        
        if (autores) {
            const arr = Array.isArray(autores) ? autores : [autores];
            for (const idAutor of arr) {
                await db.query`INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES (${req.params.id}, ${idAutor})`;
            }
        }
        
        res.redirect('/admin/libros');
    } catch (err) {
        console.error('Error:', err);
        res.redirect('/admin/libros');
    }
});

// Eliminar libro (POST)
app.post('/admin/libros/eliminar/:id', isAuth, isBibliotecario, async (req, res) => {
    try {
        const ejemplares = await db.query`SELECT COUNT(*) as total FROM Ejemplares WHERE IdLibro = ${req.params.id} AND Activo = 1`;
        
        if (ejemplares.recordset[0].total > 0) {
            return res.send('No se puede eliminar: hay ejemplares activos');
        }
        
        await db.query`DELETE FROM LibroAutor WHERE IdLibro = ${req.params.id}`;
        await db.query`DELETE FROM Ejemplares WHERE IdLibro = ${req.params.id}`;
        await db.query`DELETE FROM Libros WHERE IdLibro = ${req.params.id}`;
        
        res.redirect('/admin/libros');
    } catch (err) {
        console.error('Error:', err);
        res.redirect('/admin/libros');
    }
});

// ==================== ADMIN - USUARIOS ====================

// 1. Lista de usuarios
app.get('/admin/usuarios', isAuth, isAdmin, async (req, res) => {
    const result = await db.query`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        ORDER BY u.FechaRegistro DESC
    `;
    res.render('admin/usuarios', { usuarios: result.recordset });
});

// 2. Ver formulario nuevo usuario (GET)
app.get('/admin/usuarios/nuevo', isAuth, isAdmin, async (req, res) => {
    const roles = await db.query`SELECT * FROM Roles WHERE IdRol != 1`; // exclude admin
    res.render('admin/usuario-form', { usuario: null, roles: roles.recordset });
});

// 3. Guardar nuevo usuario (POST)
app.post('/admin/usuarios/nuevo', isAuth, isAdmin, async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, telefono, ciudad, idRol } = req.body;
    
    const passwordHash = await bcrypt.hash(contraseña, 10);
    
    await db.query`
        INSERT INTO Usuarios (Nombre, ApellidoPaterno, ApellidoMaterno, Correo, ContraseñaHash, Telefono, Ciudad, IdRol, Activo)
        VALUES (${nombre}, ${apellidoPaterno}, ${apellidoMaterno || null}, ${correo}, ${passwordHash}, ${telefono || null}, ${ciudad || null}, ${parseInt(idRol)}, 1)
    `;
    
    res.redirect('/admin/usuarios');
});

// 4. Ver detalles del usuario
app.get('/admin/usuarios/:id', isAuth, isAdmin, async (req, res) => {
    const usuario = await db.query`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        WHERE u.IdUsuario = ${req.params.id}
    `;
    
    if (usuario.recordset.length === 0) return res.redirect('/admin/usuarios');
    
    // Préstamos del usuario
    const prestamos = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE p.IdUsuario = ${req.params.id}
        ORDER BY p.FechaPrestamo DESC
    `;
    
    // Multas del usuario
    const multas = await db.query`
        SELECT m.*, l.Titulo
        FROM Multas m
        JOIN Prestamos p ON m.IdPrestamo = p.IdPrestamo
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE p.IdUsuario = ${req.params.id}
    `;
    
    res.render('admin/usuario-detalle', { 
        usuario: usuario.recordset[0],
        prestamos: prestamos.recordset,
        multas: multas.recordset
    });
});

// 5. Formulario editar usuario (GET)
app.get('/admin/usuarios/editar/:id', isAuth, isAdmin, async (req, res) => {
    const usuario = await db.query`SELECT * FROM Usuarios WHERE IdUsuario = ${req.params.id}`;
    const roles = await db.query`SELECT * FROM Roles`;
    
    res.render('admin/usuario-form', { 
        usuario: usuario.recordset[0],
        roles: roles.recordset
    });
});

// 6. Guardar edición usuario (POST) - Including CAMBIO DE ROL
app.post('/admin/usuarios/editar/:id', isAuth, isAdmin, async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, telefono, ciudad, idRol, activo } = req.body;
    
    const activoVal = activo === 'on' || activo === '1' ? 1 : 0;
    
    await db.query`
        UPDATE Usuarios 
        SET Nombre = ${nombre}, 
            ApellidoPaterno = ${apellidoPaterno}, 
            ApellidoMaterno = ${apellidoMaterno || null}, 
            Correo = ${correo},
            Telefono = ${telefono || null}, 
            Ciudad = ${ciudad || null}, 
            IdRol = ${parseInt(idRol)},
            Activo = ${activoVal}
        WHERE IdUsuario = ${req.params.id}
    `;
    
    res.redirect('/admin/usuarios');
});

// 7. Cambiar contraseña (POST)
app.post('/admin/usuarios/password/:id', isAuth, isAdmin, async (req, res) => {
    const { contraseña } = req.body;
    const passwordHash = await bcrypt.hash(contraseña, 10);
    
    await db.query`UPDATE Usuarios SET ContraseñaHash = ${passwordHash} WHERE IdUsuario = ${req.params.id}`;
    
    res.redirect('/admin/usuarios/' + req.params.id);
});

// 8. Eliminar usuario (POST)
app.post('/admin/usuarios/eliminar/:id', isAuth, isAdmin, async (req, res) => {
    await db.query`DELETE FROM Usuarios WHERE IdUsuario = ${req.params.id}`;
    res.redirect('/admin/usuarios');
});

// 9. Cambiar rol rápidamente (POST) - AJAX
app.post('/admin/usuarios/rol/:id', isAuth, isAdmin, async (req, res) => {
    const { idRol } = req.body;
    
    await db.query`UPDATE Usuarios SET IdRol = ${parseInt(idRol)} WHERE IdUsuario = ${req.params.id}`;
    
    res.json({ success: true });
});

// ==================== ADMIN - DASHBOARD ====================

app.get('/admin/dashboard', isAuth, isBibliotecario, async (req, res) => {
    try {
        const libros = await db.query`SELECT COUNT(*) as total FROM Libros`;
        const ejemplares = await db.query`SELECT COUNT(*) as total FROM Ejemplares WHERE Activo = 1`;
        const prestamos = await db.query`SELECT COUNT(*) as total FROM Prestamos WHERE IdEstadoPrestamo = 1`;
        const usuarios = await db.query`SELECT COUNT(*) as total FROM Usuarios WHERE IdRol = 3 AND Activo = 1`;
        
        res.render('admin/dashboard', {
            totalLibros: libros.recordset[0].total,
            totalEjemplares: ejemplares.recordset[0].total,
            prestamosActivos: prestamos.recordset[0].total,
            totalSocios: usuarios.recordset[0].total
        });
    } catch (err) {
        console.error('Error dashboard:', err);
        res.render('admin/dashboard', { totalLibros: 0, totalEjemplares: 0, prestamosActivos: 0, totalSocios: 0 });
    }
});


// ==================== ADMIN - LIBROS ====================

// 1. Lista de libros
app.get('/admin/libros', isAuth, isBibliotecario, async (req, res) => {
    try {
        const result = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            ORDER BY l.Titulo
        `;
        res.render('admin/libros', { libros: result.recordset });
    } catch (err) {
        console.error('Error:', err);
        res.render('admin/libros', { libros: [] });
    }
});

// 2. Ver formulario nuevo libro (GET)
app.get('/admin/libros/nuevo', isAuth, isBibliotecario, async (req, res) => {
    const generos = await db.query`SELECT * FROM Generos`;
    const editoriales = await db.query`SELECT * FROM Editoriales`;
    const ubicaciones = await db.query`SELECT * FROM Ubicaciones`;
    const todosAutores = await db.query`SELECT * FROM Autores`;
    
    res.render('admin/libro-form', { 
        libro: null, 
        generos: generos.recordset, 
        editoriales: editoriales.recordset, 
        ubicaciones: ubicaciones.recordset,
        todosAutores: todosAutores.recordset
    });
});

// 3. Guardar nuevo libro (POST)
app.post('/admin/libros/nuevo', isAuth, isBibliotecario, upload.single('imagen'), async (req, res) => {
    const { titulo, isbn, ano, genero, editorial, ubicacion, sinopsis, cantidad, autores } = req.body;
    
    const result = await db.query`
        INSERT INTO Libros (Titulo, ISBN, AnoPublicacion, IdGenero, IdEditorial, Sinopsis)
        VALUES (${titulo}, ${isbn}, ${parseInt(ano)}, ${parseInt(genero)}, ${parseInt(editorial)}, ${sinopsis})
        SELECT SCOPE_IDENTITY() as IdLibro
    `;
    
    const idLibro = result.recordset[0].IdLibro;
    const cant = parseInt(cantidad) || 1;
    
    for (let i = 0; i < cant; i++) {
        const codigoBarra = isbn + '-' + (i + 1);
        await db.query`
            INSERT INTO Ejemplares (IdLibro, IdEstadoMaterial, IdUbicacion, CodigoBarra, FechaAdquisicion, Activo)
            VALUES (${idLibro}, 2, ${parseInt(ubicacion)}, ${codigoBarra}, GETDATE(), 1)
        `;
    }
    
    if (autores) {
        const arr = Array.isArray(autores) ? autores : [autores];
        for (const idAutor of arr) {
            await db.query`INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES (${idLibro}, ${idAutor})`;
        }
    }
    
    res.redirect('/admin/libros');
});

// 4. Ver detalles del libro
app.get('/admin/libros/:id', isAuth, isBibliotecario, async (req, res) => {
    const libro = await db.query`
        SELECT l.*, g.NombreGenero, e.NombreEditorial
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
        WHERE l.IdLibro = ${req.params.id}
    `;
    
    if (libro.recordset.length === 0) return res.redirect('/admin/libros');
    
    const ejemplares = await db.query`
        SELECT e.*, u.NombreUbicacion, em.NombreEstado as estadoMaterial
        FROM Ejemplares e
        LEFT JOIN Ubicaciones u ON e.IdUbicacion = u.IdUbicacion
        LEFT JOIN EstadosMaterial em ON e.IdEstadoMaterial = em.IdEstadoMaterial
        WHERE e.IdLibro = ${req.params.id}
    `;
    
    let disponiblesCount = 0;
    if (ejemplares.recordset && ejemplares.recordset.length > 0) {
        disponiblesCount = ejemplares.recordset.filter(e => e.Activo === 1).length;
    }
    
    const autores = await db.query`SELECT a.* FROM Autores a JOIN LibroAutor la ON a.IdAutor = la.IdAutor WHERE la.IdLibro = ${req.params.id}`;
    
    const historial = await db.query`SELECT TOP 10 p.*, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario FROM Prestamos p JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar JOIN Usuarios u ON p.IdUsuario = u.IdUsuario WHERE e.IdLibro = ${req.params.id} ORDER BY p.FechaPrestamo DESC`;
    
    res.render('admin/libro-detalle', { 
        libro: libro.recordset[0], 
        ejemplares: ejemplares.recordset || [],
        autores: autores.recordset || [],
        historial: historial.recordset || [],
        disponiblesCount: disponiblesCount
    });
});

// 5. Formulario editar libro (GET)
app.get('/admin/libros/editar/:id', isAuth, isBibliotecario, async (req, res) => {
    const libro = await db.query`SELECT * FROM Libros WHERE IdLibro = ${req.params.id}`;
    const generos = await db.query`SELECT * FROM Generos`;
    const editoriales = await db.query`SELECT * FROM Editoriales`;
    const ubicaciones = await db.query`SELECT * FROM Ubicaciones`;
    const autores = await db.query`SELECT a.IdAutor FROM Autores a JOIN LibroAutor la ON a.IdAutor = la.IdAutor WHERE la.IdLibro = ${req.params.id}`;
    const autoresIds = autores.recordset.map(a => a.IdAutor);
    const todosAutores = await db.query`SELECT * FROM Autores`;
    
    res.render('admin/libro-form', { 
        libro: libro.recordset[0], 
        generos: generos.recordset, 
        editoriales: editoriales.recordset, 
        ubicaciones: ubicaciones.recordset,
        autoresIds: autoresIds,
        todosAutores: todosAutores.recordset
    });
});

// 6. Guardar edición libro (POST)
app.post('/admin/libros/editar/:id', isAuth, isBibliotecario, async (req, res) => {
    const { titulo, isbn, ano, genero, editorial, sinopsis, autores } = req.body;
    
    await db.query`
        UPDATE Libros 
        SET Titulo = ${titulo}, ISBN = ${isbn}, AnoPublicacion = ${parseInt(ano)},
            IdGenero = ${parseInt(genero)}, IdEditorial = ${parseInt(editorial)}, Sinopsis = ${sinopsis}
        WHERE IdLibro = ${req.params.id}
    `;
    
    await db.query`DELETE FROM LibroAutor WHERE IdLibro = ${req.params.id}`;
    
    if (autores) {
        const arr = Array.isArray(autores) ? autores : [autores];
        for (const idAutor of arr) {
            await db.query`INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES (${req.params.id}, ${idAutor})`;
        }
    }
    
    res.redirect('/admin/libros');
});

// 7. Eliminar libro (POST)
app.post('/admin/libros/eliminar/:id', isAuth, isBibliotecario, async (req, res) => {
    const ejemplares = await db.query`SELECT COUNT(*) as total FROM Ejemplares WHERE IdLibro = ${req.params.id} AND Activo = 1`;
    
    if (ejemplares.recordset[0].total > 0) {
        return res.send('No se puede eliminar el libro porque tiene ejemplares activos.');
    }
    
    await db.query`DELETE FROM LibroAutor WHERE IdLibro = ${req.params.id}`;
    await db.query`DELETE FROM Ejemplares WHERE IdLibro = ${req.params.id}`;
    await db.query`DELETE FROM Libros WHERE IdLibro = ${req.params.id}`;
    
    res.redirect('/admin/libros');
});


// ==================== ADMIN - USUARIOS ====================

// 1. Lista de usuarios
app.get('/admin/usuarios', isAuth, isAdmin, async (req, res) => {
    const result = await db.query`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        ORDER BY u.FechaRegistro DESC
    `;
    res.render('admin/usuarios', { usuarios: result.recordset });
});

// 2. formulario nuevo usuario (GET)
app.get('/admin/usuarios/nuevo', isAuth, isAdmin, async (req, res) => {
    const roles = await db.query`SELECT * FROM Roles WHERE IdRol != 1`;
    res.render('admin/usuario-form', { usuario: null, roles: roles.recordset });
});

// 3. Guardar nuevo usuario (POST)
app.post('/admin/usuarios/nuevo', isAuth, isAdmin, async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, telefono, ciudad, idRol } = req.body;
    
    // Encriptar contraseña
    const passwordHash = await bcrypt.hash(contraseña, 10);
    
    await db.query`
        INSERT INTO Usuarios (Nombre, ApellidoPaterno, ApellidoMaterno, Correo, ContraseñaHash, Telefono, Ciudad, IdRol, Activo)
        VALUES (${nombre}, ${apellidoPaterno}, ${apellidoMaterno || null}, ${correo}, ${passwordHash}, ${telefono || null}, ${ciudad || null}, ${parseInt(idRol)}, 1)
    `;
    
    res.redirect('/admin/usuarios');
});

// 4. Ver detalles del usuario
app.get('/admin/usuarios/:id', isAuth, isAdmin, async (req, res) => {
    const usuario = await db.query`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        WHERE u.IdUsuario = ${req.params.id}
    `;
    
    if (usuario.recordset.length === 0) return res.redirect('/admin/usuarios');
    
    // obtener préstamos del usuario
    const prestamos = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE p.IdUsuario = ${req.params.id}
        ORDER BY p.FechaPrestamo DESC
    `;
    
    res.render('admin/usuario-detalle', { 
        usuario: usuario.recordset[0],
        prestamos: prestamos.recordset
    });
});

// 5. Formulario editar usuario (GET)
app.get('/admin/usuarios/editar/:id', isAuth, isAdmin, async (req, res) => {
    const usuario = await db.query`SELECT * FROM Usuarios WHERE IdUsuario = ${req.params.id}`;
    const roles = await db.query`SELECT * FROM Roles`;
    
    res.render('admin/usuario-form', { 
        usuario: usuario.recordset[0],
        roles: roles.recordset
    });
});

// 6. Guardar edición usuario (POST)
app.post('/admin/usuarios/editar/:id', isAuth, isAdmin, async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, telefono, ciudad, idRol, activo } = req.body;
    
    await db.query`
        UPDATE Usuarios 
        SET Nombre = ${nombre}, 
            ApellidoPaterno = ${apellidoPaterno}, 
            ApellidoMaterno = ${apellidoMaterno || null}, 
            Correo = ${correo},
            Telefono = ${telefono || null}, 
            Ciudad = ${ciudad || null}, 
            IdRol = ${parseInt(idRol)},
            Activo = ${activo === 'on' ? 1 : 0}
        WHERE IdUsuario = ${req.params.id}
    `;
    
    res.redirect('/admin/usuarios');
});

// 7. Cambiar contraseña (POST)
app.post('/admin/usuarios/password/:id', isAuth, isAdmin, async (req, res) => {
    const { contraseña } = req.body;
    const passwordHash = await bcrypt.hash(contraseña, 10);
    
    await db.query`UPDATE Usuarios SET ContraseñaHash = ${passwordHash} WHERE IdUsuario = ${req.params.id}`;
    
    res.redirect('/admin/usuarios');
});

// ==================== ADMIN - PRÉSTAMOS ====================

// 1. Lista de préstamos
app.get('/admin/prestamos', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY p.FechaPrestamo DESC
    `;
    res.render('admin/prestamos', { prestamos: result.recordset });
});

// 2. Formulario nuevo préstamo (GET)
app.get('/admin/prestamos/nuevo', isAuth, isBibliotecario, async (req, res) => {
    const usuarios = await db.query`
        SELECT * FROM Usuarios WHERE IdRol = 3 AND Activo = 1
    `;
    const ejemplares = await db.query`
        SELECT e.*, l.Titulo
        FROM Ejemplares e
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE e.Activo = 1
    `;
    res.render('admin/prestamo-form', { 
        usuarios: usuarios.recordset, 
        ejemplares: ejemplares.recordset 
    });
});

// 3. Guardar nuevo préstamo (POST)
app.post('/admin/prestamos/nuevo', isAuth, isBibliotecario, async (req, res) => {
    const { IdUsuario, IdEjemplar, dias } = req.body;
    const diasPrestamo = parseInt(dias) || 15;
    const fechaDevolucion = new Date();
    fechaDevolucion.setDate(fechaDevolucion.getDate() + diasPrestamo);
    
    try {
        await db.query`
            INSERT INTO Prestamos (IdUsuario, IdEjemplar, FechaDevolucionEsperada, IdEstadoPrestamo)
            VALUES (${IdUsuario}, ${IdEjemplar}, ${fechaDevolucion}, 1)
        `;
        
        res.redirect('/admin/prestamos');
    } catch (err) {
        console.error('Error:', err);
        res.send('Error al realizar préstamo');
    }
});

// 4. Devolver libro (POST) - con cálculo automático de multa
app.post('/admin/prestamos/devolver/:id', isAuth, isBibliotecario, async (req, res) => {
    const fechaActual = new Date().toISOString().split('T')[0];
    
    try {
        // Obtener préstamo actual
        const prestamo = await db.query`
            SELECT * FROM Prestamos WHERE IdPrestamo = ${req.params.id}
        `;
        const p = prestamo.recordset[0];
        
        // Calcular multa si hay retraso
        const fechaEsperada = new Date(p.FechaDevolucionEsperada).toISOString().split('T')[0];
        let multa = 0;
        
        if (fechaActual > fechaEsperada) {
            const diff = Math.ceil((new Date(fechaActual) - new Date(fechaEsperada)) / (1000 * 60 * 60 * 24));
            multa = diff * 10; // $10 por día de retraso
        }
        
        // Actualizar préstamo a devuelto
        await db.query`
            UPDATE Prestamos 
            SET FechaDevolucionReal = ${fechaActual}, IdEstadoPrestamo = 2
            WHERE IdPrestamo = ${req.params.id}
        `;
        
        // Registrar multa si hay retraso
        if (multa > 0) {
            await db.query`
                INSERT INTO Multas (IdPrestamo, Monto)
                VALUES (${req.params.id}, ${multa})
            `;
            console.log(`⚠️ Multa generada: $${multa}`);
        }
        
        // Activar ejemplar de nuevo
        await db.query`
            UPDATE Ejemplares SET Activo = 1 WHERE IdEjemplar = ${p.IdEjemplar}
        `;
        
        res.redirect('/admin/prestamos');
    } catch (err) {
        console.error('Error:', err);
        res.send('Error al devolver');
    }
});

// 5. Renovar préstamo (POST)
app.post('/admin/prestamos/renovar/:id', isAuth, isBibliotecario, async (req, res) => {
    const dias = parseInt(req.body.dias) || 10;
    
    try {
        const prestamo = await db.query`
            SELECT * FROM Prestamos WHERE IdPrestamo = ${req.params.id}
        `;
        
        if (prestamo.recordset.length === 0) {
            return res.redirect('/admin/prestamos');
        }
        
        const p = prestamo.recordset[0];
        
        // Calcular nueva fecha
        const fechaActual = new Date(p.FechaDevolucionEsperada);
        fechaActual.setDate(fechaActual.getDate() + dias);
        const nuevaFecha = fechaActual.toISOString().split('T')[0];
        
        // Actualizar fecha
        await db.query`
            UPDATE Prestamos 
            SET FechaDevolucionEsperada = ${nuevaFecha}, IdEstadoPrestamo = 1
            WHERE IdPrestamo = ${req.params.id}
        `;
        
        res.redirect('/admin/prestamos');
    } catch (err) {
        console.error('Error:', err);
        res.redirect('/admin/prestamos');
    }
});

// 6. Ver detalles del préstamo
app.get('/admin/prestamos/:id', isAuth, isBibliotecario, async (req, res) => {
    const prestamo = await db.query`
        SELECT p.*, l.Titulo, l.ISBN, e.CodigoBarra, 
               u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario, u.Correo
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        WHERE p.IdPrestamo = ${req.params.id}
    `;
    
    // Obtener multa si existe
    const multa = await db.query`
        SELECT * FROM Multas WHERE IdPrestamo = ${req.params.id}
    `;
    
    res.render('admin/prestamo-detalle', { 
        prestamo: prestamo.recordset[0],
        multa: multa.recordset[0] || null
    });
});

// 7. Eliminar/Cancelar préstamo (POST)
app.post('/admin/prestamos/cancelar/:id', isAuth, isBibliotecario, async (req, res) => {
    try {
        const prestamo = await db.query`
            SELECT * FROM Prestamos WHERE IdPrestamo = ${req.params.id}
        `;
        const p = prestamo.recordset[0];
        
        // Liberar ejemplar
        await db.query`
            UPDATE Ejemplares SET Activo = 1 WHERE IdEjemplar = ${p.IdEjemplar}
        `;
        
        // Eliminar préstamo
        await db.query`
            DELETE FROM Prestamos WHERE IdPrestamo = ${req.params.id}
        `;
        
        res.redirect('/admin/prestamos');
    } catch (err) {
        res.redirect('/admin/prestamos');
    }
});

// ==================== ADMIN - MULTAS ====================

// 1. Lista de multas
app.get('/admin/multas', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT m.*, p.FechaPrestamo, p.FechaDevolucionEsperada, p.FechaDevolucionReal,
               l.Titulo, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario
        FROM Multas m
        JOIN Prestamos p ON m.IdPrestamo = p.IdPrestamo
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY m.FechaCalculo DESC
    `;
    res.render('admin/multas', { multas: result.recordset });
});

// 2. Ver multas de un usuario
app.get('/admin/multas/usuario/:id', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT m.*, p.FechaPrestamo, l.Titulo
        FROM Multas m
        JOIN Prestamos p ON m.IdPrestamo = p.IdPrestamo
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE p.IdUsuario = ${req.params.id}
        ORDER BY m.FechaCalculo DESC
    `;
    res.render('admin/multas', { multas: result.recordset });
});

// 3. Pagar multa (POST)
app.post('/admin/multas/pagar/:id', isAuth, isBibliotecario, async (req, res) => {
    const fechaPago = new Date().toISOString().split('T')[0];
    
    await db.query`
        UPDATE Multas 
        SET Pagado = 1, FechaPago = ${fechaPago}
        WHERE IdMulta = ${req.params.id}
    `;
    
    res.redirect('/admin/multas');
});

// 4. Eliminar multa (POST)
app.post('/admin/multas/eliminar/:id', isAuth, isAdmin, async (req, res) => {
    await db.query`DELETE FROM Multas WHERE IdMulta = ${req.params.id}`;
    res.redirect('/admin/multas');
});

// 5. Total multas pendientes (para dashboard)
app.get('/api/multas/pendientes', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT SUM(Monto) as total FROM Multas WHERE Pagado = 0
    `;
    res.json({ total: result.recordset[0].total || 0 });
});

// ==================== ADMIN - REPORTES ====================

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// 1. Reporte de Libros - PDF
app.get('/admin/reportes/libros/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT l.Titulo, l.ISBN, l.AnoPublicacion, g.NombreGenero, e.NombreEditorial,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro) as totalEjemplares,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
        ORDER BY l.Titulo
    `;
    
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-libros.pdf');
    doc.pipe(res);
    
    // Título
    doc.fontSize(20).text('Reporte de Libros', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { align: 'center' });
    doc.moveDown(2);
    
    // Tabla
    let y = 150;
    doc.fontSize(9).text('Título', 50, y).text('ISBN', 200, y).text('Género', 280, y).text('Ejemplares', 380, y).text('Disponibles', 450, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(libro => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.text(libro.Titulo.substring(0, 25), 50, y);
        doc.text(libro.ISBN || '-', 200, y);
        doc.text(libro.NombreGenero || '-', 280, y);
        doc.text(libro.totalEjemplares.toString(), 380, y);
        doc.text(libro.disponibles.toString(), 450, y);
        y += 20;
    });
    
    doc.end();
});

// 2. Reporte de Libros - Excel
app.get('/admin/reportes/libros/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT l.Titulo, l.ISBN, l.AnoPublicacion, g.NombreGenero, e.NombreEditorial,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro) as totalEjemplares,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
        ORDER BY l.Titulo
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Libros');
    
    sheet.columns = [
        { header: 'Título', key: 'titulo' },
        { header: 'ISBN', key: 'isbn' },
        { header: 'Año', key: 'ano' },
        { header: 'Género', key: 'genero' },
        { header: 'Editorial', key: 'editorial' },
        { header: 'Total Ejemplares', key: 'total' },
        { header: 'Disponibles', key: 'disponibles' }
    ];
    
    result.recordset.forEach(libro => {
        sheet.addRow({
            titulo: libro.Titulo,
            isbn: libro.ISBN || '',
            ano: libro.AnoPublicacion || '',
            genero: libro.NombreGenero || '',
            editorial: libro.NombreEditorial || '',
            total: libro.totalEjemplares,
            disponibles: libro.disponibles
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-libros.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// 3. Reporte de Multas - PDF
app.get('/admin/reportes/multas/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT m.*, l.Titulo, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario
        FROM Multas m
        JOIN Prestamos p ON m.IdPrestamo = p.IdPrestamo
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY m.FechaCalculo DESC
    `;
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-multas.pdf');
    doc.pipe(res);
    
    doc.fontSize(20).text('Reporte de Multas', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { align: 'center' });
    doc.moveDown(2);
    
    let y = 150;
    doc.fontSize(9).text('Usuario', 50, y).text('Libro', 180, y).text('Monto', 350, y).text('Estado', 420, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(multa => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.text(multa.nombreUsuario, 50, y);
        doc.text(multa.Titulo.substring(0, 20), 180, y);
        doc.text(`$${multa.Monto}`, 350, y);
        doc.text(multa.Pagado ? 'Pagado' : 'Pendiente', 420, y);
        y += 20;
    });
    
    doc.end();
});

// 4. Reporte de Multas - Excel
app.get('/admin/reportes/multas/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT m.*, l.Titulo, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario, u.Correo
        FROM Multas m
        JOIN Prestamos p ON m.IdPrestamo = p.IdPrestamo
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY m.FechaCalculo DESC
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Multas');
    
    sheet.columns = [
        { header: 'Usuario', key: 'usuario' },
        { header: 'Correo', key: 'correo' },
        { header: 'Libro', key: 'libro' },
        { header: 'Monto', key: 'monto' },
        { header: 'Pagado', key: 'pagado' },
        { header: 'Fecha', key: 'fecha' }
    ];
    
    result.recordset.forEach(multa => {
        sheet.addRow({
            usuario: multa.nombreUsuario,
            correo: multa.Correo,
            libro: multa.Titulo,
            monto: multa.Monto,
            pagado: multa.Pagado ? 'Sí' : 'No',
            fecha: new Date(multa.FechaCalculo).toLocaleDateString('es-MX')
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-multas.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// 5. Reporte de Préstamos - PDF
app.get('/admin/reportes/prestamos/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY p.FechaPrestamo DESC
    `;
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-prestamos.pdf');
    doc.pipe(res);
    
    doc.fontSize(20).text('Reporte de Préstamos', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { align: 'center' });
    doc.moveDown(2);
    
    let y = 150;
    doc.fontSize(9).text('Usuario', 50, y).text('Libro', 180, y).text('Fecha Préstamo', 350, y).text('Estado', 450, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(p => {
        if (y > 700) { doc.addPage(); y = 50; }
        const estado = p.IdEstadoPrestamo === 1 ? 'Activo' : (p.IdEstadoPrestamo === 2 ? 'Devuelto' : 'Vencido');
        doc.text(p.nombreUsuario.substring(0, 20), 50, y);
        doc.text(p.Titulo.substring(0, 20), 180, y);
        doc.text(new Date(p.FechaPrestamo).toLocaleDateString('es-MX'), 350, y);
        doc.text(estado, 450, y);
        y += 20;
    });
    
    doc.end();
});

// 6. Reporte de Préstamos - Excel
app.get('/admin/reportes/prestamos/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario, u.Correo
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON p.IdUsuario = u.IdUsuario
        ORDER BY p.FechaPrestamo DESC
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Préstamos');
    
    sheet.columns = [
        { header: 'Usuario', key: 'usuario' },
        { header: 'Correo', key: 'correo' },
        { header: 'Libro', key: 'libro' },
        { header: 'Código', key: 'codigo' },
        { header: 'Fecha Préstamo', key: 'fecha' },
        { header: 'Fecha Esperada', key: 'esperada' },
        { header: 'Fecha Devolución', key: 'devolucion' },
        { header: 'Estado', key: 'estado' }
    ];
    
    result.recordset.forEach(p => {
        let estado = 'Activo';
        if (p.IdEstadoPrestamo === 2) estado = 'Devuelto';
        else if (p.IdEstadoPrestamo === 3) estado = 'Vencido';
        
        sheet.addRow({
            usuario: p.nombreUsuario,
            correo: p.Correo,
            libro: p.Titulo,
            codigo: p.CodigoBarra,
            fecha: new Date(p.FechaPrestamo).toLocaleDateString('es-MX'),
            esperada: new Date(p.FechaDevolucionEsperada).toLocaleDateString('es-MX'),
            devolucion: p.FechaDevolucionReal ? new Date(p.FechaDevolucionReal).toLocaleDateString('es-MX') : '-',
            estado: estado
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-prestamos.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// 7. Reporte de Usuarios - PDF
app.get('/admin/reportes/usuarios/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT u.Nombre, u.ApellidoPaterno, u.Correo, u.Telefono, u.Ciudad, r.NombreRol, u.Activo, u.FechaRegistro
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        ORDER BY u.FechaRegistro DESC
    `;
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-usuarios.pdf');
    doc.pipe(res);
    
    doc.fontSize(20).text('Reporte de Usuarios', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { align: 'center' });
    doc.moveDown(2);
    
    let y = 150;
    doc.fontSize(9).text('Nombre', 50, y).text('Correo', 180, y).text('Rol', 320, y).text('Estado', 400, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(u => {
        if (y > 700) { doc.addPage(); y = 50; }
        const nombre = `${u.Nombre} ${u.ApellidoPaterno}`;
        doc.text(nombre.substring(0, 20), 50, y);
        doc.text(u.Correo.substring(0, 20), 180, y);
        doc.text(u.NombreRol, 320, y);
        doc.text(u.Activo ? 'Activo' : 'Inactivo', 400, y);
        y += 20;
    });
    
    doc.end();
});

// 8. Reporte de Usuarios - Excel
app.get('/admin/reportes/usuarios/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT u.Nombre, u.ApellidoPaterno, u.ApellidoMaterno, u.Correo, u.Telefono, u.Ciudad, r.NombreRol, u.Activo, u.FechaRegistro
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        ORDER BY u.FechaRegistro DESC
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Usuarios');
    
    sheet.columns = [
        { header: 'Nombre', key: 'nombre' },
        { header: 'Apellido', key: 'apellido' },
        { header: 'Correo', key: 'correo' },
        { header: 'Teléfono', key: 'telefono' },
        { header: 'Ciudad', key: 'ciudad' },
        { header: 'Rol', key: 'rol' },
        { header: 'Estado', key: 'estado' }
    ];
    
    result.recordset.forEach(u => {
        sheet.addRow({
            nombre: u.Nombre,
            apellido: u.ApellidoPaterno,
            correo: u.Correo,
            telefono: u.Telefono || '',
            ciudad: u.Ciudad || '',
            rol: u.NombreRol,
            estado: u.Activo ? 'Activo' : 'Inactivo'
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-usuarios.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// ==================== REPORTES ADICIONALES ====================

// 9. Reporte de Ejemplares - PDF
app.get('/admin/reportes/ejemplares/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT e.CodigoBarra, l.Titulo, u.NombreUbicacion, em.NombreEstado, e.Activo, e.FechaAdquisicion
        FROM Ejemplares e
        JOIN Libros l ON e.IdLibro = l.IdLibro
        LEFT JOIN Ubicaciones u ON e.IdUbicacion = u.IdUbicacion
        JOIN EstadosMaterial em ON e.IdEstadoMaterial = em.IdEstadoMaterial
        ORDER BY l.Titulo
    `;
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-ejemplares.pdf');
    doc.pipe(res);
    
    doc.fontSize(20).text('Reporte de Ejemplares', { align: 'center' });
    doc.moveDown(2);
    
    let y = 100;
    doc.fontSize(9).text('Código', 50, y).text('Libro', 150, y).text('Ubicación', 300, y).text('Estado', 420, y).text('Status', 500, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(ej => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.text(ej.CodigoBarra || '-', 50, y);
        doc.text(ej.Titulo.substring(0, 20), 150, y);
        doc.text(ej.NombreUbicacion || '-', 300, y);
        doc.text(ej.NombreEstado, 420, y);
        doc.text(ej.Activo ? 'Activo' : 'Prestado', 500, y);
        y += 20;
    });
    
    doc.end();
});

// 10. Reporte de Ejemplares - Excel
app.get('/admin/reportes/ejemplares/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT e.CodigoBarra, l.Titulo, l.ISBN, u.NombreUbicacion, em.NombreEstado, e.Activo, e.FechaAdquisicion
        FROM Ejemplares e
        JOIN Libros l ON e.IdLibro = l.IdLibro
        LEFT JOIN Ubicaciones u ON e.IdUbicacion = u.IdUbicacion
        JOIN EstadosMaterial em ON e.IdEstadoMaterial = em.IdEstadoMaterial
        ORDER BY l.Titulo
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ejemplares');
    
    sheet.columns = [
        { header: 'Código', key: 'codigo' },
        { header: 'Libro', key: 'libro' },
        { header: 'ISBN', key: 'isbn' },
        { header: 'Ubicación', key: 'ubicacion' },
        { header: 'Estado', key: 'estado' },
        { header: 'Status', key: 'status' },
        { header: 'Fecha Adquisición', key: 'fecha' }
    ];
    
    result.recordset.forEach(ej => {
        sheet.addRow({
            codigo: ej.CodigoBarra,
            libro: ej.Titulo,
            isbn: ej.ISBN || '',
            ubicacion: ej.NombreUbicacion || '',
            estado: ej.NombreEstado,
            status: ej.Activo ? 'Disponible' : 'Prestado',
            fecha: ej.FechaAdquisicion ? new Date(ej.FechaAdquisicion).toLocaleDateString('es-MX') : ''
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-ejemplares.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// 11. Reporte de Reservas - PDF
app.get('/admin/reportes/reservas/pdf', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT r.*, l.Titulo, e.CodigoBarra, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario
        FROM Reservas r
        JOIN Ejemplares e ON r.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON r.IdUsuario = u.IdUsuario
        ORDER BY r.FechaReserva DESC
    `;
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-reservas.pdf');
    doc.pipe(res);
    
    doc.fontSize(20).text('Reporte de Reservas', { align: 'center' });
    doc.moveDown(2);
    
    let y = 100;
    doc.fontSize(9).text('Usuario', 50, y).text('Libro', 180, y).text('Fecha Reserva', 350, y).text('Expiración', 450, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
    y += 25;
    
    result.recordset.forEach(r => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.text(r.nombreUsuario.substring(0, 20), 50, y);
        doc.text(r.Titulo.substring(0, 20), 180, y);
        doc.text(new Date(r.FechaReserva).toLocaleDateString('es-MX'), 350, y);
        doc.text(new Date(r.FechaExpiracion).toLocaleDateString('es-MX'), 450, y);
        y += 20;
    });
    
    doc.end();
});

// 12. Reporte de Reservas - Excel
app.get('/admin/reportes/reservas/excel', isAuth, isBibliotecario, async (req, res) => {
    const result = await db.query`
        SELECT l.Titulo, e.CodigoBarra, u.Nombre + ' ' + u.ApellidoPaterno as nombreUsuario, u.Correo, r.FechaReserva, r.FechaExpiracion
        FROM Reservas r
        JOIN Ejemplares e ON r.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        JOIN Usuarios u ON r.IdUsuario = u.IdUsuario
        ORDER BY r.FechaReserva DESC
    `;
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reservas');
    
    sheet.columns = [
        { header: 'Usuario', key: 'usuario' },
        { header: 'Correo', key: 'correo' },
        { header: 'Libro', key: 'libro' },
        { header: 'Código', key: 'codigo' },
        { header: 'Fecha Reserva', key: 'reserva' },
        { header: 'Expiración', key: 'expiracion' }
    ];
    
    result.recordset.forEach(r => {
        sheet.addRow({
            usuario: r.nombreUsuario,
            correo: r.Correo,
            libro: r.Titulo,
            codigo: r.CodigoBarra,
            reserva: new Date(r.FechaReserva).toLocaleDateString('es-MX'),
            expiracion: new Date(r.FechaExpiracion).toLocaleDateString('es-MX')
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-reservas.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});




// ==================== USUARIO - BIBLIOTECA ====================

app.get('/user/biblioteca', isAuth, async (req, res) => {
    const result = await db.query`
        SELECT l.IdLibro, l.Titulo, l.ISBN, l.AnoPublicacion, l.Sinopsis, g.NombreGenero, e.NombreEditorial,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
    `;
    res.render('user/biblioteca', { libros: result.recordset });
});

app.get('/user/libro/:id', isAuth, async (req, res) => {
    const libro = await db.query`
        SELECT l.*, g.NombreGenero, e.NombreEditorial
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
        WHERE l.IdLibro = ${req.params.id}
    `;
    
    const ejemplares = await db.query`SELECT e.* FROM Ejemplares e WHERE e.IdLibro = ${req.params.id} AND e.Activo = 1`;
    const autores = await db.query`SELECT a.* FROM Autores a JOIN LibroAutor la ON a.IdAutor = la.IdAutor WHERE la.IdLibro = ${req.params.id}`;
    
    res.render('user/libro-detalle', { 
        libro: libro.recordset[0],
        ejemplares: ejemplares.recordset,
        autores: autores.recordset
    });
});

app.get('/user/mis-prestamos', isAuth, async (req, res) => {
    const resultado = await db.query`
        SELECT p.*, l.Titulo, e.CodigoBarra
        FROM Prestamos p
        JOIN Ejemplares e ON p.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE p.IdUsuario = ${req.session.userId}
    `;
    res.render('user/mis-prestamos', { prestamos: resultado.recordset });
});

app.get('/user/reservar/:id', isAuth, async (req, res) => {
    const fechaExp = new Date();
    fechaExp.setDate(fechaExp.getDate() + 3);
    
    await db.query`
        INSERT INTO Reservas (IdUsuario, IdEjemplar, FechaExpiracion, IdEstadoReserva)
        VALUES (${req.session.userId}, ${req.params.id}, ${fechaExp}, 1)
    `;
    res.redirect('/user/biblioteca');
});

// ==================== BÚSQUEDA ====================

// Página de búsqueda
app.get('/buscar', isAuth, async (req, res) => {
    const { q, tipo } = req.query;
    
    if (!q) return res.render('user/buscar', { resultados: [], q: '', tipo: '' });
    
    let resultado;
    const tipoBusqueda = tipo || 'todo';
    const busqueda = '%' + q + '%';
    
    if (tipoBusqueda === 'libro') {
        // Buscar por título
        resultado = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            WHERE l.Titulo LIKE ${busqueda}
        `;
    } else if (tipoBusqueda === 'autor') {
        // Buscar por autor
        resultado = await db.query`
            SELECT DISTINCT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            LEFT JOIN LibroAutor la ON l.IdLibro = la.IdLibro
            LEFT JOIN Autores a ON la.IdAutor = a.IdAutor
            WHERE a.Nombre LIKE ${busqueda} OR a.ApellidoPaterno LIKE ${busqueda}
        `;
    } else if (tipoBusqueda === 'isbn') {
        // Buscar por ISBN
        resultado = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            WHERE l.ISBN = ${q}
        `;
    } else if (tipoBusqueda === 'genero') {
        // Buscar por género
        resultado = await db.query`
            SELECT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            WHERE g.NombreGenero LIKE ${busqueda}
        `;
    } else {
        // Búsqueda general (todo)
        resultado = await db.query`
            SELECT DISTINCT l.*, g.NombreGenero, e.NombreEditorial,
                   (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
            FROM Libros l
            LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
            LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
            LEFT JOIN LibroAutor la ON l.IdLibro = la.IdLibro
            LEFT JOIN Autores a ON la.IdAutor = a.IdAutor
            WHERE l.Titulo LIKE ${busqueda} 
               OR l.ISBN LIKE ${busqueda}
               OR a.Nombre LIKE ${busqueda}
               OR a.ApellidoPaterno LIKE ${busqueda}
               OR g.NombreGenero LIKE ${busqueda}
        `;
    }
    
    res.render('user/buscar', { resultados: resultado.recordset, q: q, tipo: tipoBusqueda });
});

// API de búsqueda en tiempo real (autocomplete)
app.get('/api/buscar', isAuth, async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 2) return res.json([]);
    
    const busqueda = '%' + q + '%';
    
    const resultado = await db.query`
        SELECT DISTINCT l.IdLibro, l.Titulo, l.ISBN, l.AnoPublicacion, g.NombreGenero, e.NombreEditorial,
               (SELECT COUNT(*) FROM Ejemplares WHERE IdLibro = l.IdLibro AND Activo = 1) as disponibles
        FROM Libros l
        LEFT JOIN Generos g ON l.IdGenero = g.IdGenero
        LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
        LEFT JOIN LibroAutor la ON l.IdLibro = la.IdLibro
        LEFT JOIN Autores a ON la.IdAutor = a.IdAutor
        WHERE l.Titulo LIKE ${busqueda} 
           OR l.ISBN LIKE ${busqueda}
           OR a.Nombre LIKE ${busqueda}
           OR a.ApellidoPaterno LIKE ${busqueda}
           OR g.NombreGenero LIKE ${busqueda}
    `;
    
    res.json(resultado.recordset);
});

app.listen(3001, () => {
    console.log(`✅ Servidor en http://localhost:3001`);
});

// ==================== USUARIO - RESERVAS ====================

// 1. Mis reservas
app.get('/user/reservas', isAuth, async (req, res) => {
    const resultado = await db.query`
        SELECT r.*, l.Titulo, e.CodigoBarra
        FROM Reservas r
        JOIN Ejemplares e ON r.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE r.IdUsuario = ${req.session.userId}
        ORDER BY r.FechaReserva DESC
    `;
    res.render('user/reservas', { reservas: resultado.recordset });
});

// 2. Hacer reserva (POST)
app.post('/user/reservar', isAuth, async (req, res) => {
    const { IdEjemplar } = req.body;
    
    try {
        // Verificar que no tenga ya una reserva activa para ese ejemplar
        const existente = await db.query`
            SELECT * FROM Reservas 
            WHERE IdUsuario = ${req.session.userId} 
            AND IdEjemplar = ${IdEjemplar}
            AND FechaExpiracion >= GETDATE()
        `;
        
        if (existente.recordset.length > 0) {
            return res.send('Ya tienes una reserva activa para este libro');
        }
        
        // Calcular fecha de expiración (3 días)
        const fechaExp = new Date();
        fechaExp.setDate(fechaExp.getDate() + 3);
        
        await db.query`
            INSERT INTO Reservas (IdUsuario, IdEjemplar, FechaExpiracion, IdEstadoReserva)
            VALUES (${req.session.userId}, ${IdEjemplar}, ${fechaExp}, 1)
        `;
        
        res.redirect('/user/reservas');
    } catch (err) {
        console.error('Error:', err);
        res.send('Error al reservar');
    }
});

// 3. Cancelar reserva (POST)
app.post('/user/reservas/cancelar/:id', isAuth, async (req, res) => {
    await db.query`
        DELETE FROM Reservas 
        WHERE IdReserva = ${req.params.id} 
        AND IdUsuario = ${req.session.userId}
    `;
    res.redirect('/user/reservas');
});

// 4. Notificaciones - Ver si hay libros disponibles reservados
app.get('/api/notificaciones', isAuth, async (req, res) => {
    // Obtener reservas activas del usuario
    const reservas = await db.query`
        SELECT r.IdReserva, r.IdEjemplar, l.Titulo, e.CodigoBarra
        FROM Reservas r
        JOIN Ejemplares e ON r.IdEjemplar = e.IdEjemplar
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE r.IdUsuario = ${req.session.userId}
        AND r.FechaExpiracion >= GETDATE()
    `;
    
    // Verificar cuáles están disponibles ahora
    const notificaciones = [];
    for (const reserva of reservas.recordset) {
        const ejemplar = await db.query`
            SELECT Activo FROM Ejemplares WHERE IdEjemplar = ${reserva.IdEjemplar}
        `;
        if (ejemplar.recordset[0].Activo === 1) {
            notificaciones.push({
                idReserva: reserva.IdReserva,
                titulo: reserva.Titulo,
                codigo: reserva.CodigoBarra,
                mensaje: 'Tu libro ya está disponible!'
            });
        }
    }
    res.json(notificaciones);
});
