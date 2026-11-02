# Tài Liệu Thiết Kế Hệ Thống Nhật Ký Đôi Cho Hai Người

Tài liệu này tổng hợp yêu cầu xây dựng không gian nhật ký theo tuần cho Hòa và June. Mỗi người viết bài riêng; bài tự mở cho người còn lại đọc vào đầu tuần kế tiếp.

---

## 1. YÊU CẦU CỐT LÕI (CORE LOGIC)
Quyền đọc và chỉnh sửa dựa trên tác giả và tuần ISO-8601 của bài.

### A. Cấu trúc dữ liệu (Database)
*   **Thời gian tạo (`created_at`)**: Lưu chính xác ngày, giờ, phút viết bài (Chuẩn UTC).
*   **Tuần viết (`week_key`)**: Mỗi người viết được nhiều bài trong ngày/tuần; các bài được gom theo tuần ISO-8601. Tuần bắt đầu vào thứ Hai theo `Asia/Ho_Chi_Minh`.
*   **ID người viết (`author_id`)**: Phân biệt rõ ràng bài viết là của User A hay User B.

### B. Logic kiểm tra điều kiện (Backend API)
*   **Giờ mở khóa**: Bài của mỗi tuần tự mở cho người kia vào **00:00 thứ Hai đầu tuần kế tiếp**, tính theo `Asia/Ho_Chi_Minh` (GMT+7). Không phụ thuộc việc đối phương đã viết bài hay chưa.
*   **Quyền đọc**: Tác giả luôn đọc bài của mình. Đối phương chỉ đọc được bài và media sau `unlock_at`; backend không trả nội dung trước thời hạn.
*   **Quyền chỉnh sửa**: Tác giả được thêm/sửa bài trong tuần hiện tại. Từ khi sang tuần kế tiếp, bài cũ chỉ đọc đối với cả hai người.
*   **Bảo mật phía Server**: Backend/RLS phải cưỡng chế quyền; không chỉ ẩn nội dung bằng CSS hoặc JavaScript. Bài chưa mở không thể lấy qua API trực tiếp hay URL media.
*   **Giới hạn tài khoản**: Chỉ hai thành viên đã ghép cặp mới truy cập được bài đã mở; tài khoản ngoài cặp không được đọc.

### C. Giao diện & Trải nghiệm (UI/UX Cơ bản)
*   **Trạng thái khóa**: Khi bài chưa mở, hiển thị trạng thái chờ mà không gửi nội dung ẩn của đối phương về trình duyệt.
*   **Chỉnh sửa**: Tác giả xem/sửa bài tuần hiện tại; bài cũ và bài đã mở chỉ đọc.
*   **Giao diện sáng**: Dùng nền sáng trung tính, màu đơn giản, không quá rực; dễ đọc và phù hợp để ghi nhật ký.
*   **Thiết kế thích ứng**: Bố cục tự điều chỉnh cho điện thoại, máy tính bảng, laptop và màn hình máy tính; thao tác chạm, chữ và nút phù hợp màn hình nhỏ.

### D. Đồng bộ múi giờ (Timezone)
*   **Quy đổi giờ chuẩn**: Lưu toàn bộ thời gian dưới dạng UTC trên cơ sở dữ liệu.
*   **Giờ mở khóa**: Dùng `Asia/Ho_Chi_Minh` (GMT+7) để hai người ở bất kỳ đâu đều thấy nhật ký mở cùng thời điểm.

---

## 2. HƯỚNG DẪN BACKEND VÀ TÀI KHOẢN RIÊNG

