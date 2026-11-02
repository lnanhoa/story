# Chúng mình — Nhật ký đôi

Nhật ký theo tuần cho hai người. Bài của mỗi tuần tự mở cho người còn lại lúc
00:00 thứ Hai tuần sau (GMT+7). Frontend tĩnh, backend Supabase (Auth +
Postgres RLS + Storage).

## Cấu trúc thư mục

```
.
├── index.html              # Trang web (GitHub Pages phục vụ từ thư mục gốc)
├── css/styles.css
├── js/
│   ├── config.js           # Project URL + publishable key (công khai)
│   └── app.js              # Logic giao diện, gọi Supabase
├── .nojekyll               # Tắt Jekyll, phục vụ file tĩnh nguyên trạng
├── supabase/
│   ├── migrations/         # Schema đang dùng (chạy theo thứ tự tên file)
│   └── legacy/             # Schema ghép cặp cũ, không dùng
└── docs/
    ├── yeu-cau-he-thong.md # Tài liệu yêu cầu
    └── huong-dan-supabase.md # Cài Supabase và tạo 3 tài khoản
```

## Chạy thử trên máy

1. Cài đặt Supabase theo [docs/huong-dan-supabase.md](docs/huong-dan-supabase.md).
2. Mở thư mục bằng VS Code, cài tiện ích **Live Server**, bấm **Go Live**,
   trang chạy ở `http://localhost:5500`.
3. Đăng nhập bằng một trong ba tài khoản.

## Deploy

GitHub Pages: **Settings → Pages → Source: Deploy from a branch**, chọn
nhánh `main`, thư mục `/ (root)`. Mỗi lần push lên `main` trang tự cập nhật
tại https://lnanhoa.github.io/story/.

Netlify/Vercel: thư mục publish là thư mục gốc, không cần lệnh build.

Sau khi có domain, cập nhật **Authentication → URL Configuration → Site URL**
trong Supabase thành domain đó.

## Bảo mật

- `public/js/config.js` chỉ chứa giá trị công khai. Không commit
  `service_role` key, database password hay mật khẩu tài khoản.
- Quyền đọc/sửa do RLS trong `supabase/migrations/` cưỡng chế, không phụ
  thuộc giao diện.
