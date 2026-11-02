> **Không dùng nữa.** Đây là schema ghép cặp bằng mã mời trước đây, giữ lại để tham khảo.
> Schema hiện tại: `supabase/migrations/20261102000000_init_journal.sql`.

# Hướng dẫn cài Supabase từ đầu

## Trước khi bắt đầu

- GitHub là nơi lưu mã nguồn; Supabase là nơi lưu tài khoản và nhật ký.
- Có thể để mã nguồn public trên GitHub. Không commit mật khẩu, dữ liệu nhật ký,
  mã mời, database password hoặc `service_role` key.
- Trang web hiện tại vẫn dùng `localStorage` trong một trình duyệt. Schema bên
  dưới chỉ chuẩn bị database; cần bổ sung đăng nhập và kết nối Supabase vào
  frontend để mỗi người truy cập nhật ký riêng từ thiết bị của mình.

## 1. Tạo project Supabase

1. Mở [supabase.com](https://supabase.com/), đăng ký/đăng nhập.
2. Tạo Organization nếu được yêu cầu, rồi chọn **New project**.
3. Đặt tên project, tạo database password mạnh và lưu password ở password
   manager riêng (không gửi lên GitHub).
4. Chọn region gần Việt Nam, ví dụ Singapore, rồi tạo project. Chờ project
   khởi tạo xong.

## 2. Tạo các bảng và quy tắc bảo mật

1. Trong project, mở **SQL Editor** → **New query**.
2. Nếu đây là project database mới, mở file [`schema.sql`](./schema.sql),
   sao chép toàn bộ nội dung và dán vào SQL Editor. Nếu đã chạy schema cũ, hãy
   sao lưu database rồi chạy migration
   [`weekly_partner_unlock`](./migrations/20261027001000_weekly_partner_unlock.sql).
   Không chạy lại schema khởi tạo trên database đã có bảng.
3. Bấm **Run**. Chỉ tiếp tục nếu Supabase báo chạy thành công. Nếu có lỗi,
   lưu nguyên văn lỗi để xử lý; đừng chạy các đoạn sửa ngẫu nhiên.
4. Có thể kiểm tra trong **Table Editor** xem đã có `journal_entries`,
   `journal_members` và các bảng `journal_*` khác.

Schema bật Row Level Security (RLS): mỗi người đọc bài của mình ngay; bài của
người kia chỉ được đọc khi đến giờ mở khóa. Thời gian lưu là UTC; tuần được
tính theo ISO-8601 và giờ mở theo Asia/Ho_Chi_Minh (GMT+7). Database cho phép
một bài mỗi người mỗi tuần.

Chỉ cho phép tạo/sửa nhật ký trong tuần hiện tại theo GMT+7. Đến 00:00 thứ Hai
đầu tuần kế tiếp, cả hai bài của tuần vừa kết thúc tự mở cho nhau; bài chuyển
thành chỉ đọc cho cả hai. Quyền đọc được database áp dụng, không dựa vào đồng
hồ phía giao diện.

Nếu database cũ có nhiều bài nhật ký cùng tuần cho một người, hãy sao lưu và
gộp các bài đó thành một bài mỗi tuần trước khi chạy migration. Migration sẽ
dừng lại thay vì tự xóa/gộp dữ liệu. File này chưa được kiểm thử trên project
Supabase thực tế.

## 3. Tạo hai tài khoản

1. Mở **Authentication** → **Users** trong Supabase.
2. Tạo một tài khoản cho Hòa và một tài khoản cho June, mỗi người dùng email
   của mình và mật khẩu riêng. Nếu chọn đăng ký qua email thay vì tạo thủ công,
   hãy xác nhận email theo hướng dẫn Supabase.
3. Không dùng chung mật khẩu Supabase Dashboard hoặc tài khoản quản trị.

## 4. Ghép hai tài khoản thành một cặp

Một người tạo cặp trước, rồi chia sẻ mã mời riêng cho người còn lại. Mã mời là
bí mật dùng một lần; không đăng mã đó trong repo public.

**Lưu ý:** frontend hiện tại chưa có màn hình đăng nhập/ghép cặp. Hai hàm RPC
trong schema (`create_journal_couple` và `join_journal_couple`) cần được gọi từ
ứng dụng sau khi user đăng nhập. Không chạy chúng trong SQL Editor thông thường:
SQL Editor không đăng nhập bằng tài khoản Hòa/June nên `auth.uid()` sẽ rỗng.
Việc hoàn tất bước này cần kết nối frontend.

## 5. Kết nối ứng dụng (bước phát triển tiếp theo)

Sau khi có project:

1. Mở **Project Settings** → **API** (hoặc **API Keys**).
2. Lấy **Project URL** và **publishable key** (dự án cũ có thể gọi là `anon`
   key). Các giá trị này được thiết kế để dùng ở trình duyệt, nhưng chỉ an toàn
   khi giữ RLS bật và policy đúng.
3. Khi ứng dụng được nối với Supabase, cấu hình URL/key ở môi trường build hoặc
   file cấu hình frontend không chứa bí mật. Có thể gửi Project URL và
   publishable key để hỗ trợ cấu hình; tuyệt đối không gửi `service_role` key,
   database password, access token hoặc mã mời.
4. Muốn đăng nhập hoạt động trên domain thật, cấu hình **Authentication** →
   **URL Configuration**: đặt Site URL và các Redirect URLs của domain triển
   khai.

Không đưa `service_role` key vào JavaScript chạy trên trình duyệt. Key này bỏ
qua RLS và chỉ dành cho môi trường server đáng tin cậy; hiện app tĩnh này chưa
cần key đó.

## 6. Đưa trang lên mạng

Sau khi frontend thực sự kết nối Supabase, có thể liên kết repo GitHub với
Vercel/Netlify hoặc dùng GitHub Pages cho trang tĩnh. Với Vercel/Netlify, đặt
biến môi trường trong phần Project Settings → Environment Variables, rồi
deploy lại. Không đặt secrets trong file đã commit.

Deploy trang hiện tại chỉ đưa bản demo `localStorage` lên mạng, chưa làm nhật
ký đồng bộ giữa hai tài khoản.

## Tệp đính kèm và giới hạn bảo mật hiện tại

Giao diện demo hiện nhận ảnh/GIF, sticker có sẵn, tệp âm thanh tải lên hoặc
ghi âm từ microphone (cần cấp quyền trình duyệt, thường phải dùng HTTPS khi
deploy). Tệp hiện lưu trong `localStorage` của thiết bị, không tự đồng bộ và
có giới hạn kích thước/dung lượng; đây chưa phải nơi lưu an toàn cho dữ liệu
thật. Khi nối Supabase cần tạo bucket riêng tư và kiểm thử policy Storage theo
quyền đọc bài: tác giả truy cập ngay, người kia chỉ truy cập sau giờ mở khóa.

Schema này không triển khai mã hóa đầu cuối, xác thực hai yếu tố hay chính sách
lưu file ảnh/âm thanh trên Supabase Storage. Mã PIN trong demo chỉ lưu ở trình
duyệt và không thay thế đăng nhập an toàn. Mã hóa at-rest của nhà cung cấp không
đồng nghĩa với mã hóa đầu cuối.
