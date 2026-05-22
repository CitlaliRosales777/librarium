// Página de nuevo libro (formulario)
app.get('/admin/libros/nuevo', isAuth, isBibliotecario, async (req, res) => {
    const generos = await db.query`SELECT * FROM Generos`;
    const editoriales = await db.query`SELECT * FROM Editoriales`;
    const ubicaciones = await db.query`SELECT * FROM Ubicaciones`;
    const autores = await db.query`SELECT * FROM Autores`;
    res.render('admin/libro-form', { 
        libro: null, 
        generos: generos.recordset, 
        Editoriales: editoriales.recordset, 
        ubicaciones: ubicaciones.recordset,
        autores: autores.recordset
    });
});

// Procesar nuevo libro CON IMAGEN
app.post('/admin/libros/nuevo', isAuth, isBibliotecario, upload.single('imagen'), async (req, res) => {
    const { ISBN, Titulo, AnoPublicacion, IdGenero, IdEditorial, Sinopsis, autores, cantidad } = req.body;
    const imagen = req.file ? '/img/libros/' + req.file.filename : null;
    
    try {
        // Insertar libro
        const resultado = await db.query`
            INSERT INTO Libros (ISBN, Titulo, AnoPublicacion, IdGenero, IdEditorial, Sinopsis)
            VALUES (${ISBN}, ${Titulo}, ${AnoPublicacion}, ${IdGenero}, ${IdEditorial}, ${Sinopsis})
            SELECT SCOPE_IDENTITY() as IdLibro
        `;
        
        const idLibro = resultado.recordset[0].IdLibro;
        
        // Insertar autores (si hay)
        if (autores) {
            const autoresArray = Array.isArray(autores) ? autores : [autores];
            for (const autorId of autoresArray) {
                await db.query`INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES (${idLibro}, ${autorId})`;
            }
        }
        
        // Insertar ejemplares
        const cantidadNum = parseInt(cantidad) || 1;
        for (let i = 0; i < cantidadNum; i++) {
            await db.query`
                INSERT INTO Ejemplares (IdLibro, IdEstadoMaterial, IdUbicacion, CodigoBarra, FechaAdquisicion)
                VALUES (${idLibro}, 1, 1, ${ISBN + '-' + i}, GETDATE())
            `;
        }
        
        res.redirect('/admin/libros');
    } catch (err) {
        console.error(err);
        res.send('Error al registrar libro');
    }
});

// Editar libro
app.get('/admin/libros/editar/:id', isAuth, isBibliotecario, async (req, res) => {
    const libro = await db.query`SELECT * FROM Libros WHERE IdLibro = ${req.params.id}`;
    const generos = await db.query`SELECT * FROM Generos`;
    const editoriales = await db.query`SELECT * FROM Editoriales`;
    res.render('admin/libro-form', { 
        libro: libro.recordset[0], 
        generos: generos.recordset, 
        Editoriales: editoriales.recordset, 
        ubicaciones: [],
        autores: []
    });
});