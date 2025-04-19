// utils/push.js ✅ Usando ES Modules correctamente
import { Expo } from 'expo-server-sdk';
import { pool } from './database.js'; // ✅ Correcto si usas export { pool };

const expo = new Expo();

export async function enviarNotificacionPush(usuario_id, titulo, cuerpo, datosExtras = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT push_token FROM usuarios WHERE id = ? AND push_token IS NOT NULL`,
      [usuario_id]
    );

    if (!rows.length) return;

    const token = rows[0].push_token;

    if (!Expo.isExpoPushToken(token)) {
      console.error(`Token inválido para Expo: ${token}`);
      return;
    }

    const mensaje = {
      to: token,
      sound: 'default',
      title: titulo,
      body: cuerpo,
      data: datosExtras,
    };

    const tickets = await expo.sendPushNotificationsAsync([mensaje]);
    console.log("📬 Notificación enviada:", tickets);
  } catch (error) {
    console.error("❌ Error enviando push:", error);
  }
}
