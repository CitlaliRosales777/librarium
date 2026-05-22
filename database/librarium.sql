-- =============================================
-- ESQUEMA BIBLIOTECA 
-- =============================================

CREATE DATABASE librarium;

USE librarium;
GO

-- =============================================
-- 1. TABLAS
-- =============================================

CREATE TABLE Roles (
    IdRol INT IDENTITY(1,1) PRIMARY KEY,
    NombreRol VARCHAR(50) NOT NULL UNIQUE,
    Descripcion VARCHAR(200) NULL
);

CREATE TABLE Usuarios (
    IdUsuario INT IDENTITY(1,1) PRIMARY KEY,
    IdRol INT NOT NULL,
    Nombre VARCHAR(80) NOT NULL,
    ApellidoPaterno VARCHAR(80) NOT NULL,
    ApellidoMaterno VARCHAR(80) NULL,
    Calle VARCHAR(100) NULL,
    NumInterior VARCHAR(20) NULL,
    Colonia VARCHAR(100) NULL,
    CodigoPostal VARCHAR(10) NULL,
    Ciudad VARCHAR(80) NULL,
    Telefono VARCHAR(20) NULL,
    Correo VARCHAR(120) NOT NULL UNIQUE,
    ContraseñaHash VARBINARY(256) NOT NULL,
    FechaRegistro DATETIME DEFAULT GETDATE(),
    Activo BIT DEFAULT 1,

    CONSTRAINT FK_Usuarios_Roles FOREIGN KEY (IdRol) REFERENCES Roles(IdRol)
);

CREATE TABLE Editoriales (
    IdEditorial INT IDENTITY(1,1) PRIMARY KEY,
    NombreEditorial VARCHAR(150) NOT NULL UNIQUE,
    Pais VARCHAR(60) NULL,
    SitioWeb VARCHAR(200) NULL,
    FechaFundacion DATE NULL,
    Activo BIT DEFAULT 1,
    Descripcion VARCHAR(300) NULL
);

CREATE TABLE Autores (
    IdAutor INT IDENTITY(1,1) PRIMARY KEY,
    Nombre VARCHAR(100) NOT NULL,
    ApellidoPaterno VARCHAR(80) NOT NULL,
    ApellidoMaterno VARCHAR(80) NULL,
    FechaNacimiento DATE NULL,
    Nacionalidad VARCHAR(60) NULL
);

CREATE TABLE Generos (
    IdGenero INT IDENTITY(1,1) PRIMARY KEY,
    NombreGenero VARCHAR(80) NOT NULL UNIQUE,
    Descripcion VARCHAR(200) NULL
);

CREATE TABLE Libros (
    IdLibro INT IDENTITY(1,1) PRIMARY KEY,
    ISBN VARCHAR(20) NULL UNIQUE,
    Titulo VARCHAR(250) NOT NULL,
    AnoPublicacion INT NULL,
    IdGenero INT NULL,
    IdEditorial INT NULL,
    Sinopsis VARCHAR(800) NULL,

    CONSTRAINT FK_Libros_Generos FOREIGN KEY (IdGenero) REFERENCES Generos(IdGenero),
    CONSTRAINT FK_Libros_Editoriales FOREIGN KEY (IdEditorial) REFERENCES Editoriales(IdEditorial)
);

CREATE TABLE LibroAutor (
    IdLibro INT NOT NULL,
    IdAutor INT NOT NULL,
    PRIMARY KEY (IdLibro, IdAutor),
    CONSTRAINT FK_LibroAutor_Libros FOREIGN KEY (IdLibro) REFERENCES Libros(IdLibro),
    CONSTRAINT FK_LibroAutor_Autores FOREIGN KEY (IdAutor) REFERENCES Autores(IdAutor)
);

CREATE TABLE Ubicaciones (
    IdUbicacion INT IDENTITY(1,1) PRIMARY KEY,
    NombreUbicacion VARCHAR(100) NOT NULL,
    Descripcion VARCHAR(150) NULL
);

