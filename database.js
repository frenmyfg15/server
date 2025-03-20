import mysql from 'mysql2';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';


dotenv.config();
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT||3306, // 🔥 Agregar el puerto
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
        experiencia: user.experiencia
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
      console.log(`❌ No se encontraron ejercicios para ${dia}.`);
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
      console.log('No se encontraron materiales para el ejercicio');
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
    if (rows.length === 0) {;
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
export async function obtenerEjerciciosFiltrados(parte_musculo, tipo = null, dificultad = null) {
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
          WHERE e.parte_musculo = ?`;

    const params = [parte_musculo];

    // Agregar filtro por `tipo` si se proporciona
    if (tipo) {
      query += " AND e.tipo = ?";
      params.push(tipo);
    }

    // Agregar filtro por `dificultad` si se proporciona
    if (dificultad) {
      query += " AND e.dificultad = ?";
      params.push(dificultad);
    }

    // Ejecutar la consulta
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
    // Obtener todas las rutinas del usuario
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

    // Obtener los nombres de los días que tienen ejercicios asignados
    const [dias] = await connection.execute(`
      SELECT DISTINCT d.rutina_id, d.nombre_dia
      FROM dias d
      JOIN ejercicios_asignados ea ON d.id = ea.dia_id
      WHERE d.rutina_id IN (${rutinaIds.join(',')})
      ORDER BY d.rutina_id, d.nombre_dia
    `);

    // Formatear los resultados
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

  } finally {
    connection.release();
  }
}

//Función para eliminar rutinas
export async function eliminarRutina(rutinaId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 🔹 1. Eliminar series relacionadas con ejercicios asignados
    await connection.execute(`
      DELETE FROM series 
      WHERE ejercicio_asignado_id IN (
        SELECT id FROM ejercicios_asignados WHERE dia_id IN (
          SELECT id FROM dias WHERE rutina_id = ?
        )
      )
    `, [rutinaId]);

    // 🔹 2. Eliminar ejercicios asignados a los días de la rutina
    await connection.execute(`
      DELETE FROM ejercicios_asignados 
      WHERE dia_id IN (
        SELECT id FROM dias WHERE rutina_id = ?
      )
    `, [rutinaId]);

    // 🔹 3. Eliminar los días de la rutina
    await connection.execute(`
      DELETE FROM dias 
      WHERE rutina_id = ?
    `, [rutinaId]);

    // 🔹 4. Eliminar la rutina
    const [result] = await connection.execute(`
      DELETE FROM rutinas 
      WHERE id = ?
    `, [rutinaId]);

    if (result.affectedRows === 0) {
      throw new Error("La rutina no existe");
    }

    await connection.commit();
    return { success: true, message: "Rutina eliminada exitosamente" };

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
        avanzado: { series: 4, repeticiones: 12 } 
      },
      'bajar peso': { 
        principiante: { series: 3, repeticiones: 12 }, 
        intermedio: { series: 4, repeticiones: 12 }, 
        avanzado: { series: 4, repeticiones: 15 } 
      },
      'definir': { 
        principiante: { series: 3, repeticiones: 12 }, 
        intermedio: { series: 3, repeticiones: 15 }, 
        avanzado: { series: 4, repeticiones: 15 } 
      },
      'mantener peso': { 
        principiante: { series: 3, repeticiones: 10 }, 
        intermedio: { series: 3, repeticiones: 12 }, 
        avanzado: { series: 4, repeticiones: 12 } 
      },
      'mejorar resistencia': { 
        principiante: { series: 2, repeticiones: 15 }, 
        intermedio: { series: 3, repeticiones: 15 }, 
        avanzado: { series: 4, repeticiones: 15 } 
      }
    };
    
    const maxEjerciciosPorNivel = { principiante: 4, intermedio: 6, avanzado: 8 };
    const descansoPorMusculo = { pierna: 120, pecho: 90, espalda: 90, gluteo: 120, biceps: 60, triceps: 60, hombro: 60, core: 30 };
    const tiempoPorSerieSegundos = 30;
    const tiempoDisponibleSegundos = { '30 minutos': 1800, '1 hora': 3600, '2 horas': 7200, '3 horas': 10800 }[tiempoDisponible];

    const diasSemana = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const diasEntrenamientoOrdenados = diasSemana.filter(dia => diasEntrenamiento.map(d => d.toLowerCase()).includes(dia));

    await connection.query(
      `INSERT INTO rutinas (usuario_creador_id, nombre, objetivo, nivel) VALUES (?, ?, ?, ?)`,
      [usuarioCreadorId, nombreRutina, objetivo, nivel]
    );

    const rutinaId = (await connection.query(`SELECT LAST_INSERT_ID() AS id`))[0][0].id;

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
          cantidadRestante: cantidad
        }))
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
              const dificultadQuery = nivel === 'principiante'
                ? "AND dificultad = 'principiante'"
                : nivel === 'intermedio'
                ? "AND (dificultad = 'principiante' OR dificultad = 'intermedio')"
                : '';

              const restriccionesFilter = restricciones.length
                ? restricciones.map(() => 'restricciones NOT LIKE ?').join(' AND ')
                : '';
              const restriccionesValues = restricciones.map(r => `%${r}%`);

              const [ejercicios] = await connection.query(
                `SELECT id FROM ejercicios 
                 WHERE musculo = ? AND parte_musculo = ? 
                 ${dificultadQuery} 
                 ${restriccionesFilter ? `AND ${restriccionesFilter}` : ''}
                 AND lugar = ?
                 LIMIT 600`,
                [musculo, parte, ...restriccionesValues, lugarEntrenamiento]
              );

              if (ejercicios.length === 0) continue;

              const ejercicioId = ejercicios[Math.floor(Math.random() * ejercicios.length)].id;
              await connection.query(
                `INSERT INTO ejercicios_asignados (dia_id, ejercicio_id, descanso) VALUES (?, ?, ?)`,
                [diaId, ejercicioId, descansoMusculo]
              );
              const ejercicioAsignadoId = (await connection.query(`SELECT LAST_INSERT_ID() AS id`))[0][0].id;

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
      1: [['pecho', 'espalda', 'pierna']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo']],
      4: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna'], ['hombro']],
      5: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core']],
      6: [['pecho', 'triceps'], ['espalda', 'biceps'], ['pierna', 'gluteo'], ['hombro'], ['core'], ['pierna']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['hombro']]
    },
    'bajar peso': {
      1: [['pecho', 'espalda', 'pierna']],
      2: [['pierna', 'core'], ['pecho', 'espalda']],
      3: [['pierna', 'gluteo', 'core'], ['espalda', 'biceps'], ['pecho', 'triceps']],
      4: [['pierna', 'gluteo'], ['espalda', 'core'], ['pecho', 'triceps'], ['fullbody']],
      5: [['pierna'], ['espalda'], ['pecho'], ['core'], ['cardio']],
      6: [['pierna', 'gluteo'], ['espalda'], ['pecho'], ['core'], ['fullbody'], ['cardio']],
      7: [['fullbody'], ['fullbody'], ['pierna'], ['espalda'], ['pecho'], ['core'], ['cardio']]
    },
    'definir': {
      1: [['pecho', 'espalda', 'pierna']],
      2: [['fullbody'], ['fullbody']],
      3: [['fullbody'], ['fullbody'], ['fullbody']],
      4: [['pierna'], ['pecho', 'triceps'], ['espalda', 'biceps'], ['core']],
      5: [['pierna'], ['pecho'], ['espalda'], ['hombro'], ['core']],
      6: [['pierna'], ['pecho'], ['espalda'], ['hombro'], ['core'], ['fullbody']],
      7: [['fullbody'], ['pierna'], ['pecho'], ['espalda'], ['hombro'], ['core'], ['fullbody']]
    },
    'mantener peso': {
      1: [['pecho', 'espalda', 'pierna']],
      2: [['pecho', 'espalda'], ['pierna', 'gluteo']],
      3: [['pecho', 'espalda'], ['pierna', 'gluteo'], ['core', 'hombro']],
      4: [['pecho'], ['espalda'], ['pierna'], ['core']],
      5: [['pecho'], ['espalda'], ['pierna'], ['hombro'], ['core']],
      6: [['pecho'], ['espalda'], ['pierna'], ['hombro'], ['core'], ['fullbody']],
      7: [['pecho'], ['espalda'], ['pierna'], ['gluteo'], ['triceps'], ['biceps'], ['core']]
    },
    'mejorar resistencia': {
      1: [['pecho', 'espalda', 'pierna']],
      2: [['fullbody'], ['fullbody']],
      3: [['fullbody'], ['fullbody'], ['fullbody']],
      4: [['fullbody'], ['fullbody'], ['fullbody'], ['core']],
      5: [['fullbody'], ['fullbody'], ['fullbody'], ['core'], ['cardio']],
      6: [['fullbody'], ['fullbody'], ['fullbody'], ['fullbody'], ['core'], ['cardio']],
      7: [['fullbody'], ['fullbody'], ['fullbody'], ['fullbody'], ['core'], ['cardio'], ['cardio']]
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
  reemplazarEjercicio
};
export default databaseFunctions;