### A. Nguyên tắc khi mã nguồn GitHub public
*   **Mã nguồn không phải dữ liệu**: Có thể để mã nguồn trang web public trên GitHub. Nhật ký, tài khoản, ảnh/âm thanh và dữ liệu riêng phải lưu ở backend, không commit vào repository.
*   **Một người một tài khoản**: Hòa và June đăng ký/đăng nhập bằng hai tài khoản Supabase Auth riêng. Không dùng chung mật khẩu hay tài khoản quản trị.
*   **Frontend là công khai**: URL dự án và publishable/anon key của Supabase có thể xuất hiện trong mã frontend; đây không phải mật khẩu. Chỉ an toàn khi bật Row Level Security (RLS) và kiểm thử đầy đủ mọi policy.
*   **Không công khai khóa đặc quyền**: Tuyệt đối không đưa `service_role` key, database password, access token, mã mời hoặc khóa mã hóa vào GitHub hay JavaScript chạy trong trình duyệt. Nếu một secret đã bị push, phải thu hồi/đổi secret; xóa khỏi commit sau đó không làm secret cũ an toàn trở lại.
*   **Không tin giao diện trình duyệt để bảo vệ bài**: Kiểm tra tác giả và quyền sửa phải được cưỡng chế ở backend/database. Bài của tài khoản còn lại không được trả trong response, kể cả khi gọi API trực tiếp.

### B. Quy trình thiết lập Supabase từ đầu
1. Tạo project Supabase, chọn region gần người dùng và cất database password trong password manager riêng.
2. Mở **SQL Editor → New query**, dán và chạy `supabase/migrations/20261102000000_init_journal.sql` (xem `docs/huong-dan-supabase.md`). Schema ghép cặp cũ nằm ở `supabase/legacy/`, không dùng nữa.
3. Mở **Authentication** và chọn phương thức đăng nhập. Tạo hoặc cho phép đăng ký hai tài khoản riêng; bật xác nhận email và cấu hình khôi phục mật khẩu.
4. Mỗi người đăng nhập bằng tài khoản của mình. Một người tạo journal couple và gửi mã mời dùng một lần cho người còn lại qua kênh riêng; người kia đăng nhập tài khoản của mình rồi chấp nhận mã mời.
5. Lấy Project URL và publishable/anon key từ cài đặt Supabase để cấu hình frontend. Chỉ public key được phép dùng trên client; không dùng `service_role`.
6. Deploy frontend qua hosting phù hợp. Cấu hình Site URL và Redirect URLs trong Supabase Auth đúng với domain triển khai; đặt server secrets trong phần quản lý environment variables của hosting, không commit file `.env`.
7. Kiểm tra bằng hai tài khoản và API trực tiếp: tuần hiện tại chỉ tác giả đọc/sửa; sau 00:00 thứ Hai GMT+7, đối phương đọc được bài nhưng không thể sửa; tài khoản ngoài cặp không đọc được.

### C. Yêu cầu backend và phân quyền
*   **Auth**: Dùng ID tài khoản đã xác thực (`auth.uid()`) làm định danh tác giả; không tin `author_id` do client tự gửi.
*   **Ghép cặp**: Mỗi tài khoản chỉ thuộc một cặp; một cặp tối đa hai thành viên. Mã mời phải ngẫu nhiên đủ mạnh, chỉ dùng một lần, không lưu dạng rõ trong database nếu có thể lưu hash, và không ghi vào log.
*   **Row Level Security**: Bật RLS cho tất cả bảng nhật ký, thành viên, phản ứng, bình luận, hồi đáp và bảng lưu file. Policy phải giới hạn mọi thao tác theo thành viên cặp và người dùng đã đăng nhập; mặc định từ chối nếu chưa có policy phù hợp.
*   **Quyền ở database/server**: RLS cho tác giả đọc bài của mình; chỉ tác giả được tạo/sửa trong tuần hiện tại. Thành viên còn lại đọc được khi `unlock_at <= now()`. Không cho client tự giả mạo `author_id`, `week_key` hoặc `unlock_at`.
*   **Ảnh/GIF/sticker/giọng nói**: Cho phép đính kèm tối đa 3 ảnh/GIF, tối đa 3 sticker và một voice chat/ghi âm cho mỗi bài tuần. Khi dùng Supabase Storage, bucket không để public; media chỉ mở cùng bài viết theo policy backend.
*   **Quản trị dịch vụ**: Chỉ dùng service-role key ở môi trường server đáng tin cậy, giới hạn người có quyền vào Supabase Dashboard và bật MFA cho tài khoản quản trị.

