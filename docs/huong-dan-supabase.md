# Hướng dẫn cài Supabase: 1 project, 3 tài khoản

Dùng file [`supabase/migrations/20261102000000_init_journal.sql`](../supabase/migrations/20261102000000_init_journal.sql). Không cần mã mời hay ghép cặp.

| Tài khoản | role | Quyền |
|---|---|---|
| Hòa | `member` | Viết/sửa bài tuần hiện tại; đọc bài June sau 00:00 thứ Hai GMT+7 |
| June | `member` | Như Hòa, ngược lại |
| Admin | `admin` | Chỉ đọc toàn bộ bài và media của cả hai (kể cả bài chưa mở); không sửa được |

Tài khoản đăng nhập supabase.com (chủ project) là tài khoản riêng, có quyền cao
nhất, phải bật MFA. Không dùng nó làm tài khoản Admin trong app.

## Bước 1. Tạo project (tự làm)

1. Đăng nhập [supabase.com](https://supabase.com/) → **New project**.
2. Đặt tên (ví dụ `nhat-ky`), region **Southeast Asia (Singapore)**.
3. Tự tạo database password, lưu vào password manager. Không đưa cho ai, kể cả
   tiện ích Claude.

## Bước 2. Chạy schema

1. **SQL Editor** → **New query**.
2. Dán toàn bộ `supabase/migrations/20261102000000_init_journal.sql` → **Run**. Phải báo *Success*; nếu lỗi, chép
   nguyên văn lỗi lại, không sửa bừa.
3. Kiểm tra **Table Editor** có `profiles`, `journal_entries`; **Storage** có
   bucket `journal-media` (Private).

## Bước 3. Tạo 3 user

1. **Authentication** → **Sign In / Providers**: bật Email; tắt *Allow new users
   to sign up* (chỉ admin tạo tài khoản).
2. **Authentication** → **Users** → **Add user** → **Create new user**, tạo 3 lần:
   email của Hòa, email của June, email cho Admin. Tích *Auto Confirm User*.
   Mỗi người tự nhập mật khẩu của mình (hoặc dùng *Send invitation*).
3. Mở SQL Editor, sửa email rồi chạy:

```sql
insert into public.profiles (id, display_name, role)
select id, 'Hòa', 'member' from auth.users where email = 'EMAIL_HOA';

insert into public.profiles (id, display_name, role)
select id, 'June', 'member' from auth.users where email = 'EMAIL_JUNE';

insert into public.profiles (id, display_name, role)
select id, 'Admin', 'admin' from auth.users where email = 'EMAIL_ADMIN';

select p.display_name, p.role, u.email
from public.profiles p join auth.users u on u.id = p.id;
```

Câu `select` cuối phải ra đúng 3 dòng.

## Bước 4. Lấy thông tin kết nối frontend

**Project Settings** → **API Keys**: lấy **Project URL** và **publishable key**
(`anon`). Chỉ hai giá trị này được đưa vào frontend. Không lấy/không dán
`service_role` (secret) key ở đâu cả.

**Authentication** → **URL Configuration**: đặt Site URL = domain sẽ deploy
(tạm thời `http://localhost:5500` nếu chạy thử).

## Bước 5. Kiểm thử quyền

Sau khi frontend nối Supabase, đăng nhập lần lượt từng người:
- Hòa viết bài → June không thấy nội dung trước 00:00 thứ Hai.
- Sau giờ mở: June đọc được, không sửa được; Hòa cũng không sửa được nữa.
- Admin: đọc được mọi bài của cả hai (sau khi chạy migration
  `20261102010000_admin_read_all_entries.sql`), không sửa được.

---

## Dùng tiện ích Claude in Chrome để làm Bước 2–4

Tự làm Bước 1 và tự đăng nhập Dashboard trước. Mở tab project rồi dán lệnh sau
cho tiện ích (thay `EMAIL_*`, dán nội dung `supabase/migrations/20261102000000_init_journal.sql` vào chỗ đánh dấu):

```text
Tôi đang ở Supabase Dashboard, project "nhat-ky". Hãy làm lần lượt, dừng lại
hỏi tôi nếu có lỗi hoặc màn hình khác mô tả:

1. Mở SQL Editor → New query, dán đoạn SQL dưới đây, bấm Run. Báo kết quả.
   Nếu lỗi, chép nguyên văn lỗi cho tôi và dừng lại.
2. Mở Authentication → Sign In / Providers: đảm bảo Email bật, tắt
   "Allow new users to sign up". Lưu.
3. Authentication → Users → Add user → Create new user cho 3 email:
   EMAIL_HOA, EMAIL_JUNE, EMAIL_ADMIN. Tích Auto Confirm User.
   Đến ô mật khẩu thì DỪNG để tôi tự nhập, không tự đặt mật khẩu.
4. SQL Editor → New query, chạy đoạn insert profiles ở Bước 3 trong hướng dẫn
   (đã thay email), rồi báo kết quả câu select cuối.
5. Mở Project Settings → API Keys, cho tôi biết Project URL và publishable
   key. KHÔNG mở/không đọc/không chép service_role hoặc secret key.

--- SQL ---
<dán toàn bộ supabase/migrations/20261102000000_init_journal.sql vào đây>
```

Lưu ý khi dùng tiện ích:
- Không đưa cho tiện ích database password, mật khẩu của Hòa/June/Admin hay
  `service_role` key.
- Đọc lại kết quả từng bước; RLS chỉ an toàn khi đã kiểm thử ở Bước 5.
