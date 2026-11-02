(() => {
  "use strict";
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MEDIA_BUCKET } = window.APP_CONFIG;
  const PIN_KEY = "chung-minh-pin-v1";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const people = { a: { id: null, name: "Hòa", emoji: "🌼", avatar: "a" }, b: { id: null, name: "June", emoji: "🌿", avatar: "b" } };
  const moods = { "😊": 5, "🥰": 5, "😌": 4, "😔": 2, "😵‍💫": 1, "🤍": 3 };
  const prompts = [
    "Điều gì khiến bạn mỉm cười hôm nay?",
    "Có khoảnh khắc bình thường nào bạn muốn giữ lại thật lâu?",
    "Hôm nay, bạn muốn cảm ơn bản thân vì điều gì?",
    "Nếu gửi một lời nhắn cho mình của một năm sau, bạn sẽ viết gì?",
    "Điều gì giúp bạn thấy bình yên trước khi ngủ?"
  ];
  const requirements = [
    ["Mỗi người viết nhiều bài trong ngày, trong tuần", true],
    ["Bài tuần này ẩn với người kia đến thứ Hai tiếp theo", true],
    ["Bài tuần cũ mở cho đối phương và chuyển thành chỉ đọc", true],
    ["Quyền mở khóa được bảo vệ thật ở backend", true],
    ["Tâm trạng, chủ đề gợi ý và biểu đồ", true],
    ["Đính kèm ảnh/GIF, sticker và voice chat", true],
    ["Tìm kiếm, kỷ niệm cũ và xuất/in PDF", true],
    ["Giao diện đêm thích ứng nhiều kích thước", true],
    ["Tài khoản đăng nhập và đồng bộ backend", true],
    ["Lưu tệp riêng tư trên Supabase Storage", true],
    ["Mã hóa đầu cuối thực sự", false],
    ["Xác thực hai yếu tố (2FA)", false]
  ];
  const $ = id => document.getElementById(id);
  let state = { entries: [], pin: loadPin() };
  let currentUser = null;
  let currentProfile = null;
  let weekOffset = 0;
  let observedCurrentWeek = null;
  let selectedImages = [];
  let selectedAudio = null;
  let recordedAudio = null;
  let selectedAudioUrl = null;
  let recordedAudioUrl = null;
  let selectedStickers = [];
  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingTimer = null;
  let discardRecording = false;
  let promptIndex = Math.floor(Math.random() * prompts.length);
  let toastTimer;

  function loadPin() {
    try { return localStorage.getItem(PIN_KEY); }
    catch (error) { console.error("Không thể đọc mã PIN:", error); return null; }
  }
  function persistPin() {
    try { state.pin ? localStorage.setItem(PIN_KEY, state.pin) : localStorage.removeItem(PIN_KEY); }
    catch (error) { notify("Không thể lưu mã PIN trên trình duyệt này."); console.error("Lưu mã PIN thất bại:", error); }
  }
  function authorKey(userId) {
    return Object.keys(people).find(key => people[key].id === userId) || null;
  }
  function toStoredMedia(item) {
    return item.path ? { type: item.type, name: item.name, path: item.path } : item;
  }
  async function loadProfiles(userId) {
    const { data, error } = await db.from("profiles").select("id, display_name, role");
    if (error) throw error;
    currentProfile = data.find(profile => profile.id === userId) || null;
    if (!currentProfile) throw new Error("Tài khoản này chưa được gán quyền. Hãy nhờ admin thêm vào bảng profiles.");
    data.filter(profile => profile.role === "member")
      .sort((left, right) => (left.display_name === "June") - (right.display_name === "June"))
      .slice(0, 2)
      .forEach((profile, index) => { const key = index ? "b" : "a"; people[key].id = profile.id; people[key].name = profile.display_name; });
    currentUser = currentProfile.role === "member" ? authorKey(currentProfile.id) : null;
  }
  async function loadEntries() {
    // RLS chỉ trả bài của mình và bài đối phương đã tới giờ mở.
    const { data, error } = await db.from("journal_entries").select("id, author_id, entry_date, week_key, created_at, unlock_at, body, mood, media");
    if (error) throw error;
    const paths = data.flatMap(row => row.media.filter(item => item.path).map(item => item.path));
    const urls = {};
    if (paths.length) {
      const { data: signed, error: signError } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 3600);
      if (signError) console.error("Không tạo được link tệp đính kèm:", signError);
      else signed.forEach(item => { if (item.signedUrl) urls[item.path] = item.signedUrl; });
    }
    state.entries = data.map(row => ({
      id: row.id, author: authorKey(row.author_id), week: row.week_key, entryDate: row.entry_date,
      createdAt: row.created_at, unlockAt: row.unlock_at, text: row.body, mood: row.mood,
      media: row.media.map(item => item.path ? { ...item, data: urls[item.path] || "" } : item)
    })).filter(entry => entry.author);
  }
  function notify(message) {
    const toast = $("toast"); toast.textContent = message; toast.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.add("hidden"), 3000);
  }
  function weekStart(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d;
  }
  function weekKey(date) {
    const start = weekStart(date);
    const thursday = new Date(start); thursday.setUTCDate(thursday.getUTCDate() + 3);
    const isoYear = thursday.getUTCFullYear();
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const firstMonday = weekStart(jan4);
    const number = Math.floor((start - firstMonday) / 604800000) + 1;
    return `${isoYear}-W${String(number).padStart(2, "0")}`;
  }
  function currentWeekDate() {
    const now = new Date();
    const localOffsetMs = 7 * 60 * 60 * 1000;
    const gmt7 = new Date(now.getTime() + localOffsetMs);
    gmt7.setUTCHours(0, 0, 0, 0);
    return new Date(Date.UTC(gmt7.getUTCFullYear(), gmt7.getUTCMonth(), gmt7.getUTCDate() + weekOffset * 7));
  }
  function dateKey(date) {
    return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function todayKey() {
    return dateKey(new Date());
  }
  function weekOfDateKey(key) {
    return weekKey(new Date(`${key}T00:00:00Z`));
  }
  function offsetForDate(key) {
    const target = weekStart(new Date(`${key}T00:00:00Z`));
    const current = weekStart(new Date(`${todayKey()}T00:00:00Z`));
    return Math.round((target - current) / 604800000);
  }
  // Bài sửa/xóa được trong tuần mà nó được viết (khớp policy trên database).
  function isEditable(entry) {
    return Boolean(entry && entry.author === currentUser && weekOfDateKey(dateKey(new Date(entry.createdAt))) === weekOfDateKey(todayKey()));
  }
  function entryDateKey(entry) {
    return entry.entryDate || dateKey(new Date(entry.createdAt));
  }
  function fmtDate(date, options = { day: "numeric", month: "long" }) {
    return new Intl.DateTimeFormat("vi-VN", { ...options, timeZone: "Asia/Ho_Chi_Minh" }).format(date);
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }
  function entryWeek(entry) {
    return entry.week || weekKey(new Date(`${entryDateKey(entry)}T00:00:00Z`));
  }
  function entriesFor(week, user) {
    return state.entries.filter(entry => entryWeek(entry) === week && entry.author === user)
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  }
  function editingEntry() {
    return state.entries.find(entry => entry.id === $("save-entry").dataset.edit) || null;
  }
  function composerMedia() {
    return editingEntry()?.media || [];
  }
  function unlockAt(week) {
    const [year, weekNo] = week.split("-W").map(Number);
    const monday = weekStart(new Date(Date.UTC(year, 0, 4)));
    monday.setUTCDate(monday.getUTCDate() + weekNo * 7);
    return new Date(monday.getTime() - 7 * 60 * 60 * 1000);
  }
  function visibleTo(entry, viewer, now = new Date()) {
    return Boolean(entry && (entry.author === viewer || now >= new Date(entry.unlockAt || unlockAt(entryWeek(entry)))));
  }
  function displayWeek(weekDate) {
    const key = weekKey(weekDate);
    const monday = weekStart(weekDate);
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    const label = `${fmtDate(monday)} – ${fmtDate(sunday, { day: "numeric", month: "long", year: "numeric" })}`;
    const isCurrent = weekOffset === 0;
    $("week-heading").textContent = isCurrent ? "Tuần của tôi" : "Nhật ký tuần trước";
    $("week-caption").textContent = `NHẬT KÝ RIÊNG CỦA ${people[currentUser].name.toLocaleUpperCase("vi")}`;
    $("week-dates").textContent = label;
    $("week-number").textContent = key;
    $("next-week").disabled = weekOffset >= 0;
    $("next-week").style.opacity = weekOffset >= 0 ? ".45" : "1";
    const unlock = unlockAt(key);
    $("readonly-notice").classList.toggle("hidden", isCurrent);
    $("week-notice").classList.toggle("hidden", !isCurrent);
    $("compose-week-tag").textContent = key;
    if (isCurrent) {
      $("notice-title").textContent = "Viết vài dòng trước khi ngủ";
      $("notice-detail").textContent = "Bài tuần này chỉ người viết xem được cho đến 00:00 thứ Hai tuần sau (GMT+7).";
      $("countdown").textContent = countdown(unlock);
    }
    renderComposer(key);
    renderEntries(key, unlock);
  }
  function countdown(target) {
    const ms = target - new Date();
    if (ms <= 0) return "Mở khóa rồi";
    const days = Math.floor(ms / 86400000), hours = Math.floor(ms % 86400000 / 3600000);
    return `Mở cho đối phương sau ${days} ngày ${hours} giờ`;
  }
  function renderEntries(week, unlock) {
    const container = $("entries");
    const columns = ["a", "b"].map(user => {
      const person = people[user];
      const mine = user === currentUser;
      const entries = entriesFor(week, user).filter(entry => visibleTo(entry, currentUser));
      const title = `<h2 class="column-title">${person.emoji} ${escapeHtml(person.name)}<span>${entries.length ? `${entries.length} bài` : ""}</span></h2>`;
      if (!entries.length) {
        // Bài của đối phương trong tuần hiện tại không được máy chủ trả về.
        const locked = !mine && new Date() < unlock;
        const card = `<article class="card entry-card ${locked ? "locked-entry" : "empty-entry"}"><div class="card-head"><div><p class="card-subtitle">${locked ? "Bài viết đang được giữ riêng tư." : "Chưa có bài nhật ký tuần này."}</p></div><span class="mood-tag">${locked ? "⌑ Riêng tư" : "✧ Còn trống"}</span></div><div class="entry-body">${locked ? `Các bài sẽ tự mở ${fmtDate(unlock, { day: "numeric", month: "long" })} lúc 00:00 (GMT+7).` : "Một tuần mới đang chờ được ghi lại."}</div></article>`;
        return `<div class="entry-column">${title}${card}</div>`;
      }
      const cards = entries.map(entry => {
        const action = mine && isEditable(entry)
          ? `<button class="tiny-button" data-edit="${entry.id}">Chỉnh sửa</button><button class="tiny-button" data-delete="${entry.id}">Xóa</button>`
          : `<span class="entry-date">${mine ? "Bài của bạn · chỉ đọc" : "Đã mở khóa · chỉ đọc"}</span>`;
        return `<article class="card entry-card"><div class="card-head"><div><p class="entry-date">${fmtDate(new Date(entry.createdAt), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p></div><span class="mood-tag">${entry.mood} ${moodLabel(entry.mood)}</span></div><div class="entry-body">${escapeHtml(entry.text)}${mediaMarkup(entry)}</div><div class="entry-footer">${action}</div></article>`;
      }).join("");
      return `<div class="entry-column">${title}${cards}</div>`;
    });
    container.innerHTML = columns.join("");
    container.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
      const entry = state.entries.find(item => item.id === button.dataset.edit);
      if (!entry) return;
      renderComposer(week, entry);
      $("compose-card").scrollIntoView({ behavior: "smooth", block: "start" });
      $("entry-text").focus();
    }));
    container.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => deleteEntry(button.dataset.delete)));
  }
  async function deleteEntry(id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry || !confirm("Xóa bài viết này? Không thể hoàn tác.")) return;
    // Xóa tệp trước: policy Storage cần bài còn tồn tại để cho phép xóa.
    const paths = entry.media.filter(item => item.path).map(item => item.path);
    if (paths.length) {
      const { error: removeError } = await db.storage.from(MEDIA_BUCKET).remove(paths);
      if (removeError) console.error("Không xóa được tệp trên Storage:", removeError);
    }
    const { error } = await db.from("journal_entries").delete().eq("id", id);
    if (error) { console.error("Xóa bài thất bại:", error); return notify(error.message || "Không thể xóa bài viết."); }
    if ($("save-entry").dataset.edit === id) $("save-entry").dataset.edit = "";
    notify("Đã xóa bài viết.");
    await reload();
  }
  function mediaMarkup(entry) {
    return entry.media?.length ? `<div class="media-preview">${entry.media.map(item => item.type === "image" ? `<img src="${item.data}" alt="Ảnh nhật ký">` : item.type === "sticker" ? `<span class="sticker-preview" aria-label="Sticker">${escapeHtml(item.data)}</span>` : `<audio class="entry-audio" controls src="${item.data}" aria-label="Voice chat"></audio>`).join("")}</div>` : "";
  }
  function moodLabel(mood) { return ({ "😊":"Vui vẻ", "🥰":"Biết ơn", "😌":"Bình yên", "😔":"Hơi buồn", "😵‍💫":"Áp lực", "🤍":"Cần ôm" })[mood] || ""; }
  function renderComposer(week, entry = null) {
    if (mediaRecorder?.state === "recording") {
      discardRecording = true;
      mediaRecorder.stop();
      recordingStream?.getTracks().forEach(track => track.stop());
      recordingStream = null;
      clearTimeout(recordingTimer);
      $("record-button").classList.remove("recording");
      $("record-button").textContent = "● Thu voice";
    }
    selectedImages = [];
    selectedAudio = null;
    recordedAudio = null;
    if (selectedAudioUrl) URL.revokeObjectURL(selectedAudioUrl);
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    selectedAudioUrl = null;
    recordedAudioUrl = null;
    selectedStickers = [];
    document.querySelectorAll("[data-sticker]").forEach(button => button.classList.remove("selected"));
    $("image-files").value = "";
    $("audio-file").value = "";
    $("entry-text").value = entry?.text || "";
    $("mood-select").value = entry?.mood || "😊";
    $("save-entry").textContent = entry ? "Cập nhật bài này" : "Đăng bài mới";
    $("save-entry").dataset.edit = entry?.id || "";
    $("compose-title").textContent = entry ? `Sửa bài ${fmtDate(new Date(entry.createdAt), { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : "Viết bài mới";
    $("cancel-edit").classList.toggle("hidden", !entry);
    // Mặc định: hôm nay nếu đang xem tuần này, Chủ nhật của tuần đang xem nếu là tuần cũ.
    const sunday = weekStart(currentWeekDate());
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const defaultDate = weekOffset === 0 ? todayKey() : dateKey(sunday);
    $("entry-date").max = todayKey();
    $("entry-date").value = entry ? entryDateKey(entry) : defaultDate;
    $("entry-date").disabled = Boolean(entry);
    updateComposeWeekTag();
    renderMediaPreview(entry?.media || []);
  }
  function updateComposeWeekTag() {
    const key = $("entry-date").value;
    $("compose-week-tag").textContent = key ? weekOfDateKey(key) : "Chọn ngày";
  }
  function renderMediaPreview(saved = []) {
    const items = saved.map((item, index) => ({ ...item, savedIndex: index }));
    for (const sticker of selectedStickers) items.push({ type: "sticker", data: sticker });
    for (const file of selectedImages) items.push({ type: "image", name: file.name });
    if (recordedAudio) items.push({ type: "audio", name: "voice-note.webm", preview: recordedAudioUrl });
    if (selectedAudio) items.push({ type: "audio", name: selectedAudio.name, preview: selectedAudioUrl });
    $("media-preview").innerHTML = items.map(item => {
      const content = item.type === "sticker"
        ? `<span class="sticker-preview" aria-label="Sticker">${escapeHtml(item.data)}</span>`
        : item.type === "image" && item.data
          ? `<img src="${item.data}" alt="Ảnh nhật ký">`
          : item.type === "audio" && (item.data || item.preview)
            ? `<audio class="entry-audio" controls src="${item.data || item.preview}" aria-label="Voice chat"></audio>`
            : `<span class="media-chip">${item.type === "audio" ? "♫" : "▧"} ${escapeHtml(item.name)}</span>`;
      const remove = item.savedIndex !== undefined && isEditable(editingEntry()) ? `<button type="button" class="remove-attachment" data-remove-media="${item.savedIndex}" aria-label="Xóa tệp đính kèm">×</button>` : "";
      return `<span class="attachment-item">${content}${remove}</span>`;
    }).join("");
    $("media-preview").querySelectorAll("[data-remove-media]").forEach(button => button.addEventListener("click", async () => {
      const entry = editingEntry();
      if (!isEditable(entry)) return;
      const media = entry.media.filter((_, index) => index !== Number(button.dataset.removeMedia));
      const removed = entry.media[Number(button.dataset.removeMedia)];
      const { error } = await db.from("journal_entries").update({ media: media.map(toStoredMedia) }).eq("id", entry.id);
      if (error) { console.error("Xóa tệp thất bại:", error); return notify(error.message || "Không thể xóa tệp đính kèm."); }
      if (removed?.path) {
        const { error: removeError } = await db.storage.from(MEDIA_BUCKET).remove([removed.path]);
        if (removeError) console.error("Không xóa được tệp trên Storage:", removeError);
      }
      await reload(entry.id);
    }));
  }
  function renderChecklist() {
    const done = requirements.filter(item => item[1]).length;
    $("checklist-progress").textContent = `${done}/${requirements.length} mục đã làm · các mục cần máy chủ được đánh dấu riêng.`;
    $("check-items").innerHTML = requirements.map(([label, complete]) => `<label class="check-item ${complete ? "" : "todo"}"><input type="checkbox" ${complete ? "checked" : ""} disabled><span>${label}</span><span class="status-tag ${complete ? "" : "pending"}">${complete ? "Đã làm" : "Cần backend"}</span></label>`).join("");
  }
  function renderChart() {
    const svg = $("mood-chart"), width = 300, height = 130, pad = 12;
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: new Intl.DateTimeFormat("vi-VN", { month: "short" }).format(d) });
    }
    const values = [];
    for (const month of months) {
      const found = state.entries.filter(entry => {
        const entryDate = new Date(`${entryDateKey(entry)}T00:00:00Z`);
        return entry.author === currentUser && entryDate.getUTCFullYear() === month.year && entryDate.getUTCMonth() === month.month;
      });
      values.push(found.length ? found.reduce((sum, entry) => sum + (moods[entry.mood] || 3), 0) / found.length : null);
    }
    const x = index => pad + index * (width - pad * 2) / 11;
    const y = value => height - 23 - ((value - 1) / 4) * 90;
    let markup = `<line class="chart-grid" x1="8" y1="${y(1)}" x2="292" y2="${y(1)}"/><line class="chart-grid" x1="8" y1="${y(3)}" x2="292" y2="${y(3)}"/><line class="chart-grid" x1="8" y1="${y(5)}" x2="292" y2="${y(5)}"/>`;
    const points = values.map((value, i) => value === null ? null : `${x(i)},${y(value)}`);
    const chunks = [];
    let chunk = [];
    points.forEach(point => { if (point) chunk.push(point); else if (chunk.length) { chunks.push(chunk); chunk = []; } });
    if (chunk.length) chunks.push(chunk);
    const lineClass = currentUser === "a" ? "a" : "b";
    markup += chunks.map(pointsInLine => `<polyline class="chart-line-${lineClass}" points="${pointsInLine.join(" ")}"/>`).join("");
    points.forEach((point, i) => { if (point) markup += `<circle class="chart-dot-${lineClass}" cx="${x(i)}" cy="${y(values[i])}" r="3"/>`; });
    months.forEach((month, i) => { if (i % 2 === 0 || i === 11) markup += `<text x="${x(i)}" y="126" text-anchor="middle" fill="#a2a198" font-size="8">${month.label}</text>`; });
    svg.innerHTML = markup;
  }
  function renderMemory() {
    const target = new Date(currentWeekDate()); target.setUTCFullYear(target.getUTCFullYear() - 1);
    const key = weekKey(target);
    const entries = ["a", "b"].flatMap(user => entriesFor(key, user)).filter(entry => visibleTo(entry, currentUser)).slice(0, 6);
    const memory = $("memory-content");
    if (!entries.length) { memory.className = "history-empty"; memory.textContent = `Chưa có kỷ niệm vào tuần này từ một năm trước (${key}). Những điều đẹp đẽ rồi sẽ đến.`; return; }
    memory.className = "history-list";
    memory.innerHTML = entries.map(entry => `<div class="history-item"><strong>${people[entry.author].name} · ${entry.mood} · ${entryWeek(entry)}</strong><span>${escapeHtml(entry.text.slice(0, 120))}${entry.text.length > 120 ? "…" : ""}</span></div>`).join("");
  }
  function renderSearch() {
    const query = $("search-input").value.trim().toLocaleLowerCase("vi");
    const mood = $("search-mood").value, year = $("search-year").value;
    const result = $("search-results");
    const matches = state.entries.filter(entry => visibleTo(entry, currentUser) && (!query || entry.text.toLocaleLowerCase("vi").includes(query)) && (!mood || entry.mood === mood) && (!year || Number(entryDateKey(entry).slice(0, 4)) === Number(year)));
    result.classList.toggle("hidden", !(query || mood || year));
    result.innerHTML = matches.length ? matches.slice(0, 10).map(entry => `<div class="history-item"><strong>${people[entry.author].name} · ${entry.mood} · ${entryWeek(entry)}</strong><span>${escapeHtml(entry.text.slice(0, 110))}${entry.text.length > 110 ? "…" : ""}</span></div>`).join("") : `<div class="history-empty">Không tìm thấy trang nhật ký phù hợp.</div>`;
  }
  function refresh() {
    $("today-label").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    const person = people[currentUser];
    $("current-avatar").textContent = person.emoji; $("current-avatar").className = `avatar ${person.avatar}`;
    $("current-name").textContent = person.name;
    if (weekOffset === 0) observedCurrentWeek = weekKey(currentWeekDate());
    displayWeek(currentWeekDate());
    renderChart(); renderMemory(); renderChecklist(); renderSearch();
  }
  async function reload(editId = "") {
    try { await loadEntries(); }
    catch (error) { console.error("Tải nhật ký thất bại:", error); notify(error.message || "Không tải được nhật ký."); }
    populateYears(); refresh();
    const editing = state.entries.find(entry => entry.id === editId);
    if (editing) renderComposer(weekKey(currentWeekDate()), editing);
  }
  async function uploadMedia(entryId, file, index) {
    const ext = (file.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
    const path = `${entryId}/${Date.now()}-${index}.${ext}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }
  $("save-entry").addEventListener("click", async () => {
    if (mediaRecorder?.state === "recording") return notify("Hãy dừng ghi âm trước khi lưu nhật ký.");
    const entryDate = $("entry-date").value;
    if (!editingEntry() && (!entryDate || entryDate > todayKey())) return notify("Hãy chọn một ngày không ở tương lai.");
    const text = $("entry-text").value.trim();
    if (!text && selectedImages.length === 0 && !selectedAudio && !recordedAudio && selectedStickers.length === 0) return notify("Hãy viết vài dòng hoặc thêm một kỷ niệm nhé.");
    const button = $("save-entry"); button.disabled = true;
    const uploaded = [];
    try {
      const existing = editingEntry();
      const savedMedia = existing?.media || [];
      const savedImages = savedMedia.filter(item => item.type === "image").length;
      if (savedImages + selectedImages.length > 3) throw new Error("Mỗi bài chỉ đính kèm tối đa 3 ảnh hoặc GIF.");
      if (savedMedia.some(item => item.type === "audio") && (selectedAudio || recordedAudio)) throw new Error("Mỗi bài chỉ có thể lưu một tệp voice chat.");
      if (savedMedia.filter(item => item.type === "sticker").length + selectedStickers.length > 3) throw new Error("Mỗi bài chọn tối đa 3 sticker.");
      for (const file of selectedImages) {
        if (!file.type.startsWith("image/")) throw new Error("Tệp hình ảnh không hợp lệ.");
        if (file.size > 3 * 1024 * 1024) throw new Error("Mỗi ảnh hoặc GIF cần nhỏ hơn 3 MB.");
      }
      const audioFile = recordedAudio || selectedAudio;
      if (audioFile) {
        if (!audioFile.type.startsWith("audio/")) throw new Error("Hãy chọn một tệp âm thanh hợp lệ.");
        if (audioFile.size > 3 * 1024 * 1024) throw new Error("Tệp voice chat cần nhỏ hơn 3 MB.");
      }
      const mood = $("mood-select").value;
      let entryId = existing?.id;
      if (!entryId) {
        // Database tự gán author_id và tính week_key, unlock_at từ entry_date.
        const { data, error } = await db.from("journal_entries").insert({ body: text, mood, entry_date: entryDate }).select("id").single();
        if (error) throw error;
        entryId = data.id;
      }
      const additions = [];
      for (const [index, file] of selectedImages.entries()) {
        const path = await uploadMedia(entryId, file, index); uploaded.push(path);
        additions.push({ type: "image", name: file.name, path });
      }
      if (audioFile) {
        const path = await uploadMedia(entryId, audioFile, "voice"); uploaded.push(path);
        additions.push({ type: "audio", name: audioFile.name, path });
      }
      for (const sticker of selectedStickers) additions.push({ type: "sticker", data: sticker });
      const media = [...savedMedia, ...additions].map(toStoredMedia);
      const { error } = await db.from("journal_entries").update({ body: text, mood, media }).eq("id", entryId);
      if (error) throw error;
      uploaded.length = 0;
      selectedImages = []; selectedAudio = null; recordedAudio = null; selectedStickers = []; if (selectedAudioUrl) URL.revokeObjectURL(selectedAudioUrl); if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl); selectedAudioUrl = null; recordedAudioUrl = null; $("image-files").value = ""; $("audio-file").value = ""; $("media-preview").innerHTML = "";
      if (!existing) weekOffset = Math.min(0, offsetForDate(entryDate));
      await reload();
      notify(existing ? "Đã cập nhật bài viết." : weekOffset === 0 ? "Đã đăng bài mới." : `Đã đăng bài cho tuần ${weekOfDateKey(entryDate)}; bài hiện ngay cho đối phương.`);
    } catch (error) {
      console.error("Lưu nhật ký thất bại:", error);
      if (uploaded.length) await db.storage.from(MEDIA_BUCKET).remove(uploaded);
      notify(error.message || "Không thể lưu nhật ký.");
    }
    finally { button.disabled = false; }
  });
  $("image-files").addEventListener("change", event => {
    selectedImages = Array.from(event.target.files || []);
    renderMediaPreview(composerMedia());
  });
  $("audio-file").addEventListener("change", event => {
    selectedAudio = event.target.files?.[0] || null;
    if (selectedAudio) recordedAudio = null;
    if (selectedAudioUrl) URL.revokeObjectURL(selectedAudioUrl);
    selectedAudioUrl = selectedAudio ? URL.createObjectURL(selectedAudio) : null;
    renderMediaPreview(composerMedia());
  });
  $("record-button").addEventListener("click", async () => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
      $("record-button").classList.remove("recording");
      $("record-button").textContent = "● Thu voice";
      $("record-status").textContent = "Đang xử lý bản ghi...";
      clearTimeout(recordingTimer);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return notify("Trình duyệt này không hỗ trợ ghi âm. Bạn có thể tải lên tệp voice.");
    }
    if (selectedAudio || composerMedia().some(item => item.type === "audio")) {
      return notify("Bài tuần này đã có voice chat. Xóa tệp hiện tại trước khi ghi âm mới.");
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(recordingStream);
      mediaRecorder.addEventListener("dataavailable", event => { if (event.data.size) recordingChunks.push(event.data); });
      mediaRecorder.addEventListener("stop", () => {
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        recordingStream?.getTracks().forEach(track => track.stop());
        recordingStream = null;
        mediaRecorder = null;
        recordingChunks = [];
        if (discardRecording) {
          discardRecording = false;
          $("record-status").textContent = "Đã hủy bản ghi khi đổi tuần";
          return;
        }
        if (blob.size > 3 * 1024 * 1024) {
          recordedAudio = null;
          $("record-status").textContent = "Bản ghi quá lớn · thử ghi ngắn hơn";
          notify("Bản ghi vượt 3 MB. Hãy thử ghi đoạn voice ngắn hơn.");
        } else {
          recordedAudio = new File([blob], "voice-note.webm", { type: blob.type });
          recordedAudioUrl = URL.createObjectURL(blob);
          selectedAudio = null;
          selectedAudioUrl = null;
          $("audio-file").value = "";
          $("record-status").textContent = "Đã ghi voice · nghe thử bên dưới";
          renderMediaPreview(composerMedia());
        }
      }, { once: true });
      mediaRecorder.start();
      $("record-button").classList.add("recording");
      $("record-button").textContent = "■ Dừng ghi";
      $("record-status").textContent = "Đang ghi · tối đa 60 giây";
      recordingTimer = setTimeout(() => {
        if (mediaRecorder?.state === "recording") $("record-button").click();
      }, 60000);
    } catch (error) {
      recordingStream?.getTracks().forEach(track => track.stop());
      recordingStream = null;
      $("record-status").textContent = "Không bật được microphone";
      console.error("Không thể truy cập microphone:", error);
      notify("Không thể dùng microphone. Hãy cấp quyền hoặc tải lên tệp voice.");
    }
  });
  document.querySelectorAll("[data-sticker]").forEach(button => button.addEventListener("click", () => {
    const sticker = button.dataset.sticker;
    const index = selectedStickers.indexOf(sticker);
    if (index >= 0) selectedStickers.splice(index, 1);
    else if (selectedStickers.length < 3) selectedStickers.push(sticker);
    else return notify("Mỗi tuần chọn tối đa 3 sticker.");
    button.classList.toggle("selected", selectedStickers.includes(sticker));
    renderMediaPreview(composerMedia());
  }));
  $("prev-week").addEventListener("click", () => { weekOffset--; refresh(); });
  $("next-week").addEventListener("click", () => { if (weekOffset < 0) weekOffset++; refresh(); });
  $("sign-out").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
  $("cancel-edit").addEventListener("click", () => renderComposer(weekKey(currentWeekDate())));
  $("entry-date").addEventListener("input", updateComposeWeekTag);
  $("next-prompt").addEventListener("click", () => { promptIndex = (promptIndex + 1) % prompts.length; $("prompt-text").textContent = prompts[promptIndex]; });
  $("prompt-text").textContent = prompts[promptIndex];
  ["search-input", "search-mood", "search-year"].forEach(id => $(id).addEventListener("input", renderSearch));
  $("export-button").addEventListener("click", () => window.print());
  document.querySelectorAll(".nav button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    const target = $(button.dataset.section);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  function populateYears() {
    const years = [...new Set(state.entries.filter(entry => entry.author === currentUser).map(entry => Number(entryDateKey(entry).slice(0, 4))))].sort((a,b) => b-a);
    $("search-year").innerHTML = `<option value="">Mọi năm</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`;
  }
  function openPinSetup() {
    const root = $("modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${state.pin ? "Khóa ứng dụng" : "Tạo mã PIN"}</h2><p>${state.pin ? "Nhập mã PIN để khóa góc nhật ký này trên thiết bị." : "Tạo mã PIN 4–8 chữ số. Mã này chỉ được lưu trong trình duyệt hiện tại."}</p><input id="pin-input" type="password" inputmode="numeric" maxlength="8" placeholder="••••" aria-label="Mã PIN"><div class="modal-actions">${state.pin ? `<button class="danger-button" id="remove-pin">Gỡ mã PIN</button>` : ""}<button class="outline-button" id="cancel-pin">Để sau</button><button class="save-button" id="confirm-pin">${state.pin ? "Khóa ngay" : "Lưu mã PIN"}</button></div></div></div>`;
    $("cancel-pin").addEventListener("click", () => root.innerHTML = "");
    $("confirm-pin").addEventListener("click", () => {
      const pin = $("pin-input").value;
      if (!/^\d{4,8}$/.test(pin)) return notify("Mã PIN cần có từ 4 đến 8 chữ số.");
      if (state.pin && state.pin !== pin) return notify("Mã PIN chưa đúng.");
      if (!state.pin) { state.pin = pin; persistPin(); root.innerHTML = ""; notify("Đã thiết lập mã PIN trên thiết bị này."); return; }
      root.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>Đã khóa nhật ký</h2><p>Nhập mã PIN đã thiết lập để tiếp tục.</p><input id="unlock-pin" type="password" inputmode="numeric" maxlength="8" placeholder="••••"><div class="modal-actions"><button class="save-button" id="unlock-app">Mở khóa</button></div></div></div>`;
      $("unlock-app").addEventListener("click", () => { if ($("unlock-pin").value === state.pin) { root.innerHTML = ""; notify("Đã mở khóa."); } else notify("Mã PIN chưa đúng."); });
    });
    if (state.pin) $("remove-pin").addEventListener("click", () => {
      const pin = $("pin-input").value;
      if (pin !== state.pin) return notify("Mã PIN chưa đúng.");
      state.pin = null; persistPin(); root.innerHTML = ""; notify("Đã gỡ mã PIN.");
    });
    $("pin-input").focus();
  }
  $("app-lock-button").addEventListener("click", openPinSetup);
  async function renderAdmin() {
    $("current-name").textContent = currentProfile.display_name;
    $("current-avatar").textContent = "⚙";
    $("week-caption").textContent = "QUẢN TRỊ";
    $("week-heading").textContent = "Toàn bộ nhật ký";
    $("week-dates").textContent = "Admin chỉ đọc, xem được cả bài chưa tới giờ mở.";
    ["compose-card", "week-notice", "readonly-notice"].forEach(id => $(id).classList.add("hidden"));
    document.querySelector(".week-control").classList.add("hidden");
    document.querySelector(".right-column").classList.add("hidden");
    document.querySelector(".layout").style.gridTemplateColumns = "minmax(0, 1fr)";
    try { await loadEntries(); }
    catch (error) { console.error("Tải nhật ký thất bại:", error); return notify(error.message || "Không tải được nhật ký."); }
    const weeks = [...new Set(state.entries.map(entryWeek))].sort().reverse();
    if (!weeks.length) { $("entries").innerHTML = `<div class="history-empty">Chưa có bài nào.</div>`; return; }
    $("entries").style.gridTemplateColumns = "minmax(0, 1fr)";
    $("entries").innerHTML = weeks.map(week => {
      const cards = ["a", "b"].map(user => {
        const entries = entriesFor(week, user);
        const person = people[user];
        const title = `<h2 class="column-title">${person.emoji} ${escapeHtml(person.name)}<span>${entries.length} bài</span></h2>`;
        if (!entries.length) return `<div class="entry-column">${title}<article class="card entry-card empty-entry"><div class="card-head"><p class="card-subtitle">Chưa viết tuần này.</p></div></article></div>`;
        return `<div class="entry-column">${title}${entries.map(entry => {
          const status = new Date(entry.unlockAt) <= new Date() ? "Đã mở" : `Mở ${fmtDate(new Date(entry.unlockAt), { day: "numeric", month: "long" })}`;
          return `<article class="card entry-card"><div class="card-head"><div><p class="entry-date">${fmtDate(new Date(entry.createdAt), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · ${status}</p></div><span class="mood-tag">${entry.mood} ${moodLabel(entry.mood)}</span></div><div class="entry-body">${escapeHtml(entry.text)}${mediaMarkup(entry)}</div></article>`;
        }).join("")}</div>`;
      }).join("");
      return `<section><div class="section-heading"><h2>${escapeHtml(week)}</h2></div><div class="timeline-strip">${cards}</div></section>`;
    }).join("");
  }
  async function start(user) {
    try {
      await loadProfiles(user.id);
      if (currentProfile.role === "admin") return renderAdmin();
      if (!currentUser) throw new Error("Không tìm thấy hồ sơ thành viên của tài khoản này.");
      await loadEntries();
      populateYears();
      refresh();
    } catch (error) {
      console.error("Khởi động thất bại:", error);
      await db.auth.signOut();
      showLogin(error.message || "Không tải được dữ liệu.");
    }
  }
  function showLogin(message = "") {
    const root = $("modal-root");
    root.innerHTML = `<div class="modal-backdrop"><form class="modal" id="login-form" aria-labelledby="login-title"><h2 id="login-title">Đăng nhập</h2><p>${escapeHtml(message || "Dùng tài khoản đã được tạo cho bạn.")}</p><input class="login-input" id="login-email" type="email" autocomplete="username" placeholder="Email" required aria-label="Email"><input class="login-input" id="login-password" type="password" autocomplete="current-password" placeholder="Mật khẩu" required aria-label="Mật khẩu"><div class="modal-actions"><button class="save-button" type="submit" id="login-submit">Đăng nhập</button></div></form></div>`;
    $("login-form").addEventListener("submit", async event => {
      event.preventDefault();
      $("login-submit").disabled = true;
      const { data, error } = await db.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
      if (error) { $("login-submit").disabled = false; return notify("Email hoặc mật khẩu chưa đúng."); }
      root.innerHTML = "";
      start(data.user);
    });
    $("login-email").focus();
  }
  db.auth.getSession().then(({ data }) => data.session ? start(data.session.user) : showLogin());
  setInterval(() => {
    if (!currentUser) return;
    const week = weekKey(currentWeekDate());
    if (weekOffset === 0 && week !== observedCurrentWeek) reload();
    else if (weekOffset === 0) $("countdown").textContent = countdown(unlockAt(week));
  }, 60000);
})();
