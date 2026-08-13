// ============================================
// CONFIGURACIÓN - Dashboard PNA (Firebase)
// ============================================
//
// INSTRUCCIONES:
// 1. Reemplazá los valores de FIREBASE_CONFIG con los que te dio Firebase Console
// 2. No subas este archivo a un repositorio público si no querés exponer tu projectId
//    (aunque la apiKey de Firebase es pública por diseño, el projectId puede ser privado)
// ============================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbS9ZFTwFvbEnaSFezAgqQp7N7VbxIqpk",
  authDomain: "dashboard-pna-combustible.firebaseapp.com",
  projectId: "dashboard-pna-combustible",
  storageBucket: "dashboard-pna-combustible.firebasestorage.app",
  messagingSenderId: "33678411459",
  appId: "1:33678411459:web:120d866e1972427ce68476"
};

// Usuario de emergencia (si falla Firebase)
const USUARIO_EMERGENCIA = {
  dni: '00000000',
  nombre: 'Administrador',
  username: 'admin',
  password: 'admin123',
  rol: 'admin'
};