### D. Bảo mật dữ liệu và giới hạn
*   RLS giúp ngăn tài khoản thông thường đọc nhật ký của tài khoản khác. Tuy nhiên, nhà cung cấp backend và người có quyền quản trị database có thể truy cập dữ liệu dạng rõ nếu ứng dụng chưa mã hóa đầu cuối.
*   Muốn đạt yêu cầu **Admin cũng không thể đọc trộm**, cần thiết kế mã hóa đầu cuối thực sự: mã hóa nội dung và media trên thiết bị trước khi upload, quản lý/trao đổi khóa riêng an toàn, và chỉ gửi ciphertext lên backend. Không lưu khóa giải mã trong GitHub, database hay server. RLS và mã hóa khi lưu của nhà cung cấp không thay thế E2EE.
*   Mã PIN phía giao diện không thay thế đăng nhập, RLS hay mã hóa đầu cuối. 2FA cần được bật/cấu hình qua hệ thống Auth và kiểm thử riêng.
*   **Tương tác và dòng thời gian chung**: Bình luận, phản ứng và hồi đáp chỉ xem xét sau khi bài đã mở, với policy backend riêng.
*   **Tình trạng triển khai hiện tại**: Giao diện sáng demo mô phỏng mở khóa tuần bằng `localStorage`, không an toàn cho nhiều tài khoản. Media chưa dùng Supabase Storage. Schema/migration là bộ khung policy cho quyền đọc sau giờ mở và sửa trong tuần hiện tại. Trang chưa có Auth, chưa gọi Supabase và chưa có policy Storage; chưa dùng cho dữ liệu thật.

---

## 3. CÁC TÍNH NĂNG NÂNG CAO (ADVANCED FEATURES)

### A. Tương tác sau khi mở khóa
*   **Phản ứng, bình luận, hồi đáp**: Chỉ xem xét sau khi bài đã mở và có policy backend đảm bảo thành viên cặp mới được tương tác.

### B. Trải nghiệm người dùng chuyên sâu
*   **Tâm trạng & Cảm xúc (Mood Tracker)**: Chọn biểu tượng cảm xúc (vui, buồn, áp lực...) cho mỗi tuần. Hệ thống tự động vẽ biểu đồ xu hướng tâm trạng theo tháng/năm.
*   **Gợi ý chủ đề viết (Journal Prompts)**: Tự động gợi ý các câu hỏi đôi vào những tuần "bí ý tưởng" (Ví dụ: *"Điều gì ở đối phương làm bạn hạnh phúc nhất tuần này?"*).
*   **Nhật ký đa phương tiện (Media Attachment)**: Mỗi bài tuần hỗ trợ tối đa 3 ảnh/GIF, 3 sticker và 1 voice chat/đoạn ghi âm. Bản demo giới hạn kích thước tệp; khi triển khai thật, media cần nằm trong bucket riêng tư với policy truy cập giống bài viết.

### C. Bảo mật & Riêng tư tuyệt đối
*   **Khóa ứng dụng (App Lock)**: Thêm mã PIN, FaceID hoặc TouchID khi mở trang web trên điện thoại.
*   **Mã hóa đầu cuối (End-to-End Encryption)**: Nội dung nhật ký được mã hóa ngay tại thiết bị bằng khóa riêng của 2 người trước khi gửi lên server. Admin cũng không thể đọc trộm.
*   **Xác thực 2 yếu tố (2FA)**: Bảo vệ tài khoản bằng mã OTP qua ứng dụng xác thực hoặc email.

### D. Lưu trữ & Giá trị dài lâu
*   **Xuất bản và In ấn (Export & Book Printing)**: Xuất toàn bộ nhật ký thành file PDF định dạng đẹp, hoặc liên kết dịch vụ in ấn để đóng thành một cuốn sách vật lý kỷ niệm.
*   **Ngày này năm xưa (Flashback / Memory Lane)**: Tự động nhắc lại bài viết của tuần này 1 năm hoặc 2 năm trước vào mỗi sáng Thứ 2.
*   **Tìm kiếm nâng cao (Smart Search)**: Tìm kiếm lại kỷ niệm dựa trên từ khóa, mốc thời gian hoặc bộ lọc cảm xúc.