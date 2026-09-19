/**
 * ============================================================================
 *  HOST BADMINTON — BACKEND PAYOS (Firebase Cloud Functions, 2nd Gen)
 * ============================================================================
 *  Vì sao cần file này?
 *  Client ID / API Key / Checksum Key của PayOS là THÔNG TIN BÍ MẬT.
 *  Nếu đặt trực tiếp trong file HTML/JS chạy ở trình duyệt, bất kỳ ai bấm
 *  "View Page Source" cũng đọc được và có thể chiếm đoạt tài khoản PayOS
 *  của bạn (tạo đơn hàng giả, rút tiền...). Vì vậy 3 khóa này PHẢI nằm trên
 *  server (ở đây là Cloud Functions), tuyệt đối không gửi xuống frontend.
 *
 *  File này mở ra 2 API mà file ghep-keo-cau-long.html đã gọi sẵn:
 *    POST /create-payment-link   { orderCode, amount, description }
 *                                 → { checkoutUrl, qrCode, orderCode }
 *    GET  /check-payment-status?orderCode=...
 *                                 → { status: 'PAID' | 'PENDING' | 'CANCELLED' | 'EXPIRED' }
 *
 *  Cách deploy: xem file README.md đi kèm trong thư mục payos-backend/.
 * ============================================================================
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const PayOS = require("@payos/node");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

// ----------------------------------------------------------------------------
// 3 khóa bí mật của PayOS — KHÔNG gán giá trị trực tiếp ở đây.
// Chúng được nạp an toàn từ Firebase Secret Manager lúc chạy (xem README
// để biết lệnh `firebase functions:secrets:set` thiết lập giá trị thật).
// ----------------------------------------------------------------------------
const PAYOS_CLIENT_ID = 2ffe147c-3fed-4e6f-85b6-89f260c077e4;
const PAYOS_API_KEY = 88497a75-9329-4f36-91aa-a8ec5578b213;
const PAYOS_CHECKSUM_KEY = 25e4afe3df5fd3f5e85bd8b5358bc3faab0156a8359a5a037a8f6a40a4f47a27;

// URL PayOS sẽ điều hướng người dùng tới sau khi họ thanh toán/hủy trên trang
// checkout của PayOS. Với luồng quét QR trong app di động thì 2 URL này ít
// khi được người dùng nhìn thấy, nhưng PayOS vẫn bắt buộc phải khai báo.
// → Sửa lại thành domain thật bạn deploy file HTML lên (Firebase Hosting).
const RETURN_URL = "https://host-badminton-6f333.web.app/?payment=success";
const CANCEL_URL = "https://host-badminton-6f333.web.app/?payment=cancel";

const app = express();
app.use(cors({ origin: true })); // Cho phép gọi từ mọi domain đang host file HTML của bạn
app.use(express.json());

/** Khởi tạo client PayOS với 3 khóa bí mật đã nạp từ Secret Manager */
function getPayOS() {
  return new PayOS(
    PAYOS_CLIENT_ID,
    PAYOS_API_KEY,
    PAYOS_CHECKSUM_KEY
  );
}

/**
 * PayOS yêu cầu `orderCode` là SỐ NGUYÊN dương, nhưng frontend đang sinh mã
 * dạng chuỗi "HB<timestamp>" cho dễ đọc. Hàm này rút gọn về 1 số nguyên
 * (tối đa 9-10 chữ số cuối) để tương thích, đồng thời vẫn gần như không
 * trùng lặp vì dựa trên timestamp mili-giây.
 */
function toNumericOrderCode(rawOrderCode) {
  const digitsOnly = String(rawOrderCode).replace(/[^0-9]/g, "");
  const trimmed = digitsOnly.slice(-9) || String(Date.now()).slice(-9);
  return Number(trimmed);
}

/**
 * POST /create-payment-link
 * Tạo 1 đơn thanh toán VietQR bên phía PayOS cho gói Nạp Cầu người dùng chọn.
 */
app.post("/create-payment-link", async (req, res) => {
  try {
    const { orderCode, amount, description } = req.body || {};

    if (!orderCode || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Thiếu hoặc sai orderCode/amount" });
    }

    const numericOrderCode = toNumericOrderCode(orderCode);

    // PayOS giới hạn nội dung chuyển khoản (description) tối đa 25 ký tự
    const safeDescription = String(description || "Nap Cau Host Badminton").slice(0, 25);

    const payos = getPayOS();
    const paymentLink = await payos.createPaymentLink({
      orderCode: numericOrderCode,
      amount: Math.round(Number(amount)),
      description: safeDescription,
      returnUrl: RETURN_URL,
      cancelUrl: CANCEL_URL,
    });

    // paymentLink.qrCode là 1 chuỗi dữ liệu VietQR thô (không phải link ảnh).
    // Ta cần dựng ảnh QR từ chuỗi đó để trả về cho app hiển thị trực tiếp.
    const QRCode = require("qrcode");
    const qrImageDataUrl = await QRCode.toDataURL(paymentLink.qrCode, {
      margin: 1,
      width: 320,
    });

    return res.json({
      orderCode: numericOrderCode, // Trả về mã SỐ để frontend dùng khi tra cứu trạng thái
      checkoutUrl: paymentLink.checkoutUrl,
      qrCode: qrImageDataUrl, // data:image/png;base64,... — gán thẳng vào thẻ <img src="...">
    });
  } catch (err) {
    logger.error("Lỗi tạo link thanh toán PayOS:", err);
    return res.status(500).json({ error: "Không thể tạo link thanh toán PayOS", detail: err.message });
  }
});

