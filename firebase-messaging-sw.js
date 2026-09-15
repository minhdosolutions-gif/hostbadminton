/**
 * ============================================================================
 *  HOST BADMINTON — SERVICE WORKER CHO PUSH NOTIFICATION NỀN
 * ============================================================================
 *  File này PHẢI nằm ở gốc domain (cùng cấp với index.html), KHÔNG được đặt
 *  trong thư mục con — đây là yêu cầu bắt buộc của Firebase Cloud Messaging
 *  để service worker có quyền kiểm soát toàn bộ trang.
 *
 *  Vai trò: khi trình duyệt/app ĐÃ ĐÓNG hoặc đang chạy ngầm (không phải tab
 *  đang mở), Firebase Cloud Messaging sẽ đánh thức file này dậy để hiển thị
 *  thông báo hệ điều hành (Android/desktop). Khi tab ĐANG MỞ, app không cần
 *  tới file này — nó tự bắn thông báo trực tiếp qua Notification API (xem
 *  hàm subscribeNotifications() trong index.html).
 * ============================================================================
 */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Giữ NGUYÊN, khớp đúng với firebaseConfig trong index.html
firebase.initializeApp({
    apiKey: "AIzaSyDG0acv9yshactC3t95BIBi6nEz-Ve840U",
      authDomain: "host-badminton-6f333.firebaseapp.com",
      projectId: "host-badminton-6f333",
      storageBucket: "host-badminton-6f333.firebasestorage.app",
      messagingSenderId: "204019622026",
      appId: "1:204019622026:web:8f1bc6aac44db646ab8d73",
      measurementId: "G-0GR67SBKTY"
});

const messaging = firebase.messaging();

// Xử lý push đến khi app KHÔNG ở foreground (đã đóng tab / chuyển app khác)
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Host Badminton';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: (payload.data && payload.data.notifId) || undefined, // tránh hiện trùng nếu gửi lại cùng 1 tin
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// Bấm vào thông báo hệ điều hành → mở/focus lại app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
