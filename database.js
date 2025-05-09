import mysql from 'mysql2';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { enviarNotificacionPush } from './push.js';



dotenv.config();
export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT || 3306, // 🔥 Agregar el puerto
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
}).promise();




// 📌 Obtener la fecha actual en formato YYYY-MM-DD
const obtenerFechaActual = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Meses van de 0-11
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Función para comprobar si un correo o teléfono ya existen en la base de datos
export async function verificarCorreoTelefono(correo, telefono) {
  const connection = await pool.getConnection();
  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM usuarios WHERE correo = ?) AS correoExiste,
        (SELECT COUNT(*) FROM usuarios WHERE telefono = ?) AS telefonoExiste
    `;

    const [rows] = await connection.query(query, [correo, telefono]);

    return {
      correoExiste: rows[0].correoExiste > 0,
      telefonoExiste: rows[0].telefonoExiste > 0,
    };
  } catch (error) {
    console.error("Error al verificar correo/teléfono:", error.message);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

// Función para insertar un usuario en la base de datos
export async function insertUser(
  nombre, apellido, telf, correo, contrasena, objetivo,
  lugar, actividad, sexo, enfoque, dias, peso, tipoPeso,
  pesoObjetivo, altura, tipoAltura, edad, horas, restricciones, token, nivel
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 🔍 Verificar si el correo ya está registrado
    const queryCorreo = `SELECT id FROM usuarios WHERE correo = ?`;
    const [existeCorreo] = await connection.query(queryCorreo, [correo]);

    if (existeCorreo.length > 0) {
      connection.release();
      return { success: false, message: "El correo ya está registrado." };
    }

    // 🔍 Verificar si el teléfono ya está registrado
    const queryTelefono = `SELECT id FROM usuarios WHERE telefono = ?`;
    const [existeTelefono] = await connection.query(queryTelefono, [telf]);

    if (existeTelefono.length > 0) {
      connection.release();
      return { success: false, message: "El teléfono ya está registrado." };
    }

    // 🔑 Encriptar la contraseña antes de insertarla
    const hashedPassword = await bcrypt.hash(contrasena, 10);

    // 📝 Insertar usuario
    const queryUsuario = `
      INSERT INTO usuarios 
      (nombre, apellido, telefono, correo, contrasena, objetivo, lugar, actividad, sexo, enfoque, dias, 
      peso, unidad_peso, peso_objetivo, altura, unidad_altura, edad, horas_entrenamiento, restricciones_fisicas, 
      token_confirmacion, nivel) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const valuesUsuario = [
      nombre, apellido, telf, correo, hashedPassword, objetivo, lugar, actividad, sexo,
      enfoque, JSON.stringify(dias), peso, tipoPeso, pesoObjetivo, altura, tipoAltura,
      edad, horas, JSON.stringify(restricciones), token, nivel
    ];

    const [resultUsuario] = await connection.query(queryUsuario, valuesUsuario);
    const userId = resultUsuario.insertId; // Obtener el ID del usuario insertado

    // 📅 Fecha actual
    const fechaActual = obtenerFechaActual();

    // 📌 Insertar peso en la tabla `peso_usuario`
    const queryPeso = `INSERT INTO peso (usuario_id, peso, unidad_peso, fecha) VALUES (?, ?, ?, ?)`;
    await connection.query(queryPeso, [userId, peso, tipoPeso, fechaActual]);

    // 📌 Insertar altura en la tabla `altura_usuario`
    const queryAltura = `INSERT INTO altura (usuario_id, altura, unidad_altura, fecha) VALUES (?, ?, ?, ?)`;
    await connection.query(queryAltura, [userId, altura, tipoAltura, fechaActual]);

    // ✅ Confirmar la transacción
    await connection.commit();

    return { success: true, message: "Usuario insertado con éxito", userId };

  } catch (err) {
    await connection.rollback();
    console.error("❌ Error al insertar el usuario:", err);
    return { success: false, message: "Error al insertar usuario", error: err.message };
  } finally {
    connection.release();
  }
}



// Función para buscar usuario token y validar correo
export async function validateCorreo(token) {
  try {
    const query = `SELECT * FROM usuario WHERE token_confirmacion = ?`;
    const [rows] = await pool.query(query, [token]);

    if (rows.length === 0) {
      return { success: false, message: 'Token no encontrado' };
    }

    const user = rows[0];
    //Confirmar el correo

    try {
      const query = `UPDATE usuario SET confirmacion_correo = ? WHERE correo = ?`;
      const [rows] = await pool.query(query, [true, user.correo]);
      if (!rows.length === 0) {
        return { success: false, message: 'Token no encontrado' };
      }
    } catch (error) {

    }
    // Retornar éxito y datos del usuario (sin la contraseña)
    return {
      success: true,
      message: 'Usuario validado correctamente',
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        correo: user.correo,
        edad: user.edad,
        sexo: user.sexo,
        objetivo: user.objetivo,
        ha_pagado: user.ha_pagado,
        registro_confirmado: user.confirmacion_correo
      }
    };
  } catch (error) {
    console.error('Error al validar usuario:', error);
    throw new Error('Error al validar usuario: ' + error.message);
  }
}
// Función para buscar usuario por correo y validar contraseña
export async function validateUser(correo, contraseña) {
  try {
    const query = `SELECT * FROM usuarios WHERE correo = ?`;
    const [rows] = await pool.query(query, [correo]);

    if (rows.length === 0) {
      return { success: false, message: 'Usuario no encontrado' };
    }

    const user = rows[0];

    // Comparar la contraseña ingresada con la encriptada almacenada
    const passwordMatch = await bcrypt.compare(contraseña, user.contrasena);

    if (!passwordMatch) {
      return { success: false, message: 'Contraseña incorrecta' };
    }
    //Comprobar que el usuario haya validado su correo
    // if(user.confirmacion_correo === 0){
    // return{
    // success: 'validar',
    // message: 'Confirma tu correo'
    // }
    //}

    // Retornar éxito y datos del usuario (sin la contraseña)
    return {
      success: true,
      message: 'Usuario validado correctamente',
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        telefono: user.telefono, // Agregado: Teléfono del usuario
        correo: user.correo,
        contrasena: undefined, // Nunca enviar la contraseña por razones de seguridad
        edad: user.edad,
        sexo: user.sexo,
        peso: user.peso,
        unidad_peso: user.unidad_peso, // Agregado: Unidad del peso (kg/lb)
        peso_objetivo: user.peso_objetivo, // Agregado: Peso objetivo
        altura: user.altura,
        unidad_altura: user.unidad_altura, // Agregado: Unidad de altura (m/ft)
        intensidad: user.cantidad_dias, // Modificado: Corregido el typo "intensidad"
        rutina_id: user.rutina_id, // Modificado: Usar "rutina_id" para consistencia con la base de datos
        objetivo: user.objetivo,
        lugar: user.lugar, // Agregado: Lugar (gimnasio, casa, aire libre)
        actividad: user.actividad, // Agregado: Nivel de actividad (sedentario, ligero, etc.)
        enfoque: user.enfoque, // Agregado: Enfoque de entrenamiento (pecho, espalda, etc.)
        dias: user.dias, // Agregado: Días seleccionados
        restricciones_fisicas: user.restricciones_fisicas, // Agregado: Restricciones físicas
        ha_pagado: user.ha_pagado,
        registro_confirmado: user.confirmacion_correo,
        horas_entrenamiento: user.horas_entrenamiento, // Agregado: Horas de entrenamiento al día
        token_confirmacion: user.token_confirmacion, // Agregado: Token para confirmar el registro
        suscripcion: user.suscripcion, // Agregado: Estado de la suscripción
        nivel: user.nivel,
        experiencia: user.experiencia,
        imagen_url: user.imagen_url
      }
    };
  } catch (error) {
    console.error('Error al validar usuario:', error);
    throw new Error('Error al validar usuario: ' + error.message);
  }
}
export async function obtenerRutinaCompleta(rutinaId) {
  try {
    const query = `
          SELECT d.id AS dia_id, d.nombre_dia, d.musculos_dia, 
                 e.id AS ejercicio_id, e.nombre AS ejercicio_nombre, e.musculo, e.descripcion, e.tipo, e.dificultad
          FROM dias d
          LEFT JOIN ejercicios_asignados ea ON d.id = ea.dia_id
          LEFT JOIN ejercicios e ON ea.ejercicio_id = e.id
          WHERE d.rutina_id = ?
          ORDER BY d.id;
      `;

    const [rows] = await pool.query(query, [rutinaId]);

    if (!rows.length) {
      return { success: false, message: "No se encontraron días ni ejercicios para esta rutina" };
    }

    const rutina = {};
    rows.forEach(row => {
      // 🔹 Verificar si musculos_dia es NULL o tiene un formato incorrecto
      let musculosDia = [];
      if (row.musculos_dia) {
        const musculosString = String(row.musculos_dia); // Convertir a cadena
        musculosDia = musculosString.startsWith("[")
          ? JSON.parse(musculosString)  // ✅ Es un JSON válido
          : musculosString.split(","); // ✅ Convertir string separado por comas a array
      }

      if (!rutina[row.nombre_dia]) {
        rutina[row.nombre_dia] = {
          nombre_dia: row.nombre_dia,
          musculos_dia: musculosDia,
          ejercicios: []
        };
      }

      if (row.ejercicio_id) {
        rutina[row.nombre_dia].ejercicios.push({
          id: row.ejercicio_id,
          nombre: row.ejercicio_nombre,
          musculo: row.musculo,
          descripcion: row.descripcion,
          tipo: row.tipo,
          dificultad: row.dificultad
        });
      }
    });

    return { success: true, rutina: Object.values(rutina) };

  } catch (error) {
    console.error("❌ Error al obtener la rutina completa:", error);
    return { success: false, message: "Error interno del servidor" };
  }
}




