import express from 'express';
import cors from 'cors'; // Importa el paquete cors
import databaseFunctions from './database.js';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { v2 as cloudinary } from 'cloudinary';



cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const app = express();

// Cargar las variables de entorno
dotenv.config();

// Configuración de CORS
const corsOptions = {
  origin: 'https://drimo-fit-app-production.up.railway.app',
  methods: ['GET', 'POST'], // Métodos HTTP permitidos
  allowedHeaders: ['Content-Type', 'Authorization'], // Cabeceras permitidas
  credentials: true, // Permite enviar cookies de autenticación o credenciales
};

// Usa el middleware CORS en todas las rutas
app.use(cors(corsOptions));

// Middleware para analizar JSON
app.use(express.json());

// Configurar SendGrid
const sendgridApiKey = process.env.SENDGRID_API_KEY.replace(/^['"]|['"]$/g, '');
sgMail.setApiKey(sendgridApiKey);


app.post('/cloudinary/eliminar-imagen', async (req, res) => {
  const { public_id } = req.body;

  if (!public_id) return res.status(400).json({ error: 'Falta el public_id' });

  try {
    const result = await cloudinary.uploader.destroy(public_id);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error eliminando imagen:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

//Métodos para comprobar el si el servidor funciona y si la base de datos está conectada correctamente
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: "El servidor está funcionando correctamente en Railway!" });
});


app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT NOW() AS current_time");
    res.json({ success: true, time: rows[0].current_time });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});