/**
 * GET /check-payment-status?orderCode=123456789
 * Tra cứu trạng thái đơn hàng trực tiếp từ PayOS (dùng cho cơ chế polling ở frontend).
 */
app.get("/check-payment-status", async (req, res) => {
  try {
    const orderCode = Number(req.query.orderCode);
    if (!orderCode) {
      return res.status(400).json({ error: "Thiếu orderCode" });
    }

    const payos = getPayOS();
    const info = await payos.getPaymentLinkInformation(orderCode);

    // info.status của PayOS: "PAID" | "PENDING" | "CANCELLED" | "EXPIRED" | "PROCESSING"
    return res.json({ status: info.status, amountPaid: info.amountPaid || 0 });
  } catch (err) {
    logger.error("Lỗi kiểm tra trạng thái PayOS:", err);
    return res.status(500).json({ error: "Không thể kiểm tra trạng thái đơn hàng", detail: err.message });
  }
});

/**
 * (Tuỳ chọn — khuyến nghị dùng thêm) POST /payos-webhook
 * PayOS có thể chủ động gọi vào URL này ngay khi có biến động thanh toán,
 * nhanh và đáng tin cậy hơn polling. Cấu hình URL webhook này trong
 * PayOS Merchant Portal → Kênh thanh toán → Webhook.
 * (Endpoint này chỉ xác thực chữ ký; việc cộng Cầu cho đúng người dùng cần
 * bạn tự lưu thêm map orderCode ↔ uid, ví dụ trong Firestore, khi tạo đơn.)
 */
app.post("/payos-webhook", async (req, res) => {
  try {
    const payos = getPayOS();
    const verified = payos.verifyPaymentWebhookData(req.body);
    logger.info("Webhook PayOS đã xác thực:", verified);
    // TODO: nếu verified.code === '00' (thành công) → tra map orderCode → uid
    // đã lưu lúc tạo đơn, rồi cộng Cầu cho đúng user trong Firestore tại đây.
    return res.json({ success: true });
  } catch (err) {
    logger.error("Webhook PayOS không hợp lệ:", err);
    return res.status(400).json({ success: false });
  }
});

// Export duy nhất 1 Cloud Function tên "api" phục vụ toàn bộ các route ở trên.
// Sau khi deploy, URL gốc sẽ có dạng:
//   https://api-<random>-uc.a.run.app
// (Terminal sẽ in chính xác URL này ngay sau khi `firebase deploy` chạy xong.)
exports.api = onRequest(
  { secrets: [PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY], region: "asia-southeast1" },
  app
);

/**
 * ============================================================================
 *  PUSH NOTIFICATION THẬT — tự chạy mỗi khi có 1 document mới được tạo trong
 *  users/{uid}/notifications/{notifId} (Firestore trigger, không cần app gọi
 *  API nào cả — hoàn toàn tự động).
 *
 *  Đọc fcmToken đã lưu trong users/{uid} (được ghi từ hàm registerPushToken()
 *  phía client sau khi người dùng bấm "Bật thông báo trên thiết bị này"), rồi
 *  gửi push thật qua Firebase Cloud Messaging — hoạt động kể cả khi người
 *  dùng đã đóng app/tắt trình duyệt, miễn điện thoại vẫn có mạng.
 * ============================================================================
 */
exports.sendPushOnNotification = onDocumentCreated(
  { document: "users/{uid}/notifications/{notifId}", region: "asia-southeast1" },
  async (event) => {
    const uid = event.params.uid;
    const notifId = event.params.notifId;
    const data = event.data ? event.data.data() : null;
    if (!data) return;

    try {
      const userSnap = await admin.firestore().collection("users").doc(uid).get();
      const token = userSnap.exists ? userSnap.data().fcmToken : null;
      if (!token) {
        // Người dùng chưa bấm "Bật thông báo trên thiết bị này" — không có gì để gửi, bỏ qua êm.
        return;
      }

      await admin.messaging().send({
        token,
        notification: {
          title: data.title || "Host Badminton",
          body: data.message || "",
        },
        data: {
          notifId: String(notifId),
          type: String(data.type || ""),
          matchId: String(data.matchId || ""),
          teamId: String(data.teamId || ""),
        },
        webpush: {
          fcmOptions: {
            link: "/", // Bấm vào thông báo sẽ mở lại trang gốc của app
          },
        },
      });
      logger.info("Đã gửi push cho user " + uid + " (notif " + notifId + ")");
    } catch (err) {
      // Token hết hạn/không hợp lệ là chuyện bình thường (user gỡ app, đổi máy...) — chỉ log, không throw
      logger.error("Lỗi gửi push cho user " + uid + ":", err);
    }
  }
);