export async function obtenerEjercicios(rutinaId, dia) {
  try {
    // Consulta para obtener los ejercicios asignados a un día de una rutina específica
    const query = `
      SELECT 
        d.musculos_dia, -- 🔹 Se asegura de traer los músculos del día
        e.id AS ejercicio_id, 
        e.nombre AS titulo, 
        e.musculo, 
        e.tipo AS tipo_ejercicio, 
        e.parte_musculo, 
        e.imagen, 
        e.video, 
        ea.descanso, 
        s.repeticiones, 
        s.tiempo_aproximado,
        e.calorias_por_set AS calorias
      FROM dias d
      LEFT JOIN ejercicios_asignados ea ON d.id = ea.dia_id
      LEFT JOIN ejercicios e ON ea.ejercicio_id = e.id
      LEFT JOIN series s ON ea.id = s.ejercicio_asignado_id
      WHERE d.rutina_id = ? AND d.nombre_dia = ?
      ORDER BY e.id
    `;

    // Ejecutar la consulta con los parámetros proporcionados
    const [rows] = await pool.query(query, [rutinaId, dia]);


    // Si no se encuentran ejercicios, retornar una respuesta adecuada
    if (rows.length === 0) {
      return {
        success: false,
        message: `No se encontraron ejercicios para ${dia}.`,
        musculos_dia: [], // 🔹 Devolver la lista de músculos vacía
        ejercicios: [] // 🔹 Devolver la lista de ejercicios vacía
      };
    }

    // 🔹 Recuperar `musculos_dia` correctamente, asegurando que sea un array válido
    // Verificar si musculos_dia ya está en formato JSON
    let musculosDia = [];
    if (rows[0]?.musculos_dia) {
      try {
        musculosDia = Array.isArray(rows[0].musculos_dia)
          ? rows[0].musculos_dia // Ya es un array válido
          : JSON.parse(rows[0].musculos_dia); // Intentar parsear solo si es JSON
      } catch (error) {
        musculosDia = rows[0].musculos_dia.split(',').map(m => m.trim()); // ✅ Convertir texto a array manualmente
      }
    }

    if (rows[0]?.musculos_dia) {
      try {
        musculosDia = JSON.parse(rows[0].musculos_dia);
      } catch (error) {
      }
    }

    // Organizar los datos en un formato más útil, agrupando por ejercicio
    const ejerciciosAgrupados = rows.reduce((acc, row) => {
      if (!acc[row.ejercicio_id] && row.ejercicio_id) {
        acc[row.ejercicio_id] = {
          id: row.ejercicio_id,
          titulo: row.titulo,
          musculo: row.musculo,
          tipo: row.tipo_ejercicio,
          parte_musculo: row.parte_musculo,
          imagen: row.imagen,
          video: row.video,
          descanso: row.descanso,
          calorias: row.calorias,
          series: [],
        };
      }
      if (row.ejercicio_id) {
        acc[row.ejercicio_id].series.push({
          repeticiones: row.repeticiones,
          tiempo_aproximado: row.tiempo_aproximado
        });
      }
      return acc;
    }, {});

    return {
      success: true,
      message: 'Ejercicios encontrados correctamente',
      musculos_dia: musculosDia, // 🔹 Ahora devuelve los músculos del día correctamente
      ejercicios: Object.values(ejerciciosAgrupados) // 🔹 Convertimos el objeto agrupado en un array
    };

  } catch (error) {
    // Manejar cualquier error que ocurra durante la ejecución de la consulta
    console.error('❌ Error al obtener los ejercicios:', error.message);
    return {
      success: false,
      message: `Error al obtener los ejercicios: ${error.message}`,
      musculos_dia: [], // 🔹 Devuelve una lista vacía en caso de error
      ejercicios: [] // 🔹 Devuelve una lista vacía en caso de error
    };
  }
}




//Función para obtener materiales
export async function obtenerMateriales(id_ejercicio) {
  try {
    // Consulta para obtener la información completa de los materiales
    const query = `
      SELECT id, nombre
      FROM materiales
      WHERE ejercicio_id = ?
    `;
    // Ejecutar la consulta con los parámetros proporcionados
    const [rows] = await pool.query(query, [id_ejercicio]);

    // Si no se encuentran materiales, retornar una respuesta adecuada
    if (rows.length === 0) {
      return {
        success: false,
        message: 'No se encontraron materiales para el ejercicio',
        rows: []  // Array vacío cuando no hay materiales
      };
    }

    // Si se encuentran materiales, retornar los resultados
    return {
      success: true,
      message: 'materiales encontrados correctamente',
      rows: rows // Retornamos los ejercicios encontrados
    };
  } catch (error) {
    // Manejar cualquier error que ocurra durante la ejecución de la consulta
    console.error('Error al obtener los materiales:', error.message);
    return {
      success: false,
      message: `Error al obtener los materiales: ${error.message}`,
      rows: []  // Array vacío en caso de error
    };
  }
}

//Función para obtener las instrucciones del ejercicio
export async function obtenerInstrucciones(id_ejercicio) {
  try {
    // Consulta para obtener la información completa de las instrcucicones
    const query = `
      SELECT id, descripcion
      FROM instrucciones
      WHERE ejercicio_id = ?
    `;
    // Ejecutar la consulta con los parámetros proporcionados
    const [rows] = await pool.query(query, [id_ejercicio]);

    // Si no se encuentran instrcucicones, retornar una respuesta adecuada
    if (rows.length === 0) {
      ;
      return {
        success: false,
        message: 'No se encontraron instrcucicones para el ejercicio',
        rows: []  // Array vacío cuando no hay instrcucicones
      };
    }

    // Si se encuentran ejercicios, retornar los resultados
    return {
      success: true,
      message: 'instrcucicones encontrados correctamente',
      rows: rows // Retornamos los ejercicios encontrados
    };
  } catch (error) {
    // Manejar cualquier error que ocurra durante la ejecución de la consulta
    console.error('Error al obtener las instrcucicones:', error.message);
    return {
      success: false,
      message: `Error al obtener las instrcucicones: ${error.message}`,
      rows: []  // Array vacío en caso de error
    };
  }
}

// Insertar o actualizar estadísticas de un ejercicio
export async function insertarEstadistica(usuarioId, ejercicioId, fecha, series) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 🔹 Verificar si ya existe una estadística para el usuario y el ejercicio
    let [estadistica] = await connection.query(
      `SELECT id FROM estadisticas WHERE usuario_id = ? AND ejercicio_id = ? LIMIT 1`,
      [usuarioId, ejercicioId]
    );

    let estadisticaId;
    if (estadistica.length === 0) {
      const [resultadoEstadistica] = await connection.query(
        `INSERT INTO estadisticas (usuario_id, ejercicio_id) VALUES (?, ?)`,
        [usuarioId, ejercicioId]
      );
      estadisticaId = resultadoEstadistica.insertId;
    } else {
      estadisticaId = estadistica[0].id;
    }

    // 🔹 Verificar si ya existe una entrada en 'fechas' para esta fecha
    let [fechaExistente] = await connection.query(
      `SELECT id FROM fechas WHERE estadistica_id = ? AND fecha = ? LIMIT 1`,
      [estadisticaId, fecha]
    );

    let fechaId;
    if (fechaExistente.length === 0) {
      const [resultadoFecha] = await connection.query(
        `INSERT INTO fechas (estadistica_id, fecha) VALUES (?, ?)`,
        [estadisticaId, fecha]
      );
      fechaId = resultadoFecha.insertId;
    } else {
      fechaId = fechaExistente[0].id;

      // 🔹 Eliminar series previas para evitar duplicados
      await connection.query(`DELETE FROM series_estadistica WHERE fecha_id = ?`, [fechaId]);
    }

    // 🔹 Insertar las nuevas series
    for (let serie of series) {
      const { peso, repeticiones, serieNum } = serie;
      await connection.query(
        `INSERT INTO series_estadistica (fecha_id, peso, repeticiones, serie) VALUES (?, ?, ?, ?)`,
        [fechaId, peso, repeticiones, serieNum]
      );
    }

    await connection.commit();
    connection.release();
    return { success: true, message: 'Estadística insertada o actualizada correctamente' };

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('❌ Error al insertar o actualizar la estadística:', error);
    return { success: false, message: 'Error al insertar o actualizar la estadística', error: error.message };
  }
}

// 📌 1️⃣ Verificar si existe un registro de estadística para un usuario, ejercicio y fecha
export async function comprobarEstadistica(usuarioId, ejercicioId, fecha) {
  try {
    const [result] = await pool.query(
      `SELECT id FROM fechas 
           WHERE estadistica_id IN (
              SELECT id FROM estadisticas 
              WHERE usuario_id = ? AND ejercicio_id = ?
           ) AND fecha = ? LIMIT 1`,
      [usuarioId, ejercicioId, fecha]
    );

    return { existe: result.length > 0 };
  } catch (error) {
    console.error("❌ Error al comprobar estadística:", error);
    return { existe: false, error: error.message };
  }
}


