# Backend PayOS + Firestore cho Host Badminton

Backend nhỏ chạy trên **Firebase Cloud Functions**, giữ 3 khóa bí mật của PayOS
(Client ID / API Key / Checksum Key) an toàn phía server — không bao giờ để
lộ trong file HTML chạy ở trình duyệt.

Ngoài ra thư mục này còn chứa **Firestore Security Rules** (`firestore.rules`)
và **Indexes** (`firestore.indexes.json`) cho tính năng Đội/Thành viên/Sân/
Lịch/Chat đội — bắt buộc phải deploy để tính năng Đội hoạt động đúng và an toàn.

## 0. Điều kiện bắt buộc

- Project Firebase `host-badminton-6f333` phải ở gói **Blaze (Pay as you go)**.
  Cloud Functions 2nd Gen cần Blaze để được phép gọi ra internet (gọi API PayOS).
  Vào [Firebase Console](https://console.firebase.google.com/project/host-badminton-6f333/usage/details)
  → góc trái dưới → **Nâng cấp lên Blaze** (vẫn có hạn mức miễn phí hàng tháng,
  ứng dụng nhỏ gần như không mất phí).
- **Bật Firestore Database**: vào Firebase Console → mục **Firestore Database**
  → **Create database** → chọn **Production mode** → chọn khu vực gần Việt Nam
  nhất (khuyến nghị `asia-southeast1`). Nếu chưa bật bước này, mọi thao tác
  liên quan tới Đội (tạo đội, chat, lịch...) sẽ báo lỗi trong console.
- Có tài khoản PayOS đã tạo **Kênh thanh toán** (Payment Channel), lấy được
  3 giá trị: `Client ID`, `API Key`, `Checksum Key` tại
  [PayOS Merchant Portal](https://my.payos.vn/) → mục *Kênh thanh toán*.

## 1. Cài công cụ (nếu máy chưa có)

```bash
npm install -g firebase-tools
firebase login
```

Đăng nhập đúng tài khoản Google đã tạo project `host-badminton-6f333`.

## 2. Deploy Firestore Rules + Indexes (làm TRƯỚC, quan trọng nhất)

Từ thư mục `payos-backend/`, chạy:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Lệnh này áp `firestore.rules` (phân quyền OWNER/ADMIN/MEMBER cho Đội, chặn
truy cập trái phép) và tạo sẵn composite index cho truy vấn "Đội của tôi".
**Không được bỏ qua bước này** — nếu chưa deploy rules, Firestore mặc định ở
chế độ Production sẽ **chặn toàn bộ đọc/ghi** (an toàn nhưng app sẽ không
hoạt động được).

## 3. Cài dependencies cho Cloud Functions

```bash
cd functions
npm install
```

## 4. Thiết lập 3 khóa bí mật PayOS (KHÔNG gõ trực tiếp vào code)

Chạy lần lượt 3 lệnh sau, mỗi lệnh sẽ hỏi bạn dán giá trị tương ứng:

```bash
cd ..
firebase functions:secrets:set PAYOS_CLIENT_ID
firebase functions:secrets:set PAYOS_API_KEY
firebase functions:secrets:set PAYOS_CHECKSUM_KEY
```

Các giá trị này được Google mã hóa lưu trong Secret Manager, chỉ Cloud
Function của bạn đọc được lúc chạy — an toàn tuyệt đối, không nằm trong code.

## 5. Deploy Functions

```bash
firebase deploy --only functions
```

Sau khi chạy xong, terminal sẽ in ra 1 dòng dạng:

```
✔  functions[api(asia-southeast1)]: ... https://api-xxxxxxxxxx-as.a.run.app
```

**Copy chính xác URL đó** (không có `/create-payment-link` ở cuối).

## 6. Gắn URL vào file HTML

Mở file `ghep-keo-cau-long.html`, tìm đoạn:

```js
payosConfig: {
  backendUrl: 'https://YOUR-CLOUD-FUNCTION-URL.a.run.app',
  ...
```

Thay bằng URL bạn vừa copy ở bước 5.

Lưu file, deploy lại app HTML (Firebase Hosting/Netlify/Vercel...). Từ giờ
màn hình Nạp Cầu sẽ tự động chuyển từ **DEMO MODE** sang **PayOS thật**: sinh
mã QR thật, và mỗi 5 giây tự kiểm tra xem người dùng đã chuyển khoản xong
chưa để cộng Cầu tự động.

## 7. (Khuyến nghị) Cấu hình Webhook PayOS

Cơ chế polling ở bước 6 đã chạy được, nhưng để chính xác & tức thời hơn,
bạn có thể khai báo thêm Webhook trong PayOS Merchant Portal, trỏ về:

```
https://api-xxxxxxxxxx-as.a.run.app/payos-webhook
```

File `functions/index.js` đã có sẵn route `/payos-webhook` xác thực chữ ký —
bạn chỉ cần bổ sung phần lưu map `orderCode ↔ uid người dùng` (ví dụ bằng
Firestore) lúc tạo đơn để webhook biết cộng Cầu cho đúng ai (xem chú thích
`TODO` ngay trong file).

## 8. Kiểm tra cross-user tính năng Đội (bắt buộc theo mục 31)

Sau khi deploy rules xong, tự test bằng 2 tài khoản Google khác nhau (2 trình
duyệt hoặc 1 cửa sổ ẩn danh):

1. **Tài khoản A**: đăng nhập → tab "Đội" → Tạo đội → thêm 1 Sân → tạo 1 Lịch
   chơi → gửi 1 tin nhắn trong Chat đội.
2. **Tài khoản B**: đăng nhập máy/trình duyệt khác → tab "Đội" → mục "Khám phá
   đội" → thấy đội của A → bấm "Tham gia đội".
3. **Tài khoản A**: vào lại đội → tab "Thành viên" → thấy yêu cầu của B → bấm
   duyệt (✓).
4. **Tài khoản B**: mở lại đội → đã thấy mình trong danh sách Thành viên, thấy
   Lịch, thấy Sân, vào Chat đội gõ tin nhắn.
5. **Tài khoản A**: đang mở Chat đội → thấy tin của B hiện ra **ngay lập tức**
   không cần F5 (nhờ Firestore `onSnapshot` realtime).
6. **Tài khoản C** (chưa tham gia đội): mở đội đó bằng "Xem đội" → vào tab
   Chat → phải thấy dòng "Bạn cần tham gia đội để xem và gửi tin nhắn", **không**
   được đọc được nội dung chat.

Nếu bước 6 mà tài khoản C vẫn đọc được tin nhắn → Firestore Rules chưa được
deploy đúng, chạy lại lệnh ở bước 2.

## Kiểm tra nhanh backend PayOS bằng curl (tuỳ chọn)

```bash
curl -X POST https://api-xxxxxxxxxx-as.a.run.app/create-payment-link \
  -H "Content-Type: application/json" \
  -d '{"orderCode":"HB123456","amount":20000,"description":"NAPCAU test"}'
```

Nếu trả về JSON có `checkoutUrl` và `qrCode` (chuỗi base64 ảnh) — backend đã
hoạt động đúng.