CREATE TABLE EstadosMaterial (
    IdEstadoMaterial INT IDENTITY(1,1) PRIMARY KEY,
    NombreEstado VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Ejemplares (
    IdEjemplar INT IDENTITY(1,1) PRIMARY KEY,
    IdLibro INT NOT NULL,
    IdEstadoMaterial INT NOT NULL,
    IdUbicacion INT NOT NULL,
    CodigoBarra VARCHAR(50) NULL UNIQUE,
    FechaAdquisicion DATE NULL,
    Activo BIT DEFAULT 1,

    CONSTRAINT FK_Ejemplares_Libros FOREIGN KEY (IdLibro) REFERENCES Libros(IdLibro),
    CONSTRAINT FK_Ejemplares_EstadosMaterial FOREIGN KEY (IdEstadoMaterial) REFERENCES EstadosMaterial(IdEstadoMaterial),
    CONSTRAINT FK_Ejemplares_Ubicaciones FOREIGN KEY (IdUbicacion) REFERENCES Ubicaciones(IdUbicacion)
);

CREATE TABLE EstadosPrestamo (
    IdEstadoPrestamo INT IDENTITY(1,1) PRIMARY KEY,
    NombreEstado VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Prestamos (
    IdPrestamo INT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario INT NOT NULL,
    IdEjemplar INT NOT NULL,
    FechaPrestamo DATETIME DEFAULT GETDATE(),
    FechaDevolucionEsperada DATE NOT NULL,
    FechaDevolucionReal DATE NULL,
    IdEstadoPrestamo INT NOT NULL DEFAULT 1,

    CONSTRAINT FK_Prestamos_Usuarios FOREIGN KEY (IdUsuario) REFERENCES Usuarios(IdUsuario),
    CONSTRAINT FK_Prestamos_Ejemplares FOREIGN KEY (IdEjemplar) REFERENCES Ejemplares(IdEjemplar),
    CONSTRAINT FK_Prestamos_Estados FOREIGN KEY (IdEstadoPrestamo) REFERENCES EstadosPrestamo(IdEstadoPrestamo)
);

CREATE TABLE Reservas (
    IdReserva INT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario INT NOT NULL,
    IdEjemplar INT NOT NULL,
    FechaReserva DATETIME DEFAULT GETDATE(),
    FechaExpiracion DATE NULL,
    IdEstadoReserva INT NOT NULL,

    CONSTRAINT FK_Reservas_Usuarios FOREIGN KEY (IdUsuario) REFERENCES Usuarios(IdUsuario),
    CONSTRAINT FK_Reservas_Ejemplares FOREIGN KEY (IdEjemplar) REFERENCES Ejemplares(IdEjemplar)
);

CREATE TABLE Multas (
    IdMulta INT IDENTITY(1,1) PRIMARY KEY,
    IdPrestamo INT NOT NULL,
    Monto DECIMAL(10,2) NOT NULL,
    FechaCalculo DATETIME DEFAULT GETDATE(),
    Pagado BIT DEFAULT 0,
    FechaPago DATETIME NULL,

    CONSTRAINT FK_Multas_Prestamos FOREIGN KEY (IdPrestamo) REFERENCES Prestamos(IdPrestamo)
);

CREATE TABLE Auditoria (
    IdAuditoria INT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario INT NOT NULL,
    Accion VARCHAR(100) NOT NULL,
    Descripcion VARCHAR(500) NULL,
    Fecha DATETIME DEFAULT GETDATE(),
    IP VARCHAR(45) NULL
);
GO

-- =============================================
-- 2. ÍNDICES
-- =============================================

CREATE NONCLUSTERED INDEX IX_Usuarios_Correo ON Usuarios(Correo);
CREATE NONCLUSTERED INDEX IX_Usuarios_IdRol ON Usuarios(IdRol);

CREATE NONCLUSTERED INDEX IX_Libros_Titulo ON Libros(Titulo);
CREATE NONCLUSTERED INDEX IX_Libros_ISBN ON Libros(ISBN) WHERE ISBN IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_Libros_IdEditorial ON Libros(IdEditorial);

CREATE NONCLUSTERED INDEX IX_Ejemplares_IdLibro ON Ejemplares(IdLibro);
CREATE NONCLUSTERED INDEX IX_Ejemplares_CodigoBarra ON Ejemplares(CodigoBarra);
CREATE NONCLUSTERED INDEX IX_Ejemplares_Activo ON Ejemplares(Activo) INCLUDE (IdLibro);

CREATE NONCLUSTERED INDEX IX_Prestamos_IdUsuario ON Prestamos(IdUsuario);
CREATE NONCLUSTERED INDEX IX_Prestamos_IdEjemplar ON Prestamos(IdEjemplar);
CREATE NONCLUSTERED INDEX IX_Prestamos_FechaEsperada 
ON Prestamos(FechaDevolucionEsperada) WHERE FechaDevolucionReal IS NULL;

CREATE NONCLUSTERED INDEX IX_Multas_Pagado ON Multas(Pagado) INCLUDE (Monto);
CREATE NONCLUSTERED INDEX IX_Auditoria_Fecha ON Auditoria(Fecha);
GO

-- =============================================
-- 3. TRIGGERS
-- =============================================

CREATE OR ALTER TRIGGER TR_Auditoria_Prestamos
ON Prestamos AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO Auditoria (IdUsuario, Accion, Descripcion)
    SELECT 
        COALESCE(i.IdUsuario, d.IdUsuario),
        CASE WHEN d.IdPrestamo IS NULL THEN 'CREACION_PRESTAMO' ELSE 'ACTUALIZACION_PRESTAMO' END,
        CONCAT('Prestamo: ', i.IdPrestamo, ' | Ejemplar: ', i.IdEjemplar)
    FROM inserted i LEFT JOIN deleted d ON i.IdPrestamo = d.IdPrestamo;
END;
GO

CREATE OR ALTER TRIGGER TR_Prestamo_Ejemplar
ON Prestamos AFTER INSERT
AS
BEGIN
    UPDATE e SET Activo = 0
    FROM Ejemplares e INNER JOIN inserted i ON e.IdEjemplar = i.IdEjemplar
    WHERE i.FechaDevolucionReal IS NULL;
END;
GO

CREATE OR ALTER TRIGGER TR_Devolucion_Ejemplar
ON Prestamos AFTER UPDATE
AS
BEGIN
    IF UPDATE(FechaDevolucionReal)
    BEGIN
        UPDATE e SET Activo = 1
        FROM Ejemplares e INNER JOIN inserted i ON e.IdEjemplar = i.IdEjemplar
        WHERE i.FechaDevolucionReal IS NOT NULL;
    END
END;
GO

CREATE OR ALTER TRIGGER TR_Calcular_Multa
ON Prestamos AFTER UPDATE
AS
BEGIN
    IF UPDATE(FechaDevolucionReal)
    BEGIN
        INSERT INTO Multas (IdPrestamo, Monto)
        SELECT 
            i.IdPrestamo,
            DATEDIFF(DAY, i.FechaDevolucionEsperada, i.FechaDevolucionReal) * 10.00
        FROM inserted i
        INNER JOIN deleted d ON i.IdPrestamo = d.IdPrestamo
        WHERE i.FechaDevolucionReal > i.FechaDevolucionEsperada;
    END
END;
GO

-- =============================================
-- 4. PROCEDIMIENTOS ALMACENADOS
-- =============================================

CREATE OR ALTER PROCEDURE sp_PrestarLibro
    @IdUsuario INT,
    @IdEjemplar INT,
    @DiasPrestamo INT = 15
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @FechaEsperada DATE = DATEADD(DAY, @DiasPrestamo, CAST(GETDATE() AS DATE));

    IF NOT EXISTS (SELECT 1 FROM Ejemplares WHERE IdEjemplar = @IdEjemplar AND Activo = 1)
    BEGIN
        RAISERROR('El ejemplar no está disponible.', 16, 1);
        RETURN;
    END

    INSERT INTO Prestamos (IdUsuario, IdEjemplar, FechaDevolucionEsperada)
    VALUES (@IdUsuario, @IdEjemplar, @FechaEsperada);

    SELECT SCOPE_IDENTITY() AS IdPrestamoNuevo;
END;
GO

CREATE OR ALTER PROCEDURE sp_DevolverLibro
    @IdPrestamo INT
AS
BEGIN
    UPDATE Prestamos
    SET FechaDevolucionReal = GETDATE(),
        IdEstadoPrestamo = 2  -- Devuelto
    WHERE IdPrestamo = @IdPrestamo AND FechaDevolucionReal IS NULL;
END;
GO

CREATE OR ALTER PROCEDURE sp_ReservarEjemplar
    @IdUsuario INT,
    @IdEjemplar INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO Reservas (IdUsuario, IdEjemplar, FechaExpiracion, IdEstadoReserva)
    VALUES (@IdUsuario, @IdEjemplar, DATEADD(DAY, 3, GETDATE()), 1);
END;
GO

CREATE OR ALTER PROCEDURE sp_LibrosMasPrestados
    @Top INT = 10
AS
BEGIN
    SELECT TOP (@Top)
        l.Titulo,
        e.NombreEditorial,
        COUNT(p.IdPrestamo) AS VecesPrestado
    FROM Prestamos p
    JOIN Ejemplares ej ON p.IdEjemplar = ej.IdEjemplar
    JOIN Libros l ON ej.IdLibro = l.IdLibro
    LEFT JOIN Editoriales e ON l.IdEditorial = e.IdEditorial
    GROUP BY l.Titulo, e.NombreEditorial
    ORDER BY VecesPrestado DESC;
END;
GO

--===================datos==============--
-- ROLES
INSERT INTO Roles (NombreRol, Descripcion) VALUES 
('Administrador', 'Acceso total al sistema'),
('Bibliotecario', 'Gestión de préstamos y libros'),
('Socios', 'Usuario normal de la biblioteca');

-- ESTADOS MATERIAL
INSERT INTO EstadosMaterial (NombreEstado) VALUES 
('Nuevo'), ('Bueno'), ('Aceptable'), ('Dañado'), ('En reparación');

-- ESTADOS PRESTAMO
INSERT INTO EstadosPrestamo (NombreEstado) VALUES 
('Activo'), ('Devuelto'), ('Vencido'), ('Perdido');

-- UBICACIONES
INSERT INTO Ubicaciones (NombreUbicacion, Descripcion) VALUES 
('Sala A - Estante 1', 'Literatura y ficción'),
('Sala A - Estante 2', 'Ciencia ficción y fantasía'),
('Sala B - Estante 3', 'Historia y ciencias sociales'),
('Sala C - Estante 4', 'Infantil y juvenil'),
('Depósito', 'Libros de reserva');

-- EDITORIALES
INSERT INTO Editoriales (NombreEditorial, Pais, SitioWeb, FechaFundacion) VALUES 
('Penguin Random House', 'España', 'https://www.penguinrandomhouse.com', '2013-07-01'),
('Planeta', 'España', 'https://www.planetadelibros.com', '1949-01-01'),
('Anagrama', 'España', NULL, '1969-01-01'),
('Alfaguara', 'España', 'https://www.alfaguara.com', '1964-01-01'),
('HarperCollins', 'Estados Unidos', 'https://www.harpercollins.com', '1817-01-01');

-- GENEROS
INSERT INTO Generos (NombreGenero, Descripcion) VALUES 
('Ficción', 'Novelas y literatura en general'),
('Ciencia Ficción', 'Futuro, tecnología y espacio'),
('Fantasía', 'Mundos imaginarios y magia'),
('Historia', 'Libros históricos y biografías'),
('Terror', 'Suspenso y miedo'),
('Infantil', 'Libros para niños');

-- AUTORES
INSERT INTO Autores (Nombre, ApellidoPaterno, ApellidoMaterno, FechaNacimiento, Nacionalidad) VALUES 
('Gabriel', 'García', 'Márquez', '1927-03-06', 'Colombia'),
('Jorge Luis', 'Borges', NULL, '1899-08-24', 'Argentina'),
('Isabel', 'Allende', NULL, '1942-08-02', 'Chile'),
('J.K.', 'Rowling', NULL, '1965-07-31', 'Reino Unido'),
('George R.R.', 'Martin', NULL, '1948-09-20', 'Estados Unidos'),
('Stephen', 'King', NULL, '1947-09-21', 'Estados Unidos');

-- LIBROS
INSERT INTO Libros (ISBN, Titulo, AnoPublicacion, IdGenero, IdEditorial, Sinopsis) VALUES 
('9788401024567', 'Cien años de soledad', 1967, 1, 1, 'La historia de la familia Buendía a lo largo de siete generaciones.'),
('9788437604947', 'El Aleph', 1949, 1, 3, 'Colección de cuentos del gran maestro argentino.'),
('9788401023456', 'El juego de Ender', 1985, 2, 2, 'Un niño genio es entrenado para salvar a la humanidad.'),
('9788466658720', 'Harry Potter y la piedra filosofal', 1997, 3, 1, 'El inicio de la saga del niño que vivió.'),
('9788401352836', 'El problema de los tres cuerpos', 2008, 2, 2, 'Primera parte de la trilogía de ciencia ficción china.'),
('9788401012345', 'It', 1986, 5, 5, 'El payaso Pennywise aterroriza a un grupo de niños en Derry.');


-- LIBROAUTOR
INSERT INTO LibroAutor (IdLibro, IdAutor) VALUES 
(1,1), (2,2), (3,3), (4,4), (5,5), (6,6);

-- EJEMPLARES
INSERT INTO Ejemplares (IdLibro, IdEstadoMaterial, IdUbicacion, CodigoBarra, FechaAdquisicion) VALUES 
(1,1,1, 'LIB001234', '2024-01-15'),
(1,2,1, 'LIB001235', '2024-01-15'),
(2,1,1, 'LIB002341', '2024-02-01'),
(3,1,2, 'LIB003456', '2024-03-10'),
(4,1,4, 'LIB004567', '2024-01-20'),
(5,2,2, 'LIB005678', '2025-01-05'),
(6,3,1, 'LIB006789', '2024-11-12');

-- USUARIOS (contraseña de ejemplo: "password123" hasheada con bcrypt o similar)
INSERT INTO Usuarios (IdRol, Nombre, ApellidoPaterno, ApellidoMaterno, Correo, ContraseñaHash, Telefono, Ciudad) VALUES 
(1, 'Admin', 'Principal', NULL, 'admin@librarium.mx', 0x243262243132244e6f4d61737465724b6579, '6641234567', 'Tijuana'), -- Cambia el hash real
(2, 'María', 'López', 'García', 'maria.lopez@librarium.mx', 0x243262243132244e6f4d61737465724b6579, '6649876543', 'Tijuana'),
(3, 'Carlos', 'Hernández', 'Ruiz', 'carlos.h@librarium.mx', 0x243262243132244e6f4d61737465724b6579, '6645557788', 'Tijuana'),
(3, 'Ana', 'Rodríguez', 'Pérez', 'ana.rodriguez@gmail.com', 0x243262243132244e6f4d61737465724b6579, '6641122334', 'Tijuana');

-- PRESTAMOS
INSERT INTO Prestamos (IdUsuario, IdEjemplar, FechaDevolucionEsperada) VALUES 
(3, 1, DATEADD(DAY, 15, GETDATE())),
(4, 4, DATEADD(DAY, 15, GETDATE()));

-- RESERVAS
INSERT INTO Reservas (IdUsuario, IdEjemplar, FechaExpiracion, IdEstadoReserva) VALUES 
(3, 3, DATEADD(DAY, 3, GETDATE()), 1);

-- Hash correcto para "password123" usando password_hash() de PHP
UPDATE Usuarios SET ContraseñaHash = 0x2432622431302452344d4b4d6c6e6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b6a6b WHERE IdUsuario = 1;
-- Mejor: genera el hash correcto en PHP y actualiza