// Obtener la estadística de las series de un ejercicio
export async function obtenerEstadisticaSeries(usuarioId, ejercicioId, fecha = null) {
  try {
    const connection = await pool.getConnection();

    // 1️⃣ Obtener el id de la estadística para el usuario y ejercicio
    const [estadisticas] = await connection.execute(
      `SELECT id FROM estadisticas WHERE usuario_id = ? AND ejercicio_id = ? LIMIT 1`,
      [usuarioId, ejercicioId]
    );

    if (estadisticas.length === 0) {
      connection.release();
      return []; // No hay datos para ese usuario y ejercicio
    }

    const estadisticaId = estadisticas[0].id;

    // 2️⃣ Si no se pasa fecha, obtener el último id registrado en la tabla `fechas`
    if (!fecha) {
      const [ultimaFecha] = await connection.execute(
        `SELECT id, fecha FROM fechas WHERE estadistica_id = ? ORDER BY id DESC LIMIT 1`,
        [estadisticaId]
      );

      if (ultimaFecha.length === 0) {
        connection.release();
        return []; // No hay registros en `fechas`
      }

      const ultimoFechaId = ultimaFecha[0].id; // Último ID registrado en `fechas`
      fecha = ultimaFecha[0].fecha; // También guardamos la fecha correspondiente

      // 3️⃣ Obtener las series asociadas al último id registrado en `fechas`
      const [series] = await connection.execute(
        `SELECT s.id, s.peso, s.repeticiones, s.serie, f.fecha
         FROM series_estadistica s
         JOIN fechas f ON s.fecha_id = f.id
         WHERE f.id = ?
         ORDER BY s.serie ASC`,
        [ultimoFechaId]
      );

      connection.release();
      return series;
    }

    // 4️⃣ Si se pasa una fecha específica, obtener las series normalmente
    const [series] = await connection.execute(
      `SELECT s.id, s.peso, s.repeticiones, s.serie, f.fecha
       FROM series_estadistica s
       JOIN fechas f ON s.fecha_id = f.id
       WHERE f.estadistica_id = ? AND f.fecha = ?
       ORDER BY s.serie ASC`,
      [estadisticaId, fecha]
    );

    connection.release();
    return series;
  } catch (error) {
    console.error('Error al obtener series de estadísticas:', error);
    throw error;
  }
}
// ✅ Función para registrar un ejercicio como completado
export async function registrarEjercicioCompletado(usuarioId, ejercicioId, fecha) {
  try {
    const connection = await pool.getConnection();

    // Evitar registros duplicados para la misma fecha y usuario
    const [existing] = await connection.execute(
      `SELECT id FROM ejercicios_completados WHERE usuario_id = ? AND ejercicio_id = ? AND fecha = ?`,
      [usuarioId, ejercicioId, fecha]
    );

    if (existing.length > 0) {
      connection.release();
      return { success: false, message: "El ejercicio ya fue registrado como completado para esta fecha" };
    }

    // Insertar el nuevo registro
    const [result] = await connection.execute(
      `INSERT INTO ejercicios_completados (usuario_id, ejercicio_id, fecha) VALUES (?, ?, ?)`,
      [usuarioId, ejercicioId, fecha]
    );

    connection.release();
    return { success: true, message: "Ejercicio registrado como completado", id: result.insertId };

  } catch (error) {
    console.error("❌ Error en registrarEjercicioCompletado:", error);
    throw error;
  }
}
// ✅ Función para consultar si un ejercicio está completado en una fecha específica
export async function verificarEjercicioCompletado(usuarioId, ejercicioId, fecha) {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.execute(
      `SELECT id FROM ejercicios_completados WHERE usuario_id = ? AND ejercicio_id = ? AND fecha = ?`,
      [usuarioId, ejercicioId, fecha]
    );

    connection.release();

    return { completado: result.length > 0 }; // ✅ Devuelve true si el ejercicio está completado
  } catch (error) {
    console.error("❌ Error en verificarEjercicioCompletado:", error);
    throw error;
  }
}
//Función para verificar si la rutina del dia ha sido completada
const verificarTodosEjerciciosCompletados = async (rutina_id, dia, fecha) => {
  try {
    // 1️⃣ Obtener los ejercicios asignados para el día específico
    const resultado = await obtenerEjercicios(rutina_id, dia);

    if (!resultado.success || resultado.ejercicios.length === 0) {
      return false;
    }

    const totalEjercicios = resultado.ejercicios.length;
    const ejercicioIds = resultado.ejercicios.map(e => e.id);

    // 2️⃣ Contar cuántos ejercicios han sido completados en la fecha dada
    const completadosQuery = `
      SELECT COUNT(*) AS completados 
      FROM ejercicios_completados 
      WHERE fecha = ? AND ejercicio_id IN (?);
    `;
    const [completados] = await pool.query(completadosQuery, [fecha, ejercicioIds]);

    const totalCompletados = completados[0].completados;

    // 3️⃣ Devolver true si todos los ejercicios están completados
    return totalCompletados === totalEjercicios;

  } catch (error) {
    console.error("❌ Error al verificar ejercicios completados:", error);
    return false;
  }
};
//Función para registrar rutina completada
const registrarRutinaCompletada = async (usuario_id, fecha) => {
  try {
    // 1️⃣ Verificar si la rutina ya está registrada para la fecha dada
    const verificarQuery = `SELECT COUNT(*) AS count FROM rutina_completada WHERE usuario_id = ? AND fecha = ?`;
    const [verificar] = await pool.query(verificarQuery, [usuario_id, fecha]);

    if (verificar[0].count > 0) {
      return { success: false, message: "La rutina ya está registrada para esta fecha." };
    }

    // 2️⃣ Insertar en la tabla si no se ha registrado
    const insertarQuery = `INSERT INTO rutina_completada (usuario_id, fecha) VALUES (?, ?)`;
    await pool.query(insertarQuery, [usuario_id, fecha]);

    return { success: true, message: "Rutina completada registrada exitosamente." };

  } catch (error) {
    console.error("❌ Error al registrar la rutina completada:", error);
    return { success: false, message: "Error interno del servidor." };
  }
};

//Función para comprobar rutinas completadas
const comprobarRutinaCompletada = async (usuario_id, fecha) => {
  try {
    // Consulta para verificar si existe un registro de rutina completada para el usuario y la fecha especificada
    const query = `SELECT COUNT(*) AS count FROM rutina_completada WHERE usuario_id = ? AND fecha = ?`;
    const [result] = await pool.query(query, [usuario_id, fecha]);

    const completado = result[0].count > 0;

    if (completado) {
      return { success: true, completado: true, message: "Rutina completada." };
    } else {
      return { success: true, completado: false, message: "Rutina no completada." };
    }

  } catch (error) {
    console.error("❌ Error al comprobar rutina completada:", error);
    return { success: false, completado: false, message: "Error interno del servidor." };
  }
};

//Función para obtener todos los ejercicios pasado unos parametros
export async function obtenerEjerciciosFiltrados(parte_musculo = null, tipo = null, dificultad = null) {
  try {
    let query = `
      SELECT 
        e.id, 
        e.nombre, 
        e.descripcion, 
        e.musculo, 
        e.tipo, 
        e.parte_musculo, 
        e.imagen, 
        e.video, 
        e.dificultad, 
        e.calorias_por_set 
      FROM ejercicios e
      WHERE 1 = 1`; // Empieza con una condición siempre verdadera para facilitar concatenaciones

    const params = [];

    // Filtro dinámico por parte_musculo
    if (parte_musculo) {
      query += " AND e.parte_musculo = ?";
      params.push(parte_musculo);
    }

    if (tipo) {
      query += " AND e.tipo = ?";
      params.push(tipo);
    }

    if (dificultad) {
      query += " AND e.dificultad = ?";
      params.push(dificultad);
    }

    query += " ORDER BY e.nombre ASC"; // Opcional: ordenar alfabéticamente

    const [rows] = await pool.query(query, params);

    return {
      success: true,
      message: "Ejercicios obtenidos correctamente",
      ejercicios: rows
    };

  } catch (error) {
    console.error("❌ Error al obtener los ejercicios:", error);
    return {
      success: false,
      message: "Error al obtener los ejercicios",
      error: error.message
    };
  }
}




// 📌 Insertar o actualizar peso
export async function insertarPeso(usuarioId, nuevoPeso, unidadPeso, actualizar = false) {
  try {
    const fecha = obtenerFechaActual();

    // Verificar si ya hay un registro para la fecha actual
    const [existeRegistro] = await pool.query(
      `SELECT id FROM peso WHERE usuario_id = ? AND fecha = ?`,
      [usuarioId, fecha]
    );

    if (existeRegistro.length > 0) {
      if (!actualizar) {
        return { success: false, message: "Ya hay un registro de peso para hoy. ¿Deseas actualizarlo?" };
      }

      // 🔹 Si el usuario elige actualizar el registro existente
      await pool.query(
        `UPDATE peso SET peso = ?, unidad_peso = ? WHERE usuario_id = ? AND fecha = ?`,
        [nuevoPeso, unidadPeso, usuarioId, fecha]
      );

      // 🔹 Actualizar la columna `peso` en la tabla `usuarios`
      await pool.query(
        `UPDATE usuarios SET peso = ?, unidad_peso = ? WHERE id = ?`,
        [nuevoPeso, unidadPeso, usuarioId]
      );

      return { success: true, message: "Registro de peso actualizado correctamente." };
    }

    // 🔹 Insertar un nuevo registro de peso
    await pool.query(
      `INSERT INTO peso (usuario_id, peso, unidad_peso, fecha) VALUES (?, ?, ?, ?)`,
      [usuarioId, nuevoPeso, unidadPeso, fecha]
    );

    // 🔹 Actualizar la columna `peso` en la tabla `usuarios`
    await pool.query(
      `UPDATE usuarios SET peso = ?, unidad_peso = ? WHERE id = ?`,
      [nuevoPeso, unidadPeso, usuarioId]
    );

    return { success: true, message: "Peso registrado correctamente." };

  } catch (error) {
    console.error("❌ Error al insertar el peso:", error);
    return { success: false, message: "Error interno del servidor." };
  }
}
// 📌 Insertar o actualizar altura
export async function insertarAltura(usuarioId, nuevaAltura, unidadAltura, actualizar = false) {
  try {
    const fecha = obtenerFechaActual();

    // Verificar si ya hay un registro para la fecha actual
    const [existeRegistro] = await pool.query(
      `SELECT id FROM altura WHERE usuario_id = ? AND fecha = ?`,
      [usuarioId, fecha]
    );

    if (existeRegistro.length > 0) {
      if (!actualizar) {
        return { success: false, message: "Ya hay un registro de altura para hoy. ¿Deseas actualizarlo?" };
      }

      // 🔹 Si el usuario elige actualizar el registro existente
      await pool.query(
        `UPDATE altura SET altura = ?, unidad_altura = ? WHERE usuario_id = ? AND fecha = ?`,
        [nuevaAltura, unidadAltura, usuarioId, fecha]
      );

      // 🔹 Actualizar la columna `altura` en la tabla `usuarios`
      await pool.query(
        `UPDATE usuarios SET altura = ?, unidad_altura = ? WHERE id = ?`,
        [nuevaAltura, unidadAltura, usuarioId]
      );

      return { success: true, message: "Registro de altura actualizado correctamente." };
    }

    // 🔹 Insertar un nuevo registro de altura
    await pool.query(
      `INSERT INTO altura (usuario_id, altura, unidad_altura, fecha) VALUES (?, ?, ?, ?)`,
      [usuarioId, nuevaAltura, unidadAltura, fecha]
    );

    // 🔹 Actualizar la columna `altura` en la tabla `usuarios`
    await pool.query(
      `UPDATE usuarios SET altura = ?, unidad_altura = ? WHERE id = ?`,
      [nuevaAltura, unidadAltura, usuarioId]
    );

    return { success: true, message: "Altura registrada correctamente." };

  } catch (error) {
    console.error("❌ Error al insertar la altura:", error);
    return { success: false, message: "Error interno del servidor." };
  }
}

// ✅ Función para actualizar la experiencia de un usuario
export async function actualizarExperiencia(usuarioId, experiencia) {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE usuarios SET experiencia = ? WHERE id = ?`,
      [experiencia, usuarioId]
    );

    if (result.affectedRows === 0) {
      return { success: false, message: "Usuario no encontrado" };
    }

    return { success: true, message: "Experiencia actualizada correctamente" };
  } catch (error) {
    console.error("❌ Error al actualizar experiencia:", error);
    return { success: false, message: "Error al actualizar experiencia" };
  } finally {
    connection.release();
  }
}

// ✅ Obtener registros de peso
export async function obtenerRegistrosPeso(usuarioId) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM peso WHERE usuario_id = ? ORDER BY fecha DESC`,
      [usuarioId]
    );

    if (rows.length === 0) {
      return { success: false, message: "No se encontraron registros de peso." };
    }

    return { success: true, registros: rows };
  } catch (error) {
    console.error("❌ Error al obtener registros de peso:", error);
    return { success: false, message: "Error al obtener registros de peso." };
  }
}