app.post('/generar-rutina', async (req, res) => {
  try {
    console.log('📥 Petición recibida en /generar-rutina');
    console.log('➡️ Body recibido:', JSON.stringify(req.body, null, 2));

    const {
      usuarioId, nombreRutina, tiempoDisponible, enfoqueUsuario, diasEntrenamiento,
      objetivo, nivel, restricciones = [], lugarEntrenamiento
    } = req.body;

    if (!usuarioId || !nombreRutina || !tiempoDisponible || !diasEntrenamiento || !objetivo || !nivel || !lugarEntrenamiento) {
      console.warn('⚠️ Datos incompletos recibidos:', req.body);
      return res.status(401).json({ success: false, message: 'Faltan datos requeridos' });
    }

    const diasSemana = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const diasEntrenamientoOrdenados = diasSemana.filter(dia =>
      diasEntrenamiento.map(d => d.toLowerCase()).includes(dia)
    );
    console.log('📅 Días de entrenamiento ordenados:', diasEntrenamientoOrdenados);

    if (diasEntrenamientoOrdenados.length === 0) {
      console.error('❌ Los días de entrenamiento no son válidos');
      return res.status(402).json({ success: false, message: 'Los días de entrenamiento no son válidos' });
    }

    const distribucionEjercicios = databaseFunctions.calcularEjerciciosPorParte(
      tiempoDisponible, enfoqueUsuario, diasEntrenamientoOrdenados.length, objetivo
    );
    console.log('📊 Distribución de ejercicios generada:', JSON.stringify(distribucionEjercicios, null, 2));

    if (!distribucionEjercicios || distribucionEjercicios.length === 0) {
      console.error('❌ No se pudo generar la distribución de ejercicios');
      return res.status(403).json({ success: false, message: 'No se pudo generar la distribución de ejercicios' });
    }

    const resultado = await databaseFunctions.insertarRutinaEnBaseDeDatos(
      usuarioId, nombreRutina, distribucionEjercicios, diasEntrenamientoOrdenados,
      objetivo, nivel, restricciones, tiempoDisponible, lugarEntrenamiento
    );

    console.log('✅ Resultado de insertarRutinaEnBaseDeDatos:', resultado);

    if (!resultado.success) {
      console.error('❌ Error al insertar la rutina:', resultado.message);
      return res.status(500).json({ success: false, message: 'Error al insertar la rutina', error: resultado.message });
    }

    console.log('🎉 Rutina generada con éxito, ID:', resultado.rutinaId);

    res.status(201).json({
      success: true,
      message: 'Rutina generada exitosamente',
      rutinaId: resultado.rutinaId
    });

  } catch (error) {
    console.error('❌ Error inesperado en /generar-rutina:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
});


// Ruta para enviar confirmación de correo
app.post('/enviar-confirmacion-correo', async (req, res) => {
  const { correo, nombre, token } = req.body;

  const msg = {
    to: correo,
    from: 'frenmymanuel@gmail.com', // Usa un correo verificado en SendGrid
    subject: 'Confirmación de correo',
    text: `Hola ${nombre}, gracias por registrarte en nuestra aplicación Drimo Fit.`,
    html: `<p>Hola ${nombre},</p><p>Este es tu código de confirmación: <strong>${token}</strong></p>`,
  };

  try {
    await sgMail.send(msg);

    res.status(200).send('Correo enviado correctamente');
  } catch (error) {

    res.status(500).send('Error al enviar el correo');
  }
});



// Ruta GET para confirmar el correo del usuario
app.get('/confirmar-correo', async (req, res) => {
  const { token } = req.query;
  try {
    const result = await databaseFunctions.validateCorreo(token);
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }
    res.redirect('DRIMOFIT://client');
  } catch (error) {

    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});
// 📌 POST: Verificar si un correo o teléfono ya están en uso
app.post("/verificar-correo-telf", async (req, res) => {
  try {
    const { correo, telefono } = req.body;

    if (!correo || !telefono) {
      return res.status(400).json({ error: "Correo y teléfono son obligatorios." });
    }

    const resultado = await databaseFunctions.verificarCorreoTelefono(correo, telefono);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error en el servidor", details: error.message });
  }
});

// Ruta POST para insertar un nuevo usuario
app.post('/usuarios', async (req, res) => {
  const {
    nombre,
    apellido,
    telf,
    correo,
    contrasenia,
    objetivo,
    lugar,
    actividad,
    sexo,
    enfoque,
    dias,
    peso,
    tipoPeso,
    pesoObjetivo,
    altura,
    tipoAltura,
    edad,
    horas,
    restricciones,
    token,
    nivel
  } = req.body;

  try {
    const result = await databaseFunctions.insertUser(
      nombre,
      apellido,
      telf,
      correo,
      contrasenia,
      objetivo,
      lugar,
      actividad,
      sexo,
      enfoque,
      dias,
      peso,
      tipoPeso,
      pesoObjetivo,
      altura,
      tipoAltura,
      edad,
      horas,
      restricciones,
      token,
      nivel
    );

    if (result.success) {
      res.status(201).json({ userId: result.userId });
    } else {
      res.status(400).json({ message: result.message });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});


// Ruta POST para validar usuario
app.post('/login', async (req, res) => {
  const { correo, contrasenia } = req.body;

  if (!correo || !contrasenia) {
    return res.status(400).json({ message: 'Correo y contraseña son requeridos.' });
  }

  try {
    const result = await databaseFunctions.validateUser(correo, contrasenia);

    if (!result.success) {
      return res.status(401).json({ message: result.message });
    }
    if (result.success === 'validar') {
      return res.status(402).json({ message: result.message });
    }

    res.status(200).json({
      message: result.message,
      user: result.user
    });
  } catch (error) {
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});
app.post("/obtener-rutina", async (req, res) => {
  const { usuarioId } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ success: false, message: "Falta el ID del usuario." });
  }

  try {
    const resultado = await databaseFunctions.obtenerRutinaCompleta(usuarioId);
    if (!resultado.success) {
      return res.status(404).json(resultado);
    }

    res.status(200).json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
});


// Ruta POST para obtener ejercicios por rutina y día
app.post('/ejercicios', async (req, res) => {
  const { rutina_id, dia } = req.body;

  if (!rutina_id || !dia) {
    return res.status(400).json({ success: false, message: 'Faltan parámetros: rutina o día' });
  }

  try {
    const result = await databaseFunctions.obtenerEjercicios(rutina_id, dia);

    // Si no hay ejercicios, retornar un objeto vacío
    if (!result.success || !result.ejercicios || result.ejercicios.length === 0) {
      return res.status(200).json({ success: true, ejercicios: [] }); // Retorna array vacío en lugar de error
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});


// Ruta POST para obtener materiales de un ejercicio
app.post('/material', async (req, res) => {
  const { id_ejercicio } = req.body;

  try {
    const result = await databaseFunctions.obtenerMateriales(id_ejercicio);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: `Error en el servidor: ${error.message}` });
  }
});

// Ruta POST para obtener instrucciones de un ejercicio
app.post('/instruccion', async (req, res) => {
  const { id_ejercicio } = req.body;

  try {
    const result = await databaseFunctions.obtenerInstrucciones(id_ejercicio);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: `Error en el servidor: ${error.message}` });
  }
});

//Ruta para comprobar si existe una estadística en una fecha específica
app.post("/comprobar-estadistica", async (req, res) => {
  try {
    const { usuarioId, ejercicioId, fecha } = req.body;
    if (!usuarioId || !ejercicioId || !fecha) {
      return res.status(400).json({ success: false, message: "Faltan parámetros." });
    }

    const resultado = await databaseFunctions.comprobarEstadistica(usuarioId, ejercicioId, fecha);
    res.status(200).json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
});

//Ruta para registrar o actualizar estadísticas de un ejercicio
app.post("/registrar-estadistica", async (req, res) => {
  try {
    const { usuarioId, ejercicioId, fecha, series } = req.body;
    if (!usuarioId || !ejercicioId || !fecha || !Array.isArray(series) || series.length === 0) {
      return res.status(400).json({ success: false, message: "Faltan parámetros o series inválidas." });
    }

    const resultado = await databaseFunctions.insertarEstadistica(usuarioId, ejercicioId, fecha, series);
    res.status(200).json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
});

//Ruta para obtener la estadistica de un ejercicio con fecha
app.post('/series-estadistica', async (req, res) => {
  try {
    const { usuario_id, ejercicio_id, fecha } = req.body;

    if (!usuario_id || !ejercicio_id) {
      return res.status(400).json({ error: "usuario_id y ejercicio_id son obligatorios" });
    }

    const series = await databaseFunctions.obtenerEstadisticaSeries(usuario_id, ejercicio_id, fecha || null);

    if (series.length === 0) {
      //return res.status(404).json({ mensaje: "No se encontraron series para los datos proporcionados" });
    }

    res.json(series);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
// ✅ Ruta para registrar un ejercicio completado
app.post('/ejercicios-completado', async (req, res) => {
  try {
    const { usuario_id, ejercicio_id, fecha } = req.body;

    if (!usuario_id || !ejercicio_id || !fecha) {
      return res.status(400).json({ error: "usuario_id, ejercicio_id y fecha son obligatorios" });
    }

    const result = await databaseFunctions.registrarEjercicioCompletado(usuario_id, ejercicio_id, fecha);

    if (!result.success) {
      return res.status(409).json(result); // 409 Conflict si ya existe
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
// ✅ Ruta para verificar si un ejercicio está completado en la fecha actual
app.post('/comprobar-ejercicio-completado', async (req, res) => {
  try {
    const { usuario_id, ejercicio_id, fecha } = req.body;

    if (!usuario_id || !ejercicio_id || !fecha) {
      return res.status(400).json({ error: "usuario_id, ejercicio_id y fecha son obligatorios" });
    }

    const result = await databaseFunctions.verificarEjercicioCompletado(usuario_id, ejercicio_id, fecha);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

//Ruta pra verificar si la rutina del dia ha sido completada
app.post("/verificar-dia-completado", async (req, res) => {
  const { rutina_id, dia, fecha } = req.body;

  if (!rutina_id || !dia || !fecha) {
    return res.status(400).json({ error: "Faltan parámetros requeridos." });
  }

  try {
    const completado = await databaseFunctions.verificarTodosEjerciciosCompletados(rutina_id, dia, fecha);
    res.json({ completado });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

//Ruta para registrar rutina completada
app.post("/registrar-rutina-completada", async (req, res) => {
  const { usuario_id, fecha } = req.body;

  if (!usuario_id || !fecha) {
    return res.status(400).json({ error: "Faltan parámetros requeridos." });
  }

  try {
    const resultado = await databaseFunctions.registrarRutinaCompletada(usuario_id, fecha);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

//Ruta para comprobar rutina completada
app.post("/comprobar-rutina-completada", async (req, res) => {
  const { usuario_id, fecha } = req.body;

  if (!usuario_id || !fecha) {
    return res.status(400).json({ error: "Faltan parámetros requeridos." });
  }

  try {
    const resultado = await databaseFunctions.comprobarRutinaCompletada(usuario_id, fecha);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

//Ruta para obtener los ejercicios pasados unos parámetros
app.post("/obtener-ejercicios", async (req, res) => {
  try {
    const { parte_musculo, tipo, dificultad } = req.body;

    // Llamar a la función, pasando los filtros (pueden ser null o undefined)
    const resultado = await databaseFunctions.obtenerEjerciciosFiltrados(parte_musculo, tipo, dificultad);

    res.status(200).json(resultado);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message
    });
  }
});


// 📌 POST para registrar peso
app.post('/registrar-peso', async (req, res) => {
  const { usuarioId, peso, unidadPeso, actualizar } = req.body;

  if (!usuarioId || !peso || !unidadPeso) {
    return res.status(400).json({ success: false, message: "Faltan datos requeridos." });
  }

  const resultado = await databaseFunctions.insertarPeso(usuarioId, peso, unidadPeso, actualizar);
  res.status(resultado.success ? 200 : 400).json(resultado);
});

// 📌 POST para registrar altura
app.post('/registrar-altura', async (req, res) => {
  const { usuarioId, altura, unidadAltura, actualizar } = req.body;

  if (!usuarioId || !altura || !unidadAltura) {
    return res.status(400).json({ success: false, message: "Faltan datos requeridos." });
  }

  const resultado = await databaseFunctions.insertarAltura(usuarioId, altura, unidadAltura, actualizar);
  res.status(resultado.success ? 200 : 400).json(resultado);
});

//Método para agregar experiencia
app.post('/actualizar-experiencia', async (req, res) => {
  const { usuarioId, experiencia } = req.body;

  if (!usuarioId || experiencia === undefined) {
    return res.status(400).json({ success: false, message: "Faltan parámetros" });
  }

  const result = await databaseFunctions.actualizarExperiencia(usuarioId, experiencia);

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.status(200).json(result);
});

// ✅ POST - Obtener registros de PESO
app.post('/obtener-peso', async (req, res) => {
  const { usuarioId } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ success: false, message: "Falta el usuarioId" });
  }

  const result = await databaseFunctions.obtenerRegistrosPeso(usuarioId);
  res.status(result.success ? 200 : 404).json(result);
});

// ✅ POST - Obtener registros de ALTURA
app.post('/obtener-altura', async (req, res) => {
  const { usuarioId } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ success: false, message: "Falta el usuarioId" });
  }

  const result = await databaseFunctions.obtenerRegistrosAltura(usuarioId);
  res.status(result.success ? 200 : 404).json(result);
});

// ✅ POST - Actualizar contraseña
app.post('/actualizar-contrasena', async (req, res) => {
  const { usuarioId, contrasenaActual, nuevaContrasena } = req.body;

  if (!usuarioId || !contrasenaActual || !nuevaContrasena) {
    return res.status(400).json({ success: false, message: "Faltan parámetros" });
  }

  const result = await databaseFunctions.actualizarContrasena(usuarioId, contrasenaActual, nuevaContrasena);
  res.status(result.success ? 200 : 400).json(result);
});

// ✅ POST - Actualizar datos del usuario
app.post('/actualizar-datos', async (req, res) => {
  const { usuarioId, datos } = req.body;

  if (!usuarioId || !datos) {
    return res.status(400).json({ success: false, message: "Faltan parámetros" });
  }

  const result = await databaseFunctions.actualizarDatosUsuario(usuarioId, datos);
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/obtener-estadisticas-ejercicio', async (req, res) => {
  const { usuario_id, ejercicio_id } = req.body;

  if (!usuario_id || !ejercicio_id) {
    return res.status(400).json({ error: "usuario_id y ejercicio_id son requeridos" });
  }

  try {
    const rawData = await databaseFunctions.getUserExerciseStats(usuario_id, ejercicio_id);

    // Agrupar por fecha
    const groupedData = rawData.reduce((acc, curr) => {
      const { fecha, serie, peso, repeticiones } = curr;
      const formattedFecha = new Date(fecha).toISOString().split('T')[0]; // 🔹 Conversión correcta

      if (!acc[formattedFecha]) {
        acc[formattedFecha] = [];
      }
      acc[formattedFecha].push({ serie, peso, repeticiones });
      return acc;
    }, {});

    // Convertir objeto en array con la fecha en formato correcto
    const formattedResponse = Object.keys(groupedData).map((fecha) => ({
      fecha, // 🔹 Ahora en formato "YYYY-MM-DD"
      series: groupedData[fecha]
    }));

    res.json({ success: true, estadisticas: formattedResponse });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las estadísticas" });
  }
});


// 📌 POST: Crear una nueva rutina
app.post('/rutinas-personalizadas', async (req, res) => {
  try {
    let { nombre, descripcion, nivel, objetivo, usuario_id, ejercicios } = req.body;

    if (!nombre || !nivel || !objetivo || !usuario_id || !ejercicios) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    // Si ejercicios llega como string, parsear:
    if (typeof ejercicios === 'string') {
      ejercicios = JSON.parse(ejercicios);
    }

    const rutinaId = await databaseFunctions.crearRutina(
      nombre, descripcion, nivel, objetivo, usuario_id, ejercicios
    );
    res.status(201).json({ message: 'Rutina creada exitosamente', rutinaId });
  } catch (error) {
    console.error('❌ Error en endpoint:', error);
    res.status(500).json({ error: 'Error al crear la rutina', details: error.message });
  }
});


// 📌 POST: Obtener rutinas con días asignados por usuario
app.post('/rutinas', async (req, res) => {
  try {
    const { usuarioId } = req.body;
    if (!usuarioId) {
      return res.status(400).json({ error: "El usuarioId es obligatorio" });
    }

    const rutinas = await databaseFunctions.obtenerRutinasConDias(usuarioId);


    res.json(rutinas); // Devuelve las rutinas o un array vacío si no hay
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las rutinas', details: error.message });
  }
});


// 📌 DELETE: Eliminar rutina por ID
app.delete('/rutina/:rutinaId', async (req, res) => {
  try {
    const { rutinaId } = req.params;
    const usuarioId = req.query.usuarioId;

    if (!rutinaId || !usuarioId) {
      return res.status(400).json({ error: "Se requieren rutinaId y usuarioId" });
    }

    const resultado = await databaseFunctions.eliminarRutina(parseInt(rutinaId), parseInt(usuarioId));

    if (!resultado.success) {
      return res.status(404).json({ message: resultado.message });
    }

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error al eliminar la rutina:', error);
    res.status(500).json({ error: 'Error al eliminar la rutina', details: error.message });
  }
});


// 📌 PUT: Actualizar rutina_id de un usuario
app.put('/usuario/rutina', async (req, res) => {
  try {
    const { usuarioId, nuevaRutinaId } = req.body;

    if (!usuarioId || !nuevaRutinaId) {
      return res.status(400).json({ error: "usuarioId y nuevaRutinaId son obligatorios" });
    }

    const resultado = await databaseFunctions.actualizarRutinaUsuario(usuarioId, nuevaRutinaId);

    if (!resultado.success) {
      return res.status(404).json({ message: resultado.message });
    }

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar la rutina del usuario', details: error.message });
  }
});
// PUT: Remplaza un ejercicio de la rutina por otro
app.put('/remplazar/:rutinaId/ejercicios/:ejercicioAsignadoId', async (req, res) => {
  const { rutinaId, ejercicioAsignadoId } = req.params;
  const { nuevoEjercicioId } = req.body;

  try {
    const result = await databaseFunctions.reemplazarEjercicio(rutinaId, ejercicioAsignadoId, nuevoEjercicioId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




//-----------------------------------Desde aquí empizan los nuevos Endpints para la actualizacion que implementa un sistema de amistades-------------------------------
//Endpoint para guardar una publicación
app.post('/publicaciones', async (req, res) => {
  try {
    const { usuario_id, contenido, imagen_url, video_url } = req.body;

    if (!usuario_id || (!contenido && !imagen_url && !video_url)) {
      return res.status(400).json({ error: 'Datos insuficientes' });
    }

    const publicacionId = await databaseFunctions.crearPublicacion({
      usuario_id,
      contenido,
      imagen_url,
      video_url
    });

    res.status(201).json({ mensaje: 'Publicación creada', id: publicacionId });
  } catch (error) {
    console.error('Error al crear publicación:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para obtener las publicaciones
app.get('/publicaciones/:usuario_id', async (req, res) => {
  try {
    const usuario_id = parseInt(req.params.usuario_id);

    if (isNaN(usuario_id)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }

    const publicaciones = await databaseFunctions.obtenerPublicaciones(usuario_id);

    res.status(200).json(publicaciones);
  } catch (error) {
    console.error('Error al obtener publicaciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para dar o retirar like
app.post('/publicaciones/like', async (req, res) => {
  const { usuario_id, publicacion_id } = req.body;

  if (!usuario_id || !publicacion_id) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const result = await databaseFunctions.toggleLike({ usuario_id, publicacion_id });
    res.status(200).json(result);
  } catch (error) {
    console.error('Error en like:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para crear un comentario
app.post('/publicaciones/comentario', async (req, res) => {
  const { usuario_id, publicacion_id, contenido } = req.body;

  if (!usuario_id || !publicacion_id || !contenido?.trim()) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  try {
    const idComentario = await databaseFunctions.crearComentario({
      usuario_id,
      publicacion_id,
      contenido
    });

    res.status(201).json({ mensaje: 'Comentario creado', id: idComentario });
  } catch (error) {
    console.error('Error al crear comentario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para obtner los comentarios
app.get('/publicaciones/:id/comentarios', async (req, res) => {
  const publicacion_id = parseInt(req.params.id);

  if (isNaN(publicacion_id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const comentarios = await databaseFunctions.obtenerComentarios(publicacion_id);
    res.status(200).json(comentarios);
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Endpoint para eliminar publicación
app.delete('/publicaciones/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await databaseFunctions.eliminarPublicacion(id);
    res.status(200).json({ message: 'Publicación eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar la publicación:', error);
    res.status(500).json({ error: 'Error al eliminar la publicación' });
  }
});



// Endpoint para crear solicitud de amistad
app.post('/solicitudes', async (req, res) => {
  const { solicitanteId, receptorId } = req.body;
  await databaseFunctions.crearSolicitudAmistad(solicitanteId, receptorId);
  res.status(201).json({ message: 'Solicitud enviada' });
});


// Obtener solicitudes recibidas
app.get('/solicitudes/:usuarioId', async (req, res) => {
  const { usuarioId } = req.params;
  const solicitudes = await databaseFunctions.obtenerSolicitudesRecibidas(usuarioId);
  res.json(solicitudes);
});

// Responder a solicitud de amistad
app.post('/solicitudes/responder', async (req, res) => {
  const { solicitudId, estado } = req.body;
  await databaseFunctions.responderSolicitud(solicitudId, estado);
  res.json({ message: `Solicitud ${estado}` });
});

// Buscar usuarios
app.get('/usuarios/buscar', async (req, res) => {
  const { query, userId } = req.query;

  if (!query || isNaN(userId)) {
    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  const resultados = await databaseFunctions.buscarUsuarios(query, parseInt(userId));
  res.json(resultados);
});

// Obtener rutinas compartidas recibidas
app.get('/rutinas/compartidas/:usuarioId', async (req, res) => {
  const { usuarioId } = req.params;
  const rutinas = await databaseFunctions.obtenerRutinasCompartidas(usuarioId);
  res.json(rutinas);
});

// Responder rutina compartida
app.post('/rutinas/compartida/responder', async (req, res) => {
  const { compartidaId, estado } = req.body;
  try {
    await databaseFunctions.responderRutinaCompartida(compartidaId, estado);
    res.status(200).json({ message: 'Rutina respondida correctamente' });
  } catch (error) {
    console.error('Error al responder rutina compartida:', error);
    res.status(500).json({ error: 'Error al responder rutina compartida' });
  }
});



// Obtener notificaciones
app.get("/notificaciones/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;

  try {
    const notificaciones = await databaseFunctions.obtenerNotificaciones(usuarioId);

    // Filtrar notificaciones procesadas
    const notificacionesFiltradas = notificaciones.map(notif => {
      if (notif.tipo === 'rutina_compartida' && ['aceptada', 'rechazada'].includes(notif.estado_rutina_compartida)) {
        return { ...notif, estado_rutina_compartida: 'procesada' };
      }
      return notif;
    });

    res.json(notificacionesFiltradas);
  } catch (err) {
    console.error('Error al obtener las notificaciones:', err);  // Log detallado del error
    res.status(500).json({
      message: "Error al cargar las notificaciones",
      details: err.message,
      stack: err.stack  // Agregar el stacktrace para obtener más detalles
    });
  }
});



// Marcar notificación como leída
app.post('/notificaciones/leida', async (req, res) => {
  const { notificacionId } = req.body;
  await databaseFunctions.marcarNotificacionLeida(notificacionId);
  res.json({ message: 'Notificación marcada como leída' });
});

//Endpoint para natificaiones no leidas
app.get('/notificaciones/:usuarioId/noleidas', async (req, res) => {
  const { usuarioId } = req.params;

  try {
    const total = await databaseFunctions.contarNotificacionesNoLeidas(usuarioId);
    res.json({ total });
  } catch (error) {
    console.error('Error al contar notificaciones no leídas:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para modificar la foto del perfil
app.put('/usuarios/:id/imagen-perfil', async (req, res) => {
  const { id } = req.params;
  const { imagen_url } = req.body;
  console.log('desde el servidor');

  if (!imagen_url) {
    return res.status(400).json({ error: 'URL de imagen faltante' });
  }

  await databaseFunctions.actualizarImagenPerfil(id, imagen_url);
  res.json({ message: 'Imagen de perfil actualizada' });
});

//Endpoint para obtener lista de amigos
app.get('/amigos/:id', async (req, res) => {
  try {
    const amigos = await databaseFunctions.obtenerAmigos(req.params.id);
    res.json(amigos);
  } catch (error) {
    console.error('Error al obtener amigos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para eliminar amistad
app.post('/amigos/eliminar', async (req, res) => {
  const { usuarioId, amigoId } = req.body;
  if (!usuarioId || !amigoId) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    await databaseFunctions.eliminarAmistad(usuarioId, amigoId);
    res.status(200).json({ mensaje: 'Amistad eliminada' });
  } catch (error) {
    console.error('Error al eliminar amigo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

//Endpoint para compartir rutinas
app.post('/rutinas/compartir-multiples', async (req, res) => {
  const { usuario_id, usuario_destino_id, rutina_ids } = req.body;

  try {
    await databaseFunctions.compartirMultiplesRutinas(usuario_id, usuario_destino_id, rutina_ids);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error al compartir rutinas:', error);
    res.status(500).json({ error: 'Error al compartir rutinas' });
  }
});






// Configurar el servidor para escuchar en un puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
});
