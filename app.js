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

// ==========================================
// 6. ADMIN - USUARIOS
// ==========================================

app.get('/admin/usuarios', isAuth, isAdmin, async (req, res) => {
    const result = await db.query`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        JOIN Roles r ON u.IdRol = r.IdRol
        ORDER BY u.FechaRegistro DESC
    `;
    res.render('admin/usuarios', { usuarios: result.recordset });
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
    const usuarios = await db.query`SELECT * FROM Usuarios WHERE IdRol = 3 AND Activo = 1`;
    const ejemplares = await db.query`
        SELECT e.*, l.Titulo
        FROM Ejemplares e
        JOIN Libros l ON e.IdLibro = l.IdLibro
        WHERE e.Activo = 1
    `;
    res.render('admin/prestamo-form', { usuarios: usuarios.recordset, ejemplares: ejemplares.recordset });
});

// 3. Guardar nuevo préstamo (POST)
app.post('/admin/prestamos/nuevo', isAuth, isBibliotecario, async (req, res) => {
    const { IdUsuario, IdEjemplar, dias } = req.body;
    const diasPrestamo = parseInt(dias) || 15;
    const fechaDevolucion = new Date();
    fechaDevolucion.setDate(fechaDevolucion.getDate() + diasPrestamo);
    
    await db.query`
        INSERT INTO Prestamos (IdUsuario, IdEjemplar, FechaDevolucionEsperada, IdEstadoPrestamo)
        VALUES (${IdUsuario}, ${IdEjemplar}, ${fechaDevolucion}, 1)
    `;
    
    res.redirect('/admin/prestamos');
});

// 4. Devolver libro (POST)
app.post('/admin/prestamos/devolver/:id', isAuth, isBibliotecario, async (req, res) => {
    const fechaActual = new Date().toISOString().split('T')[0];
    
    const prestamo = await db.query`SELECT * FROM Prestamos WHERE IdPrestamo = ${req.params.id}`;
    const p = prestamo.recordset[0];
    
    const fechaEsperada = new Date(p.FechaDevolucionEsperada).toISOString().split('T')[0];
    let multa = 0;
    
    if (fechaActual > fechaEsperada) {
        const diff = Math.ceil((new Date(fechaActual) - new Date(fechaEsperada)) / (1000 * 60 * 60 * 24));
        multa = diff * 10;
    }
    
    await db.query`
        UPDATE Prestamos 
        SET FechaDevolucionReal = ${fechaActual}, IdEstadoPrestamo = 2
        WHERE IdPrestamo = ${req.params.id}
    `;
    
    if (multa > 0) {
        await db.query`INSERT INTO Multas (IdPrestamo, Monto) VALUES (${req.params.id}, ${multa})`;
    }
    
    await db.query`UPDATE Ejemplares SET Activo = 1 WHERE IdEjemplar = ${p.IdEjemplar}`;
    
    res.redirect('/admin/prestamos');
});

// 5. Renovar préstamo (POST)
app.post('/admin/prestamos/renovar/:id', isAuth, isBibliotecario, async (req, res) => {
    const dias = parseInt(req.body.dias) || 10;
    
    const prestamo = await db.query`SELECT * FROM Prestamos WHERE IdPrestamo = ${req.params.id}`;
    const p = prestamo.recordset[0];
    
    const fechaActual = new Date(p.FechaDevolucionEsperada);
    fechaActual.setDate(fechaActual.getDate() + dias);
    const nuevaFecha = fechaActual.toISOString().split('T')[0];
    
    await db.query`
        UPDATE Prestamos 
        SET FechaDevolucionEsperada = ${nuevaFecha}, IdEstadoPrestamo = 1
        WHERE IdPrestamo = ${req.params.id}
    `;
    
    res.redirect('/admin/prestamos');
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