// ✅ Obtener registros de altura
export async function obtenerRegistrosAltura(usuarioId) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM altura WHERE usuario_id = ? ORDER BY fecha DESC`,
      [usuarioId]
    );

    if (rows.length === 0) {
      return { success: false, message: "No se encontraron registros de altura." };
    }

    return { success: true, registros: rows };
  } catch (error) {
    console.error("❌ Error al obtener registros de altura:", error);
    return { success: false, message: "Error al obtener registros de altura." };
  }
}

// ✅ Función para actualizar la contraseña
export async function actualizarContrasena(usuarioId, contrasenaActual, nuevaContrasena) {
  try {
    // Obtener la contraseña actual almacenada
    const [rows] = await pool.query(`SELECT contrasena FROM usuarios WHERE id = ?`, [usuarioId]);

    if (rows.length === 0) {
      return { success: false, message: "Usuario no encontrado" };
    }

    const contrasenaAlmacenada = rows[0].contrasena;

    // Comparar la contraseña actual ingresada con la almacenada
    const esCorrecta = await bcrypt.compare(contrasenaActual, contrasenaAlmacenada);

    if (!esCorrecta) {
      return { success: false, message: "La contraseña actual es incorrecta" };
    }

    // Encriptar la nueva contraseña
    const nuevaContrasenaHash = await bcrypt.hash(nuevaContrasena, 10);

    // Actualizar la contraseña en la base de datos
    await pool.query(`UPDATE usuarios SET contrasena = ? WHERE id = ?`, [nuevaContrasenaHash, usuarioId]);

    return { success: true, message: "Contraseña actualizada correctamente" };
  } catch (error) {
    console.error("❌ Error al actualizar la contraseña:", error);
    return { success: false, message: "Error al actualizar la contraseña" };
  }
}

// ✅ Función para actualizar los datos del usuario
export async function actualizarDatosUsuario(usuarioId, datosActualizados) {
  try {
    const {
      objetivo, lugar, actividad, sexo, edad, enfoque, unidad_peso, unidad_altura,
      horas_entrenamiento, dias, restricciones, nivel
    } = datosActualizados;

    // Actualizar los datos en la base de datos
    await pool.query(
      `UPDATE usuarios SET 
        objetivo = ?, lugar = ?, actividad = ?, sexo = ?, edad = ?, enfoque = ?, 
        unidad_peso = ?, unidad_altura = ?, horas_entrenamiento = ?, dias = ?, 
        restricciones_fisicas = ?, nivel = ? WHERE id = ?`,
      [
        objetivo, lugar, actividad, sexo, edad, enfoque,
        unidad_peso, unidad_altura, horas_entrenamiento, JSON.stringify(dias),
        JSON.stringify(restricciones), nivel, usuarioId
      ]
    );

    return { success: true, message: "Datos actualizados correctamente" };
  } catch (error) {
    console.error("❌ Error al actualizar los datos del usuario:", error);
    return { success: false, message: "Error al actualizar los datos del usuario" };
  }
}

//Función para obtener todas las estadísticas de un ejercicio
export const getUserExerciseStats = async (usuario_id, ejercicio_id) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
              f.fecha, 
              s.serie, 
              s.peso, 
              s.repeticiones
          FROM estadisticas e
          JOIN fechas f ON e.id = f.estadistica_id
          JOIN series_estadistica s ON f.id = s.fecha_id
          WHERE e.usuario_id = ? AND e.ejercicio_id = ?
          ORDER BY f.fecha DESC, s.serie ASC`,
      [usuario_id, ejercicio_id]
    );
    return rows;
  } catch (error) {
    console.error("Error obteniendo estadísticas:", error);
    throw error;
  }
};


// Función para crear una rutina personalizada
async function crearRutina(nombre, descripcion, nivel, objetivo, usuario_id, ejercicios) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Insertar rutina
    const [rutinaResult] = await connection.execute(
      `INSERT INTO rutinas (nombre, descripcion, nivel, objetivo, usuario_creador_id) VALUES (?, ?, ?, ?, ?)`,
      [nombre, descripcion, nivel, objetivo, usuario_id]
    );
    const rutinaId = rutinaResult.insertId;

    // 2. Insertar días
    const diasMap = {};
    for (const ejercicio of ejercicios) {
      if (!diasMap[ejercicio.dia]) {
        const [diaResult] = await connection.execute(
          `INSERT INTO dias (rutina_id, nombre_dia) VALUES (?, ?)`,
          [rutinaId, ejercicio.dia.toLowerCase()]
        );
        diasMap[ejercicio.dia] = diaResult.insertId;
      }
    }

    // 3. Insertar ejercicios asignados y series
    for (const ejercicio of ejercicios) {
      // Validaciones previas
      const sets = parseInt(ejercicio.sets);
      const reps = parseInt(ejercicio.reps);
      const duracionSet = parseInt(ejercicio.duracionSet);
      const descanso = parseInt(ejercicio.descanso);

      if (isNaN(sets) || isNaN(reps) || isNaN(duracionSet) || isNaN(descanso)) {
        throw new Error(
          `Valores inválidos en ejercicio: ${JSON.stringify(ejercicio)}`
        );
      }

      const [ejercicioAsignadoResult] = await connection.execute(
        `INSERT INTO ejercicios_asignados (dia_id, ejercicio_id, descanso) VALUES (?, ?, ?)`,
        [diasMap[ejercicio.dia], ejercicio.id_ejercicio, descanso]
      );
      const ejercicioAsignadoId = ejercicioAsignadoResult.insertId;

      for (let i = 0; i < sets; i++) {
        await connection.execute(
          `INSERT INTO series (ejercicio_asignado_id, repeticiones, tiempo_aproximado) VALUES (?, ?, ?)`,
          [ejercicioAsignadoId, reps, duracionSet]
        );
      }
    }

    // 4. Asignar rutina al usuario
    await connection.execute(
      `UPDATE usuarios SET rutina_id = ? WHERE id = ?`,
      [rutinaId, usuario_id]
    );

    await connection.commit();
    return rutinaId;
  } catch (error) {
    await connection.rollback();
    console.error('❌ Error al crear la rutina:', error);
    throw error;
  } finally {
    connection.release();
  }
}



//Función para obtener todas las rutinas de un usuario
async function obtenerRutinasConDias(usuarioId) {
  const connection = await pool.getConnection();
  try {
    const [rutinas] = await connection.execute(`
      SELECT id AS rutina_id, nombre, descripcion, nivel, objetivo, fecha_creacion
      FROM rutinas
      WHERE usuario_creador_id = ?
      ORDER BY fecha_creacion DESC
    `, [usuarioId]);

    if (rutinas.length === 0) {
      return [];
    }

    const rutinaIds = rutinas.map(r => r.rutina_id);

    if (rutinaIds.length === 0) {
      return rutinas.map(rutina => ({ ...rutina, dias: [] }));
    }

    const placeholders = rutinaIds.map(() => '?').join(',');
    const [dias] = await connection.execute(`
      SELECT DISTINCT d.rutina_id, d.nombre_dia
      FROM dias d
      JOIN ejercicios_asignados ea ON d.id = ea.dia_id
      WHERE d.rutina_id IN (${placeholders})
      ORDER BY d.rutina_id, d.nombre_dia
    `, rutinaIds);

    const rutinasMap = {};
    rutinas.forEach(rutina => {
      rutinasMap[rutina.rutina_id] = {
        id: rutina.rutina_id,
        nombre: rutina.nombre,
        descripcion: rutina.descripcion,
        nivel: rutina.nivel,
        objetivo: rutina.objetivo,
        fecha_creacion: rutina.fecha_creacion,
        dias: []
      };
    });

    dias.forEach(dia => {
      if (rutinasMap[dia.rutina_id]) {
        rutinasMap[dia.rutina_id].dias.push(dia.nombre_dia);
      }
    });

    return Object.values(rutinasMap);
  } catch (error) {
    console.error("❌ Error en obtenerRutinasConDias:", error);
    throw error;
  } finally {
    connection.release();
  }
}


//Función para eliminar rutinas
export async function eliminarRutina(rutinaId, usuarioId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 🔍 Verificar si el usuario es el creador de la rutina
    const [rows] = await connection.query(
      `SELECT usuario_creador_id FROM rutinas WHERE id = ?`,
      [rutinaId]
    );

    if (rows.length === 0) {
      throw new Error("La rutina no existe");
    }

    const esCreador = rows[0].usuario_creador_id === usuarioId;

    if (esCreador) {
      // 🧨 Usuario es el creador → eliminar completamente la rutina

      // 1. Eliminar series relacionadas
      await connection.execute(`
        DELETE FROM series 
        WHERE ejercicio_asignado_id IN (
          SELECT id FROM ejercicios_asignados WHERE dia_id IN (
            SELECT id FROM dias WHERE rutina_id = ?
          )
        )
      `, [rutinaId]);

      // 2. Eliminar ejercicios asignados
      await connection.execute(`
        DELETE FROM ejercicios_asignados 
        WHERE dia_id IN (
          SELECT id FROM dias WHERE rutina_id = ?
        )
      `, [rutinaId]);

      // 3. Eliminar los días
      await connection.execute(`
        DELETE FROM dias 
        WHERE rutina_id = ?
      `, [rutinaId]);

      // 4. Eliminar la rutina
      await connection.execute(`
        DELETE FROM rutinas 
        WHERE id = ?
      `, [rutinaId]);

    } else {
      // 👥 No es el creador → eliminar de rutinas compartidas
      await connection.execute(`
        DELETE FROM rutinas_compartidas
        WHERE rutina_id = ? AND usuario_destino_id = ?
      `, [rutinaId, usuarioId]);
    }

    await connection.commit();
    return { success: true, message: "Rutina eliminada correctamente" };

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error al eliminar la rutina:", error);
    return { success: false, message: "Error interno al eliminar la rutina" };
  } finally {
    connection.release();
  }
}


//Función para acutalizar la rutina de un usuario
export async function actualizarRutinaUsuario(usuarioId, nuevaRutinaId) {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.execute(
      `UPDATE usuarios SET rutina_id = ? WHERE id = ?`,
      [nuevaRutinaId, usuarioId]
    );

    if (result.affectedRows === 0) {
      return { success: false, message: "Usuario no encontrado o sin cambios" };
    }

    return { success: true, message: "Rutina actualizada exitosamente" };
  } catch (error) {
    console.error("❌ Error al actualizar la rutina del usuario:", error);
    return { success: false, message: "Error interno al actualizar la rutina" };
  } finally {
    connection.release();
  }
}

// Función para sustituir un ejercicio por otro dentro de una rutina
async function reemplazarEjercicio(rutinaId, ejercicioActualId, nuevoEjercicioId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verificar si existen ejercicios asignados con ese ejercicio_id en la rutina
    const [result] = await connection.execute(
      `SELECT ea.id FROM ejercicios_asignados ea
      INNER JOIN dias d ON ea.dia_id = d.id
      WHERE d.rutina_id = ? AND ea.ejercicio_id = ?`,
      [rutinaId, ejercicioActualId]
    );

    if (result.length === 0) {
      throw new Error('No hay ejercicios asignados con ese ID en la rutina indicada');
    }

    // Reemplazar todos los ejercicios_id dentro de la rutina
    await connection.execute(
      `UPDATE ejercicios_asignados ea
      INNER JOIN dias d ON ea.dia_id = d.id
      SET ea.ejercicio_id = ?
      WHERE ea.ejercicio_id = ? AND d.rutina_id = ?`,
      [nuevoEjercicioId, ejercicioActualId, rutinaId]
    );

    await connection.commit();
    return { success: true, message: 'Ejercicios reemplazados exitosamente' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}


























































export async function insertarRutinaEnBaseDeDatos(
  usuarioCreadorId,
  nombreRutina,
  distribucionEjercicios,
  diasEntrenamiento,
  objetivo,
  nivel,
  restricciones,
  tiempoDisponible,
  lugarEntrenamiento
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const volumenPorObjetivoYNivel = {
      'subir peso': {
        principiante: { series: 3, repeticiones: 8 },
        intermedio: { series: 4, repeticiones: 10 },
        avanzado: { series: 4, repeticiones: 12 },
      },
      'bajar peso': {
        principiante: { series: 3, repeticiones: 12 },
        intermedio: { series: 4, repeticiones: 12 },
        avanzado: { series: 4, repeticiones: 15 },
      },
      definir: {
        principiante: { series: 3, repeticiones: 12 },
        intermedio: { series: 3, repeticiones: 15 },
        avanzado: { series: 4, repeticiones: 15 },
      },
      'mantener peso': {
        principiante: { series: 3, repeticiones: 10 },
        intermedio: { series: 3, repeticiones: 12 },
        avanzado: { series: 4, repeticiones: 12 },
      },
      'mejorar resistencia': {
        principiante: { series: 2, repeticiones: 15 },
        intermedio: { series: 3, repeticiones: 15 },
        avanzado: { series: 4, repeticiones: 15 },
      },
    };

    const maxEjerciciosPorNivel = { principiante: 4, intermedio: 6, avanzado: 8 };
    const descansoPorMusculo = {
      pierna: 120,
      pecho: 90,
      espalda: 90,
      gluteo: 120,
      biceps: 60,
      triceps: 60,
      hombro: 60,
      core: 30,
    };
    const tiempoPorSerieSegundos = 30;
    const tiempoDisponibleSegundos = {
      '30 minutos': 1800,
      '1 hora': 3600,
      '2 horas': 7200,
      '3 horas': 10800,
    }[tiempoDisponible];

    const diasSemana = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const diasEntrenamientoOrdenados = diasSemana.filter((dia) =>
      diasEntrenamiento.map((d) => d.toLowerCase()).includes(dia)
    );

    // ✅ Insertar rutina y obtener el ID de forma segura
    const [rutinaResult] = await connection.query(
      `INSERT INTO rutinas (usuario_creador_id, nombre, objetivo, nivel) VALUES (?, ?, ?, ?)`,
      [usuarioCreadorId, nombreRutina, objetivo, nivel]
    );
    const rutinaId = rutinaResult.insertId;

    for (let i = 0; i < diasEntrenamientoOrdenados.length; i++) {
      const diaNombre = diasEntrenamientoOrdenados[i];
      const musculosDelDia = Object.keys(distribucionEjercicios[i]);
      const [diaResult] = await connection.query(
        `INSERT INTO dias (rutina_id, nombre_dia, musculos_dia) VALUES (?, ?, ?)`,
        [rutinaId, diaNombre, JSON.stringify(musculosDelDia)]
      );
      const diaId = diaResult.insertId;

      const dia = distribucionEjercicios[i];
      const { series, repeticiones } = volumenPorObjetivoYNivel[objetivo][nivel];
      const maxEjerciciosDia = maxEjerciciosPorNivel[nivel];

      let ejerciciosAsignados = 0;
      let tiempoTotalEstimado = 0;

      const gruposOrdenados = Object.entries(dia).map(([musculo, partes]) => ({
        musculo,
        partes: Object.entries(partes).map(([parte, cantidad]) => ({
          parte,
          cantidadRestante: cantidad,
        })),
      }));

      let asignacionPendiente = true;

      while (
        asignacionPendiente &&
        ejerciciosAsignados < maxEjerciciosDia &&
        tiempoTotalEstimado < tiempoDisponibleSegundos
      ) {
        asignacionPendiente = false;

        for (const grupo of gruposOrdenados) {
          for (const parteInfo of grupo.partes) {
            if (
              parteInfo.cantidadRestante > 0 &&
              ejerciciosAsignados < maxEjerciciosDia &&
              tiempoTotalEstimado < tiempoDisponibleSegundos
            ) {
              const musculo = grupo.musculo;
              const parte = parteInfo.parte;

              const descansoMusculo = descansoPorMusculo[musculo] || 60;
              const dificultadQuery =
                nivel === 'principiante'
                  ? "AND dificultad = 'principiante'"
                  : nivel === 'intermedio'
                    ? "AND (dificultad = 'principiante' OR dificultad = 'intermedio')"
                    : '';

              const restriccionesConditions = restricciones.length
                ? restricciones.map(() => 'AND restricciones NOT LIKE ?').join(' ')
                : '';
              const restriccionesValues = restricciones.map((r) => `%${r}%`);

              const query = `
                SELECT id FROM ejercicios
                WHERE musculo = ? AND parte_musculo = ?
                ${dificultadQuery}
                ${restriccionesConditions}
                AND lugar = ?
                LIMIT 600
              `;

              const queryParams = [musculo, parte, ...restriccionesValues, lugarEntrenamiento];
              const [ejercicios] = await connection.query(query, queryParams);

              if (ejercicios.length === 0) continue;

              const ejercicioId = ejercicios[Math.floor(Math.random() * ejercicios.length)].id;
              const [ejercicioAsignadoResult] = await connection.query(
                `INSERT INTO ejercicios_asignados (dia_id, ejercicio_id, descanso) VALUES (?, ?, ?)`,
                [diaId, ejercicioId, descansoMusculo]
              );
              const ejercicioAsignadoId = ejercicioAsignadoResult.insertId;

              for (let k = 0; k < series; k++) {
                await connection.query(
                  `INSERT INTO series (ejercicio_asignado_id, repeticiones, tiempo_aproximado) VALUES (?, ?, ?)`,
                  [ejercicioAsignadoId, repeticiones, tiempoPorSerieSegundos]
                );
              }

              ejerciciosAsignados++;
              tiempoTotalEstimado += series * repeticiones * 5 + series * descansoMusculo;

              parteInfo.cantidadRestante--;
              asignacionPendiente = true;
            }
          }
        }
      }
    }

    await connection.query(`UPDATE usuarios SET rutina_id = ? WHERE id = ?`, [rutinaId, usuarioCreadorId]);
    await connection.commit();
    connection.release();
    return { success: true, rutinaId };
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('❌ Error al insertar rutina:', error);
    return { success: false, message: error.message };
  }
}














function calcularEjerciciosPorParte(tiempoDisponible, enfoqueUsuario, diasEntrenamiento, objetivoCliente) {
  const proporcionesPartes = {
    pierna: ['cuadriceps', 'femoral', 'gemelos'],
    gluteo: ['gluteo mayor', 'gluteo medio', 'gluteo menor'],
    pecho: ['pecho superior', 'pecho medio', 'pecho inferior'],
    espalda: ['espalda alta', 'espalda media', 'espalda baja'],
    hombro: ['hombro anterior', 'hombro lateral', 'hombro posterior'],
    triceps: ['cabeza larga triceps', 'cabeza lateral triceps', 'cabeza medial triceps'],
    biceps: ['cabeza larga biceps', 'cabeza corta biceps'],
    core: ['recto abdominal', 'oblicuos', 'transverso']
  };

  const ejerciciosTotalesPorTiempo = {
    "30 minutos": 4,
    "1 hora": 6,
    "2 horas": 8,
    "3 horas": 10
  };

  const gruposMuscularesPorObjetivo = {
    'subir peso': {
      1: [['pecho', 'espalda', 'pierna', 'gluteo', 'triceps', 'biceps', 'hombro', 'core']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    },
    'bajar peso': {
      1: [['pecho', 'espalda', 'pierna', 'gluteo', 'triceps', 'biceps', 'hombro', 'core']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    },
    'definir': {
      1: [['pecho', 'espalda', 'pierna', 'gluteo', 'triceps', 'biceps', 'hombro', 'core']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    },
    'mantener peso': {
      1: [['pecho', 'espalda', 'pierna', 'gluteo', 'triceps', 'biceps', 'hombro', 'core']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    },
    'mejorar resistencia': {
      1: [['pecho', 'espalda', 'pierna', 'gluteo', 'triceps', 'biceps', 'hombro', 'core']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    }
  };

  const totalEjercicios = ejerciciosTotalesPorTiempo[tiempoDisponible];
  if (!totalEjercicios) {
    throw new Error(`No hay configuración para ${tiempoDisponible} minutos de entrenamiento.`);
  }

  const diasConfigurados = gruposMuscularesPorObjetivo[objetivoCliente][diasEntrenamiento];
  if (!diasConfigurados) {
    throw new Error(`No hay configuración para ${diasEntrenamiento} días de entrenamiento.`);
  }

  const ejerciciosPorDia = [];

  diasConfigurados.forEach((gruposDia) => {
    const ejerciciosAsignados = {};
    let ejerciciosRestantes = totalEjercicios;

    if (enfoqueUsuario && enfoqueUsuario !== "todo") {
      gruposDia.sort((a, b) => (a === enfoqueUsuario ? -1 : b === enfoqueUsuario ? 1 : 0));
    }

    gruposDia.forEach((musculo) => {
      if (!proporcionesPartes[musculo]) {
        throw new Error(`No hay configuraciones para el músculo: ${musculo}`);
      }
      ejerciciosAsignados[musculo] = {};
      proporcionesPartes[musculo].forEach((parte) => {
        ejerciciosAsignados[musculo][parte] = 0;
      });
    });

    const gruposOrdenados = gruposDia.map((musculo) => ({
      musculo,
      partes: [...proporcionesPartes[musculo]]
    }));

    while (ejerciciosRestantes > 0) {
      for (const grupo of gruposOrdenados) {
        for (const parte of grupo.partes) {
          if (ejerciciosRestantes === 0) break;
          ejerciciosAsignados[grupo.musculo][parte] += 1;
          ejerciciosRestantes -= 1;
        }
      }
    }


    ejerciciosPorDia.push(ejerciciosAsignados);
  });

  return ejerciciosPorDia;
}






//A partir de aquí se agregan las funciones de la nueva actualización

//Función para guardar una publicación
async function crearPublicacion({ usuario_id, contenido, imagen_url = null, video_url = null, rutina_id = null }) {
  const [result] = await pool.query(
    `INSERT INTO publicaciones (usuario_id, contenido, imagen_url, video_url, rutina_id)
     VALUES (?, ?, ?, ?, ?)`,
    [usuario_id, contenido, imagen_url, video_url, rutina_id]
  );

  return result.insertId;
}

// Eliminar publicación por ID
export const eliminarPublicacion = async (id) => {
  await pool.query('DELETE FROM publicaciones WHERE id = ?', [id]);
};



// Función para obtener las publicaciones
async function obtenerPublicaciones(usuario_id) {
  const [rows] = await pool.query(
    `
    SELECT 
      p.id,
      p.contenido,
      p.imagen_url,
      p.video_url,
      p.fecha_creacion,
      p.rutina_id,
      u.id AS usuario_id,
      u.nombre,
      u.apellido,
      u.imagen_url AS imagen_usuario,
      r.nombre AS rutina_nombre,
      r.nivel AS rutina_nivel,
      r.objetivo AS rutina_objetivo,
      (
  SELECT GROUP_CONCAT(d.nombre_dia ORDER BY FIELD(d.nombre_dia, 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'))
  FROM dias d
  WHERE d.rutina_id = r.id
) AS rutina_dias,
      (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comentarios WHERE publicacion_id = p.id) AS comentarios,
      EXISTS (
        SELECT 1 FROM likes 
        WHERE publicacion_id = p.id AND usuario_id = ?
      ) AS liked
    FROM publicaciones p
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN rutinas r ON r.id = p.rutina_id
    WHERE 
      p.usuario_id = ? 
      OR p.usuario_id IN (
        SELECT amigo_id FROM amigos WHERE usuario_id = ?
        UNION
        SELECT usuario_id FROM amigos WHERE amigo_id = ?
      )
    ORDER BY p.fecha_creacion DESC
    `,
    [usuario_id, usuario_id, usuario_id, usuario_id]
  );

  return rows.map(pub => ({
    ...pub,
    rutina_dias: pub.rutina_dias ? pub.rutina_dias.split(',') : [],
  }));
}


// Crear notificación
export const crearNotificacion = async (
  usuarioId,
  tipo,
  contenido,
  solicitudId = null,
  emisorId = null,
  rutinaCompId = null,
  publicacionId = null,
  comentarioId = null
) => {
  // 🟢 Insertar notificación sin verificar duplicados
  await pool.query(
    `INSERT INTO notificaciones 
      (usuario_id, tipo, contenido, solicitud_id, emisor_id, rutina_compartida_id, publicacion_id, comentario_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [usuarioId, tipo, contenido, solicitudId, emisorId, rutinaCompId, publicacionId, comentarioId]
  );

  return { success: true, message: 'Notificación creada' };
};


//Función para dar y retirar like
async function toggleLike({ usuario_id, publicacion_id }) {
  const [existing] = await pool.query(
    'SELECT id FROM likes WHERE usuario_id = ? AND publicacion_id = ?',
    [usuario_id, publicacion_id]
  );

  if (existing.length > 0) {
    // Quitar like
    await pool.query('DELETE FROM likes WHERE usuario_id = ? AND publicacion_id = ?', [
      usuario_id,
      publicacion_id,
    ]);
    return { liked: false };
  } else {
    // Dar like
    await pool.query('INSERT INTO likes (usuario_id, publicacion_id) VALUES (?, ?)', [
      usuario_id,
      publicacion_id,
    ]);

    // 🔔 Notificación al autor
    const [[publicacion]] = await pool.query(
      'SELECT usuario_id FROM publicaciones WHERE id = ?',
      [publicacion_id]
    );

    if (publicacion.usuario_id !== usuario_id) {
      const texto = 'le gustó tu publicación';
    
      await crearNotificacion(
        publicacion.usuario_id,   // receptor
        'logro',                  // tipo
        texto,                    // contenido
        null,                     // solicitud_id
        usuario_id,               // emisor
        null,                     // rutina_compartida_id
        publicacion_id            // publicacion_id
      );
    
      // 🔔 Enviar push notification
      const [[emisor]] = await pool.query(
        'SELECT nombre FROM usuarios WHERE id = ?',
        [usuario_id]
      );
    
      await enviarNotificacionPush(
        publicacion.usuario_id,
        '¡Nuevo like ❤️!',
        `${emisor.nombre} le dio like a tu publicación`,
        { tipo: 'like', publicacion_id }
      );
    }
    

    return { liked: true };
  }
}


//Función para crear un comentario o respuesta
async function crearComentario({ usuario_id, publicacion_id, contenido, comentario_padre_id = null }) {
  const textoLimpio = contenido.trim();

  if (!textoLimpio) throw new Error("Comentario vacío no permitido.");

  // Anti-spam
  const [[ultimoComentario]] = await pool.query(
    `SELECT contenido, fecha_creacion 
     FROM comentarios 
     WHERE usuario_id = ? AND publicacion_id = ? 
     ORDER BY fecha_creacion DESC 
     LIMIT 1`,
    [usuario_id, publicacion_id]
  );

  if (ultimoComentario) {
    const ahora = new Date();
    const fechaUltimo = new Date(ultimoComentario.fecha_creacion);
    const segundos = (ahora.getTime() - fechaUltimo.getTime()) / 1000;

    if (ultimoComentario.contenido.trim() === textoLimpio && segundos < 10)
      throw new Error("Estás comentando lo mismo muy seguido.");
    if (segundos < 5)
      throw new Error("Espera unos segundos antes de comentar nuevamente.");
  }

  // ✅ Crear comentario o respuesta
  const [result] = await pool.query(
    `INSERT INTO comentarios (usuario_id, publicacion_id, contenido, comentario_padre_id)
     VALUES (?, ?, ?, ?)`,
    [usuario_id, publicacion_id, textoLimpio, comentario_padre_id]
  );

  const comentarioId = result.insertId;

  // Obtener autor de la publicación
  const [[publicacion]] = await pool.query(
    'SELECT usuario_id FROM publicaciones WHERE id = ?',
    [publicacion_id]
  );

  if (publicacion.usuario_id !== usuario_id) {
    const tipo = comentario_padre_id ? 'respuesta_comentario' : 'comentario';
    const texto = comentario_padre_id
      ? 'ha respondido a tu comentario'
      : 'ha comentado en tu publicación';

    await crearNotificacion(
      publicacion.usuario_id,
      tipo,
      texto,
      null,
      usuario_id,
      null,
      publicacion_id,
      comentarioId // 👈 ID correcto
    );

    // Push
    const [[emisor]] = await pool.query(
      'SELECT nombre FROM usuarios WHERE id = ?',
      [usuario_id]
    );

    await enviarNotificacionPush(
      publicacion.usuario_id,
      tipo === 'comentario' ? '¡Nuevo comentario!' : '¡Nueva respuesta!',
      `${emisor.nombre} ${texto}`,
      {
        tipo,
        publicacion_id,
        comentario_id: comentarioId,
      }
    );
  }

  return comentarioId;
}




// Función en database.js
export async function responderComentario({ comentario_id, usuario_id, contenido, publicacion_id }) {
  const textoLimpio = contenido.trim();

  if (!textoLimpio) {
    throw new Error("Respuesta vacía no permitida.");
  }

  // 🛡️ Anti-spam: verificar última respuesta del mismo usuario a ese comentario
  const [[ultimaRespuesta]] = await pool.query(
    `SELECT contenido, fecha_creacion 
     FROM comentarios 
     WHERE comentario_padre_id = ? AND usuario_id = ? 
     ORDER BY fecha_creacion DESC 
     LIMIT 1`,
    [comentario_id, usuario_id]
  );

  if (ultimaRespuesta) {
    const ahora = new Date();
    const anterior = new Date(ultimaRespuesta.fecha_creacion);
    const segundos = (ahora.getTime() - anterior.getTime()) / 1000;

    if (
      ultimaRespuesta.contenido.trim() === textoLimpio &&
      segundos < 10
    ) {
      throw new Error("Estás respondiendo lo mismo muy seguido.");
    }

    if (segundos < 5) {
      throw new Error("Espera unos segundos antes de responder nuevamente.");
    }
  }

  // ✅ Insertar la nueva respuesta
  const [result] = await pool.query(
    `INSERT INTO comentarios (comentario_padre_id, usuario_id, publicacion_id, contenido)
     VALUES (?, ?, ?, ?)`,
    [comentario_id, usuario_id, publicacion_id, textoLimpio]
  );

  const nuevoComentarioId = result.insertId;

  // 🔔 Obtener autor del comentario original
  const [[autorComentario]] = await pool.query(
    `SELECT usuario_id FROM comentarios WHERE id = ?`,
    [comentario_id]
  );

  if (autorComentario.usuario_id !== usuario_id) {
    // ✅ Notificación interna con ID del NUEVO comentario
    await pool.query(
      `INSERT INTO notificaciones 
       (usuario_id, tipo, contenido, publicacion_id, comentario_id, emisor_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        autorComentario.usuario_id,
        'respuesta_comentario',
        'Ha respondido a tu comentario',
        publicacion_id,
        nuevoComentarioId, // 👈 ID de la respuesta recién creada
        usuario_id,
      ]
    );

    // ✅ Notificación push
    const [[emisor]] = await pool.query(
      'SELECT nombre FROM usuarios WHERE id = ?',
      [usuario_id]
    );

    await enviarNotificacionPush(
      autorComentario.usuario_id,
      '¡Nueva respuesta!',
      `${emisor.nombre} respondió a tu comentario`,
      {
        tipo: 'respuesta_comentario',
        publicacion_id,
        comentario_id: nuevoComentarioId, // 👈 ID correcto
      }
    );
  }

  return { success: true, message: 'Respuesta enviada', comentario_id: nuevoComentarioId };
}




// Función en database.js
export const likeComentario = async ({ usuario_id, comentario_id, publicacion_id }) => {
  // ✅ Verificar si ya existe el like
  const [exist] = await pool.query(
    `SELECT id FROM likes_comentarios WHERE usuario_id = ? AND comentario_id = ?`,
    [usuario_id, comentario_id]
  );

  if (exist.length > 0) {
    await pool.query(
      `DELETE FROM likes_comentarios WHERE usuario_id = ? AND comentario_id = ?`,
      [usuario_id, comentario_id]
    );
    return { liked: false };
  }

  // ✅ Insertar nuevo like
  await pool.query(
    `INSERT INTO likes_comentarios (usuario_id, comentario_id) VALUES (?, ?)`,
    [usuario_id, comentario_id]
  );

  // 🔍 Buscar autor del comentario
  const [[comentario]] = await pool.query(
    `SELECT usuario_id FROM comentarios WHERE id = ?`,
    [comentario_id]
  );

  // 🛡️ Evitar likes a uno mismo
  if (comentario.usuario_id !== usuario_id) {
    // ⚠️ Verificar si ya existe notificación igual
    const [yaExiste] = await pool.query(
      `SELECT id FROM notificaciones 
       WHERE usuario_id = ? AND tipo = 'like_comentario' 
       AND comentario_id = ? AND emisor_id = ?`,
      [comentario.usuario_id, comentario_id, usuario_id]
    );

    if (yaExiste.length === 0) {
      // 📩 Crear notificación interna
      await pool.query(
        `INSERT INTO notificaciones 
         (usuario_id, tipo, contenido, publicacion_id, comentario_id, emisor_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          comentario.usuario_id,
          'like_comentario',
          'Le gustó tu comentario',
          publicacion_id,
          comentario_id,
          usuario_id,
        ]
      );

      // 📲 Notificación push
      const [[emisor]] = await pool.query(
        'SELECT nombre FROM usuarios WHERE id = ?',
        [usuario_id]
      );

      await enviarNotificacionPush(
        comentario.usuario_id,
        '¡Like a tu comentario!',
        `${emisor.nombre} le dio like a tu comentario`,
        { tipo: 'like_comentario', comentario_id, publicacion_id }
      );
    }
  }

  return { liked: true };
};



//Función para obtener un comentario
export const obtenerComentarios = async (publicacionId, usuarioId) => {
  const [rows] = await pool.query(`
    SELECT 
      c.id, c.contenido, c.usuario_id, c.publicacion_id,
      c.comentario_padre_id, c.fecha_creacion,
      u.nombre, u.apellido, u.imagen_url AS imagen_usuario,
      (SELECT COUNT(*) FROM likes_comentarios lc WHERE lc.comentario_id = c.id) AS likes,
      EXISTS(
        SELECT 1 FROM likes_comentarios lc WHERE lc.comentario_id = c.id AND lc.usuario_id = ?
      ) AS liked
    FROM comentarios c
    JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.publicacion_id = ?
    ORDER BY c.fecha_creacion ASC
  `, [usuarioId, publicacionId]);

  const comentarioMap = new Map();

  rows.forEach((row) => {
    comentarioMap.set(row.id, {
      id: row.id,
      contenido: row.contenido,
      usuario_id: row.usuario_id,
      nombre: row.nombre,
      apellido: row.apellido,
      imagen_usuario: row.imagen_usuario,
      fecha_creacion: row.fecha_creacion,
      likes: row.likes,
      liked: !!row.liked,
      comentario_padre_id: row.comentario_padre_id,
      subcomentarios: []
    });
  });

  const comentarios = [];

  comentarioMap.forEach((comentario) => {
    if (comentario.comentario_padre_id) {
      const padre = comentarioMap.get(comentario.comentario_padre_id);
      if (padre) padre.subcomentarios.push(comentario);
    } else {
      comentarios.push(comentario);
    }
  });

  return comentarios;
};






//Función para contar las notificaciones no leida
export const contarNotificacionesNoLeidas = async (usuarioId) => {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM notificaciones WHERE usuario_id = ? AND leido = false',
    [usuarioId]
  );
  return rows[0].total;
};

//Función para actualizar la imagen del usuario
export const actualizarImagenPerfil = async (usuarioId, imagen_url) => {
  await pool.query('UPDATE usuarios SET imagen_url = ? WHERE id = ?', [imagen_url, usuarioId]);
};

// Buscar usuarios
export const buscarUsuarios = async (query, actualUserId) => {
  const [rows] = await pool.query(
    `
    SELECT 
      u.id, u.nombre, u.apellido, u.correo, u.imagen_url,

      EXISTS (
        SELECT 1 FROM amigos a 
        WHERE (a.usuario_id = ? AND a.amigo_id = u.id)
      ) AS es_amigo,

      EXISTS (
        SELECT 1 FROM solicitudes_amistad s 
        WHERE s.usuario_solicitante_id = ? AND s.usuario_receptor_id = u.id AND s.estado = 'pendiente'
      ) AS solicitud_enviada,

      EXISTS (
        SELECT 1 FROM solicitudes_amistad s 
        WHERE s.usuario_solicitante_id = u.id AND s.usuario_receptor_id = ? AND s.estado = 'pendiente'
      ) AS solicitud_recibida

    FROM usuarios u
    WHERE u.id != ? AND (
      u.nombre LIKE ? OR u.apellido LIKE ? OR u.correo LIKE ?
    )
    `,
    [
      actualUserId,
      actualUserId,
      actualUserId,
      actualUserId,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
    ]
  );

  return rows;
};


// Crear solicitud de amistad
export const crearSolicitudAmistad = async (solicitanteId, receptorId) => {
  // ✅ Evitar duplicadas
  const [existente] = await pool.query(
    `SELECT id FROM solicitudes_amistad 
     WHERE usuario_solicitante_id = ? AND usuario_receptor_id = ? AND estado = 'pendiente'`,
    [solicitanteId, receptorId]
  );

  if (existente.length > 0) {
    return { success: false, message: 'Solicitud ya enviada' };
  }

  // ✅ Insertar solicitud
  const [result] = await pool.query(
    'INSERT INTO solicitudes_amistad (usuario_solicitante_id, usuario_receptor_id) VALUES (?, ?)',
    [solicitanteId, receptorId]
  );

  const solicitudId = result.insertId;

  // ✅ Crear notificación
  await crearNotificacion(
    receptorId,
    'solicitud_amistad',
    'te ha enviado una solicitud de amistad.',
    solicitudId,
    solicitanteId
  );

  // ✅ Obtener nombre del solicitante para notificación push
  const [[usuario]] = await pool.query(
    `SELECT nombre FROM usuarios WHERE id = ?`,
    [solicitanteId]
  );

  await enviarNotificacionPush(
    receptorId,
    '👥 Nueva solicitud de amistad',
    `${usuario.nombre} te ha enviado una solicitud`,
    { tipo: 'solicitud_amistad', solicitud_id: solicitudId }
  );

  return { success: true, message: 'Solicitud enviada' };
};


// Obtener solicitudes recibidas
export const obtenerSolicitudesRecibidas = async (usuarioId) => {
  const [rows] = await pool.query(
    'SELECT * FROM solicitudes_amistad WHERE usuario_receptor_id = ? AND estado = "pendiente"',
    [usuarioId]
  );
  return rows;
};

// Responder solicitud de amistad
export const responderSolicitud = async (solicitudId, estado) => {
  // ✅ Actualizar estado de la solicitud
  await pool.query(
    'UPDATE solicitudes_amistad SET estado = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?',
    [estado, solicitudId]
  );

  // ✅ Obtener datos de la solicitud
  const [solicitudResult] = await pool.query('SELECT * FROM solicitudes_amistad WHERE id = ?', [solicitudId]);
  const data = solicitudResult[0];

  if (!data) return;

  const solicitanteId = data.usuario_solicitante_id;
  const receptorId = data.usuario_receptor_id;

  if (estado === 'aceptada') {
    // ✅ Insertar amistad en ambas direcciones
    await pool.query('INSERT IGNORE INTO amigos (usuario_id, amigo_id) VALUES (?, ?), (?, ?)', [
      solicitanteId, receptorId,
      receptorId, solicitanteId,
    ]);

    // ✅ Crear notificación interna
    await crearNotificacion(
      solicitanteId,                        // Quien recibe la notificación
      'solicitud_amistad',                 
      'Tu solicitud de amistad fue aceptada',
      null,                                 // solicitudId (puede ser null si no lo usas)
      receptorId                            // ✅ El que acepta la solicitud
    );    

    // ✅ Obtener nombre del receptor (quien aceptó)
    const [[receptor]] = await pool.query(
      'SELECT nombre FROM usuarios WHERE id = ?',
      [receptorId]
    );

    // ✅ Notificación push
    await enviarNotificacionPush(
      solicitanteId,
      '🎉 ¡Solicitud aceptada!',
      `${receptor.nombre} aceptó tu solicitud de amistad`,
      { tipo: 'solicitud_aceptada' }
    );
  }
};


// Compartir las rutinas (múltiples rutinas)
async function compartirMultiplesRutinas(usuarioId, destinoId, rutinaIds) {
  const mensaje = 'te ha compartido una rutina';

  for (const rutinaId of rutinaIds) {
    // ✅ Insertar rutina compartida
    const [result] = await pool.query(
      'INSERT INTO rutinas_compartidas (rutina_id, usuario_id, usuario_destino_id, mensaje) VALUES (?, ?, ?, ?)',
      [rutinaId, usuarioId, destinoId, mensaje]
    );

    const rutinaCompId = result.insertId;

    // ✅ Crear notificación interna
    await crearNotificacion(destinoId, 'rutina_compartida', mensaje, null, usuarioId, rutinaCompId);

    // ✅ Obtener nombre del emisor
    const [[emisor]] = await pool.query(
      'SELECT nombre FROM usuarios WHERE id = ?',
      [usuarioId]
    );

    // ✅ Notificación push
    await enviarNotificacionPush(
      destinoId,
      '🏋️ Rutina compartida',
      `${emisor.nombre} ${mensaje}`,
      { tipo: 'rutina_compartida', rutina_compartida_id: rutinaCompId }
    );
  }
}


// Obtener rutinas compartidas
// 📦 Función para obtener rutinas compartidas con días asignados
async function obtenerRutinasCompartidas(usuarioId) {
  const connection = await pool.getConnection();
  try {
    const [rutinas] = await connection.execute(`
      SELECT rc.id AS compartida_id,
             r.id AS rutina_id,
             r.nombre,
             r.descripcion,
             r.nivel,
             r.objetivo,
             r.fecha_creacion,
             u.nombre AS creador_nombre,
             u.apellido AS creador_apellido
      FROM rutinas_compartidas rc
      JOIN rutinas r ON rc.rutina_id = r.id
      JOIN usuarios u ON r.usuario_creador_id = u.id
      WHERE rc.usuario_destino_id = ?
      ORDER BY r.fecha_creacion DESC
    `, [usuarioId]);

    if (rutinas.length === 0) {
      return [];
    }

    const rutinaIds = rutinas.map(r => r.rutina_id);
    const placeholders = rutinaIds.map(() => '?').join(',');

    const [dias] = await connection.execute(`
      SELECT DISTINCT d.rutina_id, d.nombre_dia
      FROM dias d
      JOIN ejercicios_asignados ea ON d.id = ea.dia_id
      WHERE d.rutina_id IN (${placeholders})
      ORDER BY d.rutina_id, d.nombre_dia
    `, rutinaIds);

    const rutinasMap = {};
    rutinas.forEach(rutina => {
      rutinasMap[rutina.rutina_id] = {
        id: rutina.rutina_id,
        nombre: rutina.nombre,
        descripcion: rutina.descripcion,
        nivel: rutina.nivel,
        objetivo: rutina.objetivo,
        fecha_creacion: rutina.fecha_creacion,
        creador: `${rutina.creador_nombre} ${rutina.creador_apellido}`,
        dias: []
      };
    });

    dias.forEach(dia => {
      if (rutinasMap[dia.rutina_id]) {
        rutinasMap[dia.rutina_id].dias.push(dia.nombre_dia);
      }
    });

    return Object.values(rutinasMap);
  } catch (error) {
    console.error("❌ Error en obtenerRutinasCompartidasConDias:", error);
    throw error;
  } finally {
    connection.release();
  }
}

//Función para agregar un rutina desde las que se comparten en las publicaciones
async function obtenerRutinaCompartida({ rutina_id, usuario_id, usuario_destino_id }) {
  // 1. Verificar si ya la tiene
  const [existe] = await pool.query(
    `SELECT id FROM rutinas_compartidas 
     WHERE rutina_id = ? AND usuario_destino_id = ?`,
    [rutina_id, usuario_destino_id]
  );

  if (existe.length > 0) {
    return { yaExiste: true };
  }

  // 2. Insertar como aceptada
  await pool.query(
    `INSERT INTO rutinas_compartidas (rutina_id, usuario_id, usuario_destino_id, estado)
     VALUES (?, ?, ?, 'aceptada')`,
    [rutina_id, usuario_id, usuario_destino_id]
  );

  // 3. 🔔 Notificación al creador de la rutina
  const [[creador]] = await pool.query(
    `SELECT u.id AS creador_id, u.nombre AS creador_nombre
     FROM rutinas r JOIN usuarios u ON r.usuario_id = u.id
     WHERE r.id = ?`,
    [rutina_id]
  );

  const [[emisor]] = await pool.query(
    `SELECT nombre FROM usuarios WHERE id = ?`,
    [usuario_destino_id]
  );

  if (creador.creador_id !== usuario_destino_id) {
    const texto = `${emisor.nombre} ha guardado una de tus rutinas`;

    await crearNotificacion(
      creador.creador_id,
      'rutina_guardada',
      texto,
      null,
      usuario_destino_id,
      null,
      rutina_id
    );

    await enviarNotificacionPush(
      creador.creador_id,
      '📥 Rutina guardada',
      texto,
      { tipo: 'rutina_guardada', rutina_id }
    );
  }

  return { yaExiste: false };
}



// Responder rutina compartida
export const responderRutinaCompartida = async (compartidaId, estado) => {
  // 1. Actualizar estado
  await pool.query(
    'UPDATE rutinas_compartidas SET estado = ?, fecha_respuesta = CURRENT_TIMESTAMP WHERE id = ?',
    [estado, compartidaId]
  );

  // 2. Obtener detalles de la rutina compartida
  const [[compartida]] = await pool.query(
    `SELECT rc.rutina_id, rc.usuario_id AS emisor_id, rc.usuario_destino_id AS receptor_id,
            u.nombre AS nombre_receptor
     FROM rutinas_compartidas rc
     JOIN usuarios u ON rc.usuario_destino_id = u.id
     WHERE rc.id = ?`,
    [compartidaId]
  );

  const texto =
    estado === 'aceptada'
      ? `${compartida.nombre_receptor} aceptó tu rutina`
      : `${compartida.nombre_receptor} rechazó tu rutina`;

  // 3. Notificación
  await crearNotificacion(
    compartida.emisor_id,
    'respuesta_rutina',
    texto,
    null,
    compartida.receptor_id,
    compartidaId
  );

  // 4. Push
  await enviarNotificacionPush(
    compartida.emisor_id,
    `📩 Rutina ${estado === 'aceptada' ? 'aceptada' : 'rechazada'}`,
    texto,
    {
      tipo: 'respuesta_rutina',
      compartida_id: compartidaId,
      rutina_id: compartida.rutina_id,
    }
  );
};



// Obtener notificaciones
export const obtenerNotificaciones = async (usuarioId) => {
  const [rows] = await pool.query(
    `SELECT 
  n.id,
  n.tipo,
  n.contenido,
  n.usuario_id,
  n.emisor_id,
  n.publicacion_id AS publicacion_id,
  n.solicitud_id,
  n.rutina_compartida_id,
  n.comentario_id,
  n.leido,
  n.fecha_creacion,

  s.estado AS estado_solicitud,
  rc.estado AS estado_rutina_compartida,
  rc.id AS rutina_compartida_id,

  u.nombre AS remitente_nombre,
  u.apellido AS remitente_apellido,
  u.imagen_url AS remitente_imagen

FROM notificaciones n
LEFT JOIN solicitudes_amistad s 
  ON n.tipo = 'solicitud_amistad' AND n.solicitud_id = s.id

LEFT JOIN rutinas_compartidas rc 
  ON n.tipo = 'rutina_compartida' AND rc.id = n.rutina_compartida_id

LEFT JOIN usuarios u 
  ON n.emisor_id = u.id

WHERE n.usuario_id = ?
ORDER BY n.fecha_creacion DESC
`,
    [usuarioId]
  );

  const notificacionesFiltradas = rows.reduce((acc, notif) => {
    if (notif.tipo === 'rutina_compartida' && notif.estado_rutina_compartida !== 'pendiente') {
      const duplicate = acc.some(existingNotif => existingNotif.rutina_compartida_id === notif.rutina_compartida_id);
      if (!duplicate) acc.push(notif);
    } else {
      acc.push(notif);
    }
    return acc;
  }, []);

  return notificacionesFiltradas;
};


// Marcar notificación como leída
export const marcarNotificacionLeida = async (notificacionId) => {
  await pool.query('UPDATE notificaciones SET leido = true WHERE id = ?', [notificacionId]);
};

// Obtener amigos del usuario
export const obtenerAmigos = async (usuarioId) => {
  const [rows] = await pool.query(
    `
    SELECT u.id, u.nombre, u.apellido, u.correo, u.imagen_url
    FROM amigos a
    JOIN usuarios u ON u.id = a.amigo_id
    WHERE a.usuario_id = ?
    `,
    [usuarioId]
  );
  return rows;
};

// Eliminar amigo (de ambos lados)
export const eliminarAmistad = async (usuarioId, amigoId) => {
  await pool.query(
    `
    DELETE FROM amigos 
    WHERE 
      (usuario_id = ? AND amigo_id = ?) 
      OR 
      (usuario_id = ? AND amigo_id = ?)
    `,
    [usuarioId, amigoId, amigoId, usuarioId]
  );
};

// 📦 Obtener una publicación por su ID con datos del usuario
export const obtenerPublicacionPorId = async (id, usuario_id) => {
  const [rows] = await pool.query(
    `SELECT 
      p.*, 
      u.nombre, 
      u.apellido, 
      u.imagen_url AS imagen_usuario,
      r.nombre AS rutina_nombre,
      r.nivel AS rutina_nivel,
      r.objetivo AS rutina_objetivo,
      (
        SELECT GROUP_CONCAT(d.nombre_dia ORDER BY FIELD(d.nombre_dia, 'lunes','martes','miercoles','jueves','viernes','sabado','domingo'))
        FROM dias d
        WHERE d.rutina_id = r.id
      ) AS rutina_dias,
      (SELECT COUNT(*) FROM likes lp WHERE lp.publicacion_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comentarios c WHERE c.publicacion_id = p.id) AS comentarios,
      EXISTS (
        SELECT 1 FROM likes l 
        WHERE l.publicacion_id = p.id AND l.usuario_id = ?
      ) AS liked
    FROM publicaciones p
    JOIN usuarios u ON p.usuario_id = u.id
    LEFT JOIN rutinas r ON p.rutina_id = r.id
    WHERE p.id = ?`,
    [usuario_id || 0, id]
  );

  // Parsear los días si existen
  if (rows[0]?.rutina_dias) {
    rows[0].rutina_dias = rows[0].rutina_dias.split(',');
  } else {
    rows[0].rutina_dias = [];
  }

  return rows[0] || null;
};

export const guardarPushToken = async (usuario_id, push_token) => {
  await pool.query(
    `UPDATE usuarios SET push_token = ? WHERE id = ?`,
    [push_token, usuario_id]
  );
};

export async function getUsuarioPorId(id) {
  try {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
    return rows[0]; // devuelve el primer resultado (ya que el ID es único)
  } catch (error) {
    console.error('Error al obtener usuario por ID:', error);
    throw error;
  }
}

export const vaciarRutinaDeUsuario = async (usuarioId) => {
  try {
    const [result] = await pool.query(
      'UPDATE usuarios SET rutina_id = NULL WHERE id = ?',
      [usuarioId]
    );
    return result;
  } catch (error) {
    throw error;
  }
};

// database.js
export async function verificarAmistad(usuario1, usuario2) {
  const [rows] = await pool.query(
    `SELECT * FROM amigos 
     WHERE (usuario_id = ? AND amigo_id = ?) 
        OR (usuario_id = ? AND amigo_id = ?)`,
    [usuario1, usuario2, usuario2, usuario1]
  );
  return rows.length > 0;
}

// database.js
export async function existeSolicitudAmistadPendiente(solicitanteId, receptorId) {
  const [rows] = await pool.query(
    `SELECT * FROM solicitudes_amistad 
     WHERE usuario_solicitante_id = ? AND usuario_receptor_id = ? AND estado = 'pendiente'`,
    [solicitanteId, receptorId]
  );
  return rows.length > 0;
}




const databaseFunctions = {
  verificarCorreoTelefono,
  insertUser,
  validateCorreo,
  validateUser,
  obtenerRutinaCompleta,
  obtenerEjercicios,
  obtenerMateriales,
  obtenerInstrucciones,
  calcularEjerciciosPorParte,
  insertarRutinaEnBaseDeDatos,
  insertarEstadistica,
  comprobarEstadistica,
  obtenerEstadisticaSeries,
  registrarEjercicioCompletado,
  verificarEjercicioCompletado,
  verificarTodosEjerciciosCompletados,
  registrarRutinaCompletada,
  comprobarRutinaCompletada,
  obtenerEjerciciosFiltrados,
  insertarPeso,
  insertarAltura,
  actualizarExperiencia,
  obtenerRegistrosPeso,
  obtenerRegistrosAltura,
  actualizarContrasena,
  actualizarDatosUsuario,
  getUserExerciseStats,
  crearRutina,
  obtenerRutinasConDias,
  eliminarRutina,
  actualizarRutinaUsuario,
  reemplazarEjercicio,
  crearSolicitudAmistad,
  obtenerSolicitudesRecibidas,
  responderSolicitud,
  buscarUsuarios,
  obtenerRutinasCompartidas,
  obtenerRutinaCompartida,
  responderRutinaCompartida,
  crearNotificacion,
  obtenerNotificaciones,
  marcarNotificacionLeida,
  crearPublicacion,
  eliminarPublicacion,
  obtenerPublicaciones,
  toggleLike,
  responderComentario,
  likeComentario,
  crearComentario,
  obtenerComentarios,
  contarNotificacionesNoLeidas,
  actualizarImagenPerfil,
  obtenerAmigos,
  eliminarAmistad,
  compartirMultiplesRutinas,
  obtenerPublicacionPorId,
  guardarPushToken,
  getUsuarioPorId,
  vaciarRutinaDeUsuario,
  verificarAmistad,
  existeSolicitudAmistadPendiente
  
};
export default databaseFunctions;